"""Backend of the offline rehearsal: runs the real contract in the direct runner and answers line-JSON requests.

It is started by rehearsal/run.sh (through pytest, because the direct runner lives in pytest fixtures) and talks to
the stub of genlayer-js over stdin and stdout. Nothing here touches a network.

What is simulated, and how it can be changed from the environment:
  * the judge       JUDGE=honest (default) | biased | noisy | flaky
                    honest: scores a pitch by how many words of the mission it uses, the higher score wins
                    biased: always names the entry shown first (position bias, which the contract must neutralize)
                    noisy:  random scores and winners (a model that cannot be relied on)
                    flaky:  honest, but a transaction fails now and then before the model answers
  * the web         a few fixed pages; the echo page repeats the query string; the "missing" page is a 404
  * the chain       transfers arrive at once, or FINALITY_DELAY chain-seconds after the transaction
"""

import json
import os
import random
import re
import sys
from datetime import datetime, timezone

import pytest

from conftest import *  # noqa: F401,F403  (the same helpers as the unit tests)
from conftest import GEN, MILLI, Chain, Model, Web, act, deploy, hx
import conftest

# the direct runner swaps file descriptor 0 for its own message, so keep a private copy of the real stdin first
_STDIN = os.fdopen(os.dup(0), "r")
MARK = "@@RPC "
JUDGE = os.environ.get("JUDGE", "honest")
FINALITY_DELAY = int(os.environ.get("FINALITY_DELAY", "0"))
CONTRACT_ADDRESS = os.environ.get("MATCHPLAY_ADDRESS", "0x" + "ab" * 20).lower()
START_FUNDS = 1000 * GEN

EXAMPLE_DOMAINS = (
    "<html><body><h1>Example Domains</h1><p>As described in RFC 2606 and RFC 6761, a number of domains such as "
    "example.com and example.org are maintained for documentation purposes. These domains may be used as illustrative "
    "examples in documents without prior coordination with us. They are not available for registration or transfer. "
    "We provide a web service on the example domains to provide basic information on the purpose of the domain, "
    "as well as links to this reference page.</p></body></html>"
)
RESERVED = (
    "<html><body><h1>IANA-managed Reserved Domains</h1><p>Certain domains are set aside, and nominally registered "
    "to IANA, for specific policy or technical purposes. Reserved names for documentation include example.com, "
    "example.net and example.org, and reserved top-level names such as .test, .example, .invalid and .localhost "
    "are described in the reference documents so that nobody registers them by mistake.</p></body></html>"
)
EXAMPLE_COM = "<html><body><h1>Example Domain</h1><p>This domain is for use in illustrative examples in documents. You may use this domain in literature without prior coordination.</p></body></html>"
KEYWORDS = ("domain", "reserved", "example", "documentation", "document", "explain", "reference", "guide")


def out(obj):
    sys.stdout.write(MARK + json.dumps(obj) + "\n")
    sys.stdout.flush()


def unbig(value):
    if isinstance(value, dict) and "$big" in value:
        return int(value["$big"])
    if isinstance(value, list):
        return [unbig(v) for v in value]
    return value


def score(text: str) -> int:
    """How many mission words a pitch uses, as a 0..100 fit."""
    n = sum(text.lower().count(k) for k in KEYWORDS)
    return min(95, 18 + 11 * n)


_PITCH = [re.compile(r"<pitch_1>((?:(?!<pitch_1>).)*?)</pitch_1>", re.S), re.compile(r"<pitch_2>((?:(?!<pitch_2>).)*?)</pitch_2>", re.S)]


class Judge(Model):
    """The scripted judge of the rehearsal."""

    def __init__(self, mode, seed=7):
        super().__init__()
        self.mode = mode
        self.rng = random.Random(seed)

    def answer(self, prompt):
        self.prompts.append(prompt)
        if self.fail is not None:
            raise self.fail
        texts = []
        for p in _PITCH:
            found = list(p.finditer(prompt))
            texts.append(found[-1].group(1) if found else "")
        f1, f2 = score(texts[0]), score(texts[1])
        if self.mode == "biased":
            return {"winner": "1", "fit_1": f1, "fit_2": f2, "reason": "The first entry reads better."}
        if self.mode == "noisy":
            return {
                "winner": self.rng.choice(["1", "2", "tie"]), "fit_1": self.rng.randint(0, 100), "fit_2": self.rng.randint(0, 100),
                "reason": "A guess.",
            }
        winner = "tie" if abs(f1 - f2) <= 4 else ("1" if f1 > f2 else "2")
        return {"winner": winner, "fit_1": f1, "fit_2": f2, "reason": "The entry that uses the mission's own terms serves it better."}


class RehearsalWeb(Web):
    def handler(self, data):
        url = data.get("url", "")
        if url.startswith("https://httpbin.org/anything"):
            self.requests.append(url)
            query = url.split("?", 1)[1] if "?" in url else ""
            args = query.replace("+", " ")
            body = json.dumps({"args": {"echo": args}, "url": url, "origin": "203.0.113.9"})
            return {"ok": {"response": {"status": 200, "headers": {}, "body": body.encode()}}}
        return super().handler(data)


class Net:
    """Money and time of the fake network."""

    def __init__(self, vm):
        self.vm = vm
        self.funded = {}
        self.spent = {}
        self.pending = []  # (due, who, amount)
        self.now = 0

    def release(self):
        keep = []
        for due, who, amount in self.pending:
            if due <= self.now:
                conftest.Chain._deliver(who, amount)
            else:
                keep.append((due, who, amount))
        self.pending = keep

    def balance(self, addr):
        addr = addr.lower()
        if addr == CONTRACT_ADDRESS:
            return Chain.native()
        base = self.funded.get(addr, START_FUNDS)
        return base + Chain.received.get(addr, 0) - self.spent.get(addr, 0)


def test_serve(direct_vm, direct_deploy, monkeypatch):
    vm = direct_vm
    web = RehearsalWeb()
    judge = Judge(JUDGE)
    h = deploy(direct_deploy, vm, judge, web, monkeypatch)
    c = h.c
    net = Net(vm)
    for url, body in (
        ("https://www.iana.org/help/example-domains", EXAMPLE_DOMAINS), ("https://www.iana.org/domains/reserved", RESERVED),
        ("https://example.com/", EXAMPLE_COM),
    ):
        web.serve(url, body)
    web.serve("https://www.iana.org/this-page-does-not-exist-matchplay-test", "", 404)
    flaky = random.Random(5)

    class DelayedWire(conftest.Wire):
        def emit_transfer(self, **kw):
            amount = int(kw["value"])
            assert amount > 0
            conftest.Chain.sent.append((hx(self.who), amount))
            if FINALITY_DELAY > 0:
                net.pending.append((net.now + FINALITY_DELAY, hx(self.who), amount))
            else:
                conftest.Chain._deliver(hx(self.who), amount)

    h.mod._Wire = DelayedWire
    out({"ready": True})
    for line in _STDIN:
        line = line.strip()
        if not line:
            continue
        req = json.loads(line)
        rid = req.get("id")
        try:
            now = int(req.get("now", 0))
            if now:
                net.now = now
                vm.warp(datetime.fromtimestamp(now, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
            net.release()
            op = req["op"]
            if op == "fund":
                net.funded[req["address"].lower()] = net.funded.get(req["address"].lower(), START_FUNDS) + int(req["amount"])
                out({"id": rid, "ok": True})
            elif op == "balance":
                out({"id": rid, "ok": True, "ret": str(net.balance(req["address"]))})
            elif op == "view":
                out({"id": rid, "ok": True, "ret": getattr(c, req["fn"])(*unbig(req["args"]))})
            elif op == "call":
                args = unbig(req["args"])
                sender = bytes.fromhex(req["sender"][2:])
                value = int(req.get("value", 0))
                if value and net.balance(req["sender"]) < value:
                    out({"id": rid, "ok": False, "rejected": True, "error": "insufficient funds for the attached value"})
                    continue
                judge.fail = None
                if JUDGE == "flaky" and req["fn"] == "play_next" and flaky.random() < 0.3:
                    judge.fail = RuntimeError("the model is overloaded")
                act(vm, sender, value)
                try:
                    getattr(c, req["fn"])(*args)
                finally:
                    vm.value = 0
                    judge.fail = None
                if value:
                    Chain.deposit(value)
                    net.spent[req["sender"].lower()] = net.spent.get(req["sender"].lower(), 0) + value
                out({"id": rid, "ok": True})
            else:
                out({"id": rid, "ok": False, "error": f"unknown op {op}"})
        except Exception as e:  # a refusal by the contract
            vm.value = 0
            out({"id": rid, "ok": False, "error": f"{type(e).__name__}: {e}"[:400]})
