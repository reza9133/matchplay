"""Shared helpers for the direct-mode suite (genlayer-test fixtures).

The contract runs on the real GenLayer SDK. Three things are simulated here:
  * the judge model (`Model`): a scripted stand-in that reads the real prompt and answers from markers in the texts,
  * the web (`Web`): a dictionary of pages,
  * the chain (`Chain`): who received money, and the contract's own native balance, with transfers that can be
    delivered at once or only when the network "finalizes" them.
"""

import json
import re
import sys
from datetime import datetime, timezone

import pytest

CONTRACT = "contracts/matchplay.py"
MODULE = "_contract_matchplay"
GEN = 10**18
MILLI = 10**15  # 0.001 GEN

OPEN, PLAYING, DONE, CANCELLED = range(4)
M_PENDING, M_PLAYED = range(2)
A_WINS, B_WINS, TIE, NEITHER = range(4)
BY_NONE, BY_JUDGE, BY_VOID, BY_TIMEOUT = range(4)
POINTS = {A_WINS: (2, 0), B_WINS: (0, 2), TIE: (1, 1), NEITHER: (0, 0)}

T0 = int(datetime(2026, 11, 2, 12, 0, 0, tzinfo=timezone.utc).timestamp())

TITLE = "Tools that help people verify what they read"
MISSION = (
    "Fund small open projects that help ordinary readers check whether a claim they met online is true: "
    "fact-checking helpers, source finders and plain-language explainers. Reward real, working help."
)
EVIDENCE_A = "https://docs.example.org/alpha"
EVIDENCE_B = "https://docs.example.org/beta"
EVIDENCE_C = "https://docs.example.org/gamma"
EVIDENCE_D = "https://docs.example.org/delta"


def page(text: str) -> str:
    return f"<html><head><title>Project</title></head><body><h1>Project page</h1><p>{text}</p></body></html>"


GOOD_TEXT = "A working browser add-on that finds the original source of a quote and shows it next to the claim. Used by readers daily."


def hx(a) -> str:
    """Lower-case 0x form of an address object, raw bytes or a hex string."""
    if isinstance(a, str):
        return a.lower()
    if hasattr(a, "as_hex"):
        return str(a.as_hex).lower()
    return "0x" + bytes(a).hex()


def at(vm, offset: int) -> None:
    """Move the chain clock to T0 + offset seconds."""
    vm.warp(datetime.fromtimestamp(T0 + offset, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))


def act(vm, who, value: int = 0):
    """The next call is made by `who` and carries `value`."""
    try:
        vm.deal(who, 1000 * GEN)
    except Exception:
        pass
    vm.sender = who
    vm.value = value


def _actor(n: int) -> bytes:
    return bytes([0xB0, n]) + bytes(18)


class P:
    """Fixed actors, as raw 20-byte addresses."""

    host = _actor(1)
    other_host = _actor(2)
    stranger = _actor(3)
    runner = _actor(4)
    e = [_actor(10 + i) for i in range(12)]  # entrants
    extra = [_actor(40 + i) for i in range(30)]


ZERO_ADDRESS = "0x" + "0" * 40


# ---- the chain ------------------------------------------------------------------------------------------------------


class Chain:
    """Stands in for the chain-level transfer. `delayed` holds transfers until `finalize()` (the way a network with a
    finality window behaves), otherwise they arrive at once. It also keeps the contract's native balance."""

    delayed = False
    pending = []
    received = {}
    vm = None
    sent = []

    @classmethod
    def reset(cls, vm=None):
        cls.delayed = False
        cls.pending = []
        cls.received = {}
        cls.sent = []
        if vm is not None:
            cls.vm = vm

    @classmethod
    def contract_key(cls):
        addr = cls.vm._contract_address
        return bytes(addr) if hasattr(addr, "__bytes__") else addr

    @classmethod
    def native(cls) -> int:
        return cls.vm._balances.get(cls.contract_key(), 0)

    @classmethod
    def deposit(cls, value: int) -> None:
        if value:
            cls.vm._balances[cls.contract_key()] = cls.native() + value

    @classmethod
    def _deliver(cls, who: str, amount: int) -> None:
        cls.vm._balances[cls.contract_key()] = cls.native() - amount
        cls.received[who] = cls.received.get(who, 0) + amount

    @classmethod
    def finalize(cls) -> None:
        for who, amount in cls.pending:
            cls._deliver(who, amount)
        cls.pending = []

    @classmethod
    def to(cls, who) -> int:
        return cls.received.get(hx(who), 0)

    @classmethod
    def total(cls) -> int:
        return sum(cls.received.values())


class Wire:
    """Replaces the contract's `_Wire` interface."""

    def __init__(self, who):
        self.who = who

    def emit_transfer(self, **kw):
        amount = int(kw["value"])
        assert amount > 0, "a transfer of nothing"
        Chain.sent.append((hx(self.who), amount))
        if Chain.delayed:
            Chain.pending.append((hx(self.who), amount))
        else:
            Chain._deliver(hx(self.who), amount)


# ---- the web --------------------------------------------------------------------------------------------------------


class Web:
    """A dictionary of pages. A page is a string (status 200), a (status, body) pair, or an Exception to raise."""

    def __init__(self):
        self.pages = {}
        self.requests = []

    def serve(self, url: str, body, status: int = 200) -> None:
        self.pages[url] = (status, body)

    def drop(self, url: str) -> None:
        self.pages.pop(url, None)

    def render(self, url, mode="text"):
        """Stands in for gl.nondet.web.render: the visible text of the page, the way a browser would give it."""
        self.requests.append(url)
        hit = self.pages.get(url)
        if hit is None:
            raise RuntimeError("no such page")
        status, body = hit
        if isinstance(body, Exception):
            raise body
        if isinstance(body, bytes):
            body = body.decode("utf-8", errors="replace")
        text = re.sub(r"(?is)<script.*?</script>|<style.*?</style>|<!--.*?-->", " ", body)
        text = re.sub(r"(?s)<[^>]*>", " ", text)
        return " ".join(text.replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&").split())

    def handler(self, data):
        url = data.get("url", "")
        self.requests.append(url)
        hit = self.pages.get(url)
        if hit is None:
            return {"ok": {"response": {"status": 404, "headers": {}, "body": b""}}}
        status, body = hit
        if isinstance(body, Exception):
            raise body
        if isinstance(body, str):
            body = body.encode("utf-8")
        return {"ok": {"response": {"status": status, "headers": {}, "body": body}}}


# ---- the judge model ------------------------------------------------------------------------------------------------

def _last(tag: str):
    """The text of the last <tag>...</tag> pair (the instructions mention the tags once before the data)."""
    pattern = re.compile(rf"<{tag}>((?:(?!<{tag}>).)*?)</{tag}>", re.S)

    class _M:
        @staticmethod
        def search(text):
            found = list(pattern.finditer(text))
            return found[-1] if found else None

    return _M


_P1, _P2, _E1, _E2 = _last("pitch_1"), _last("pitch_2"), _last("evidence_1"), _last("evidence_2")
_Q = re.compile(r"\bQ=(\d{1,3})\b")


class Model:
    """A scripted judge. The quality of an entry is the `Q=nn` marker in its pitch (60 when absent); a `Q=nn` marker
    in the evidence text replaces it. Winner: the higher quality, a tie within `gap`.
      bias   None | "first" | "second"   always names the entry shown first / second (position bias)
      raw    a string or dict returned instead of the normal answer (odd outputs)
      script a list of replies used one by one before the normal behaviour
    Every prompt it saw is kept in `prompts`."""

    def __init__(self):
        self.bias = None
        self.raw = None
        self.gap = 0
        self.script = []
        self.prompts = []
        self.reason = "The entry serves the mission better."
        self.fail = None  # an exception to raise instead of answering

    @staticmethod
    def quality(pitch: str, evidence: str) -> int:
        m = _Q.search(evidence or "")
        if m is None:
            m = _Q.search(pitch or "")
        return int(m.group(1)) if m else 60

    def answer(self, prompt: str):
        self.prompts.append(prompt)
        if self.fail is not None:
            raise self.fail
        if self.script:
            return self.script.pop(0)
        if self.raw is not None:
            return self.raw
        p1, p2 = _P1.search(prompt), _P2.search(prompt)
        e1, e2 = _E1.search(prompt), _E2.search(prompt)
        q1 = self.quality(p1.group(1) if p1 else "", e1.group(1) if e1 else "")
        q2 = self.quality(p2.group(1) if p2 else "", e2.group(1) if e2 else "")
        if self.bias == "first":
            winner = "1"
        elif self.bias == "second":
            winner = "2"
        elif abs(q1 - q2) <= self.gap:
            winner = "tie"
        else:
            winner = "1" if q1 > q2 else "2"
        return {"winner": winner, "fit_1": q1, "fit_2": q2, "reason": self.reason}

    def handler(self, data):
        return {"ok": self.answer(data.get("prompt", ""))}


# ---- the deployed contract ------------------------------------------------------------------------------------------


def _forget_contract_class() -> None:
    """The SDK keeps one contract class per process; drop it so every test can deploy afresh."""
    for name in ("genlayer.gl.genvm_contracts", "genlayer.genvm_contracts"):
        registry = sys.modules.get(name)
        if registry is not None and hasattr(registry, "__known_contract__"):
            registry.__known_contract__ = None


class H:
    """The contract plus everything around it."""

    def __init__(self, c, vm, mod, model, web):
        self.c, self.vm, self.mod, self.model, self.web = c, vm, mod, model, web

    # -- raw calls --

    def call(self, who, fn, *args, value=0):
        """A write call by `who`. When it succeeds the attached value is added to the contract's native balance."""
        act(self.vm, who, value)
        try:
            out = getattr(self.c, fn)(*args)
        finally:
            self.vm.value = 0
        Chain.deposit(value)
        return out

    def view(self, fn, *args):
        return json.loads(getattr(self.c, fn)(*args))

    def refuse(self, msg, who, fn, *args, value=0):
        """The call must be refused with `msg` in the error and must leave the contract exactly as it was."""
        before = self.fingerprint()
        act(self.vm, who, value)
        with self.vm.expect_revert(msg):
            getattr(self.c, fn)(*args)
        self.vm.value = 0
        assert self.fingerprint() == before, f"a refused {fn} changed the contract"

    # -- views --

    def stats(self) -> dict:
        return self.view("stats")

    def books(self) -> dict:
        return self.view("solvency")

    def rnd(self, rid: int) -> dict:
        return _lowered(self.view("get_round", rid))

    def match(self, rid: int, i: int) -> dict:
        return self.view("get_match", rid, i)

    def credit(self, who) -> int:
        return int(self.c.credit_of(hx(who)))

    def fingerprint(self) -> str:
        s = self.stats()
        rounds = [self.rnd(i) for i in range(s["rounds"])]
        credits = sorted({e["who"] for r in rounds for e in r["entries"]} | {r["host"] for r in rounds})
        return json.dumps([s, self.books(), rounds, [self.credit(w) for w in credits], list(Chain.sent)], sort_keys=True)

    # -- steps --

    def new_round(
        self, host=P.host, prize=10 * MILLI, bond=MILLI, min_entries=3, max_entries=3, entry_window=3600,
        play_window=86400, min_fit=40, need_evidence=False, title=TITLE, mission=MISSION, value=None,
    ) -> int:
        return self.call(
            host, "create_round", title, mission, bond, min_entries, max_entries, entry_window, play_window, min_fit,
            need_evidence, value=prize if value is None else value,
        )

    def pitch(self, i: int, q=None) -> str:
        mark = f" Q={q}" if q is not None else ""
        return f"Entry number {i} builds a free community tool that helps readers check claims they meet online.{mark}"

    def join(self, rid: int, who, name=None, q=None, url="", pitch=None, bond=MILLI, i=None):
        index = (P.e.index(who) if who in P.e else 99) if i is None else i
        return self.call(
            who, "enter", rid, name or f"Entry {index}", pitch if pitch is not None else self.pitch(index, q), url,
            value=bond,
        )

    def fill(self, rid: int, qualities, urls=None, bond=MILLI):
        """Enter len(qualities) entrants (P.e[0], P.e[1], ...) with the given quality markers."""
        for i, q in enumerate(qualities):
            url = urls[i] if urls else ""
            self.join(rid, P.e[i], q=q, url=url, bond=bond)
        return P.e[: len(qualities)]

    def start(self, rid: int, who=P.stranger, offset=None):
        if offset is not None:
            at(self.vm, offset)
        self.call(who, "start_round", rid)

    def play(self, rid: int, who=P.runner, offset=None):
        if offset is not None:
            at(self.vm, offset)
        self.call(who, "play_next", rid)

    def play_all(self, rid: int, who=P.runner, start_offset=100, gap=1):
        """Run every match of a started round, one second apart."""
        n = self.rnd(rid)["match_count"]
        for k in range(n):
            at(self.vm, start_offset + k * gap)
            self.call(who, "play_next", rid)

    def finalize(self, rid: int, who=P.stranger, offset=None):
        if offset is not None:
            at(self.vm, offset)
        self.call(who, "finalize_round", rid)

    def claim(self, who):
        self.call(who, "claim")

    def run_round(self, qualities, urls=None, rid=None, **kw) -> int:
        """Open a round, fill it, start it, play every match and finalize it. Returns the round id."""
        at(self.vm, 0)
        n = len(qualities)
        rid = self.new_round(min_entries=n, max_entries=n, **kw) if rid is None else rid
        self.fill(rid, qualities, urls, bond=kw.get("bond", MILLI))
        at(self.vm, 50)
        self.start(rid)
        self.play_all(rid)
        self.finalize(rid, offset=200)
        return rid


def _lowered(row):
    """The contract reports checksummed addresses; the tests compare lower-case ones."""
    if isinstance(row, dict):
        for k, v in row.items():
            if k in ("host", "who") and isinstance(v, str):
                row[k] = v.lower()
            elif k == "entries":
                for e in v:
                    _lowered(e)
    return row


@pytest.fixture
def web():
    return Web()


@pytest.fixture
def model():
    return Model()


def deploy(direct_deploy, direct_vm, model=None, web=None, monkeypatch=None) -> H:
    at(direct_vm, 0)
    direct_vm.check_pickling = True  # the closures handed to the VM must be serializable
    _forget_contract_class()
    c = direct_deploy(CONTRACT)
    mod = sys.modules[MODULE]
    mod._Wire = Wire
    Chain.reset(direct_vm)
    model = model or Model()
    web = web or Web()
    direct_vm._live_llm_handler = model.handler
    direct_vm._live_web_handler = web.handler
    if monkeypatch is not None:
        monkeypatch.setattr(mod.gl.nondet.web, "render", web.render)  # the direct runner would return raw HTML
    for url in (EVIDENCE_A, EVIDENCE_B, EVIDENCE_C, EVIDENCE_D):
        web.serve(url, page(GOOD_TEXT))
    return H(c, direct_vm, mod, model, web)


@pytest.fixture
def h(direct_deploy, direct_vm, model, web, monkeypatch):
    return deploy(direct_deploy, direct_vm, model, web, monkeypatch)
