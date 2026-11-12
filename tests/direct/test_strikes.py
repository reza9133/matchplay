"""Strikes found at different moments. Whenever an entry's page starts to talk to the judge, every match of the round
ends as if that entry had been flagged from the start, whatever the order in which the strikes were found. Checked
against a separate computation of the rules over many random rounds."""

import random

import pytest

from conftest import *

from test_play import STEER_PAGE, go

SEEDS = list(range(48))
SEEN = {"rounds": 0, "rescored": 0, "flagged": 0, "both": 0}


def expected_outcome(qa, qb, flags, bar):
    """The rules written out again. A flagged entry never clears the bar. With one entry clear it wins; with both clear
    the judge's winner takes the match (the judge here prefers the higher quality in both orders), equal quality is a
    tie; with none clear nobody earns."""
    clear_a = qa >= bar and not flags[0]
    clear_b = qb >= bar and not flags[1]
    if not clear_a and not clear_b:
        return NEITHER
    if clear_a and not clear_b:
        return A_WINS
    if clear_b and not clear_a:
        return B_WINS
    if qa > qb:
        return A_WINS
    if qb > qa:
        return B_WINS
    return TIE


@pytest.mark.parametrize("seed", SEEDS)
def test_every_match_ends_as_if_the_flagged_entries_had_been_flagged_from_the_start(h, seed):
    rng = random.Random(1000 + seed)
    n = rng.randint(3, 6)
    q = [rng.choice([5, 25, 30, 40, 45, 60, 75, 90, 90]) for _ in range(n)]
    bar = rng.choice([0, 30, 40, 70])
    urls = [EVIDENCE_A, EVIDENCE_B, EVIDENCE_C, EVIDENCE_D, "https://docs.example.org/e5", "https://docs.example.org/e6"][:n]
    for u in urls:
        h.web.serve(u, page(GOOD_TEXT))  # clean pages without a quality marker: the pitch alone sets the quality
    pairs = [(a, b) for a in range(n) for b in range(a + 1, n)]
    # for every entry, the match before which its page turns into steering text (None: it never does)
    poison_at = [rng.choice([None, None] + list(range(len(pairs)))) for _ in range(n)]

    rid = go(h, q, urls=urls, min_fit=bar)
    for k in range(len(pairs)):
        for e in range(n):
            if poison_at[e] == k:
                h.web.serve(urls[e], STEER_PAGE)
        h.play(rid, offset=100 + k)
    h.finalize(rid, offset=300)

    # a page is read in every match of its entry, so the entry is flagged when any of its matches comes at or after the poisoning
    flagged = [poison_at[e] is not None and any(e in p for j, p in enumerate(pairs) if j >= poison_at[e]) for e in range(n)]
    want = [expected_outcome(q[a], q[b], [flagged[a], flagged[b]], bar) for a, b in pairs]
    got = [h.match(rid, j)["outcome"] for j in range(len(pairs))]
    assert got == want, (seed, q, bar, poison_at, flagged)

    pts = [0] * n
    for (a, b), outcome in zip(pairs, want):
        pa, pb = POINTS[outcome]
        pts[a] += pa
        pts[b] += pb
    assert all(pts[e] == 0 for e in range(n) if flagged[e])

    r = h.rnd(rid)
    unit = int(r["price_per_point"])
    assert [e["flagged"] for e in r["entries"]] == flagged
    assert [e["points"] for e in r["entries"]] == pts
    for e in range(n):
        assert int(r["entries"][e]["payout"]) == pts[e] * unit
        assert h.credit(P.e[e]) == (0 if flagged[e] else pts[e] * unit + MILLI)
    assert int(r["paid_out"]) == sum(pts) * unit
    assert int(r["returned"]) == 10 * MILLI - sum(pts) * unit + MILLI * sum(flagged)
    assert h.credit(P.host) == int(r["returned"])
    assert h.books()["balanced"] and h.view("audit_books")["ok"]
    assert sum(pts) <= 2 * len(pairs)  # a match never gives more than two points, so the prize cannot be overdrawn

    SEEN["rounds"] += 1
    SEEN["rescored"] += sum("rescored" in h.match(rid, j)["review"] for j in range(len(pairs)))
    SEEN["flagged"] += sum(flagged)
    SEEN["both"] += sum(1 for a, b in pairs if flagged[a] and flagged[b])


def test_the_random_rounds_include_late_strikes_and_double_strikes():
    """A check on the test above: it only proves something when strikes really came late and in pairs. (It reads what
    the rounds above recorded, so it is skipped when run on its own.)"""
    if SEEN["rounds"] < len(SEEDS):
        pytest.skip("run the whole file to collect what all the rounds did")
    assert SEEN["flagged"] >= 20 and SEEN["rescored"] >= 10 and SEEN["both"] >= 3, SEEN
