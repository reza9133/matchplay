from conftest import *


def test_deploys_and_runs_a_whole_round(h):
    rid = h.run_round([90, 70, 50])
    r = h.rnd(rid)
    assert r["state"] == DONE
    pts = {e["index"]: e["points"] for e in r["entries"]}
    assert pts == {0: 4, 1: 2, 2: 0}
    assert [e["rank"] for e in r["entries"]] == [1, 2, 3]
    assert h.books()["balanced"]
    for i in range(3):
        h.claim(P.e[i]) if h.credit(P.e[i]) else None
    h.claim(P.host) if h.credit(P.host) else None
    assert h.books()["balanced"] and h.books()["in_sync"]
