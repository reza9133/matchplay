"""Where the money goes: claims, refunds, conservation of every wei, and the books against the contract's native
balance when transfers arrive at once and when they only arrive after the network finalizes them."""

import pytest

from conftest import *


def finished(h, qualities=(90, 70, 50), prize=12 * MILLI, **kw):
    return h.run_round(list(qualities), prize=prize, **kw)


def claim_everyone(h, actors):
    for who in actors:
        if h.credit(who):
            h.claim(who)


# ---- claiming -------------------------------------------------------------------------------------------------------


def test_claim_sends_the_credit_and_clears_it(h):
    finished(h)
    assert h.credit(P.e[0]) == 9 * MILLI
    h.claim(P.e[0])
    assert Chain.to(P.e[0]) == 9 * MILLI and h.credit(P.e[0]) == 0
    b = h.books()
    assert b["claimed"] == str(9 * MILLI) and b["balanced"] and b["in_sync"]
    assert h.stats()["claims"] == 1


def test_every_role_can_claim_what_it_is_owed(h):
    rid = finished(h, qualities=(30, 20, 10), min_fit=40)  # nobody earns: the host gets the prize back
    claim_everyone(h, [P.host] + P.e[:3])
    assert Chain.to(P.host) == 12 * MILLI
    assert all(Chain.to(e) == MILLI for e in P.e[:3])
    b = h.books()
    assert b["owed"] == "0" and b["locked"] == "0" and b["balanced"] and b["in_sync"]
    assert Chain.native() == 0


def test_claim_refusals(h):
    finished(h)
    h.refuse("nothing to claim", P.stranger, "claim")
    h.refuse("nothing to claim", P.runner, "claim")
    h.claim(P.e[0])
    h.refuse("nothing to claim", P.e[0], "claim")  # not twice
    assert Chain.to(P.e[0]) == 9 * MILLI


def test_a_credit_belongs_to_one_address_only(h):
    finished(h)
    before = h.credit(P.e[1])
    h.claim(P.e[0])
    assert h.credit(P.e[1]) == before and h.credit(P.e[0]) == 0


def test_credits_from_several_rounds_are_sent_in_one_transfer(h):
    finished(h)
    h.run_round([60, 60, 60], prize=6 * MILLI)  # a second round: the same entrants again
    first = h.credit(P.e[0])
    assert first > 9 * MILLI
    h.claim(P.e[0])
    assert len(Chain.sent) == 1 and Chain.to(P.e[0]) == first


def test_the_host_of_two_rounds_claims_both_returns_at_once(h):
    h.run_round([30, 20, 10], prize=4 * MILLI, min_fit=40)
    h.run_round([30, 20, 10], prize=6 * MILLI, min_fit=40)
    assert h.credit(P.host) == 10 * MILLI
    h.claim(P.host)
    assert Chain.to(P.host) == 10 * MILLI


def test_everything_paid_in_comes_out_exactly(h):
    h.run_round([90, 70, 50], prize=10 * MILLI + 7)
    h.run_round([95, 85, 25, 15], prize=24 * MILLI + 3, min_fit=50)
    at(h.vm, 0)
    cancelled = h.new_round(prize=5 * MILLI, host=P.other_host)
    h.fill(cancelled, [60, 60])
    h.call(P.other_host, "cancel_round", cancelled)
    actors = [P.host, P.other_host] + P.e[:4]
    claim_everyone(h, actors)
    s = h.stats()
    assert s["owed"] == "0" and s["locked"] == "0"
    assert Chain.total() == int(s["deposited"]) == int(s["claimed"])
    assert Chain.native() == 0
    assert h.books()["balanced"] and h.books()["in_sync"]


# ---- refunds --------------------------------------------------------------------------------------------------------


def test_withdrawn_bond_is_claimable_and_the_round_goes_on(h):
    at(h.vm, 0)
    rid = h.new_round(min_entries=3, max_entries=4)
    h.fill(rid, [60, 60, 60, 60])
    h.call(P.e[3], "withdraw_entry", rid)
    h.claim(P.e[3])
    assert Chain.to(P.e[3]) == MILLI
    h.start(rid, P.host, offset=50)  # the host may start early once the minimum is there
    assert h.rnd(rid)["entry_count"] == 3 and h.books()["balanced"]


def test_a_cancelled_round_returns_prize_and_bonds(h):
    at(h.vm, 0)
    rid = h.new_round(prize=7 * MILLI)
    h.fill(rid, [60, 60])
    h.call(P.host, "top_up", rid, value=3 * MILLI)
    h.call(P.host, "cancel_round", rid)
    claim_everyone(h, [P.host, P.e[0], P.e[1]])
    assert Chain.to(P.host) == 10 * MILLI and Chain.to(P.e[0]) == Chain.to(P.e[1]) == MILLI
    assert h.books()["owed"] == "0" and Chain.native() == 0


def test_a_removed_entrant_gets_the_bond_back(h):
    at(h.vm, 0)
    rid = h.new_round()
    h.fill(rid, [60, 60, 60])
    h.call(P.host, "remove_entry", rid, hx(P.e[2]), "does not match the mission")
    h.claim(P.e[2])
    assert Chain.to(P.e[2]) == MILLI


def test_top_up_money_is_paid_out_like_the_rest(h):
    at(h.vm, 0)
    rid = h.new_round(prize=6 * MILLI)
    h.call(P.host, "top_up", rid, value=6 * MILLI)
    h.fill(rid, [90, 70, 50])
    h.start(rid, offset=50)
    assert h.rnd(rid)["price_per_point"] == str(2 * MILLI)
    h.play_all(rid)
    h.finalize(rid, offset=300)
    assert h.credit(P.e[0]) == 8 * MILLI + MILLI


# ---- the books against the native balance ---------------------------------------------------------------------------


def test_the_books_balance_after_every_single_step(h):
    at(h.vm, 0)
    steps = []
    rid = h.new_round(prize=9 * MILLI)
    steps.append("create")
    assert h.books()["balanced"]
    h.call(P.host, "top_up", rid, value=MILLI)
    assert h.books()["balanced"]
    for i in range(3):
        h.join(rid, P.e[i], q=[90, 60, 30][i])
        assert h.books()["balanced"] and h.books()["in_sync"]
    h.call(P.e[2], "withdraw_entry", rid)
    assert h.books()["balanced"]
    h.join(rid, P.e[2], q=30)
    h.start(rid, offset=50)
    for k in range(3):
        h.play(rid, offset=100 + k)
        assert h.books()["balanced"] and h.view("audit_books")["ok"]
    h.finalize(rid, offset=300)
    assert h.books()["balanced"] and h.view("audit_books")["ok"]
    for who in [P.host] + P.e[:3]:
        if h.credit(who):
            h.claim(who)
            assert h.books()["balanced"] and h.books()["in_sync"]


def test_delayed_finality_shows_in_the_books_until_the_network_catches_up(h):
    finished(h)
    Chain.delayed = True
    h.claim(P.e[0])
    b = h.books()
    assert b["balanced"] is True  # the books themselves are right
    assert b["in_sync"] is False and int(b["native"]) == int(b["deposited"]) - int(b["claimed"]) + 9 * MILLI
    assert Chain.to(P.e[0]) == 0
    Chain.finalize()
    b = h.books()
    assert Chain.to(P.e[0]) == 9 * MILLI and b["in_sync"] is True and b["balanced"]


def test_a_pending_transfer_cannot_be_claimed_twice(h):
    finished(h)
    Chain.delayed = True
    h.claim(P.e[0])
    h.refuse("nothing to claim", P.e[0], "claim")
    Chain.finalize()
    assert Chain.to(P.e[0]) == 9 * MILLI


def test_money_paid_in_while_a_transfer_is_pending_does_not_confuse_the_books(h):
    finished(h)
    Chain.delayed = True
    h.claim(P.e[0])
    at(h.vm, 0)
    rid = h.new_round(prize=4 * MILLI, host=P.other_host)
    assert h.books()["balanced"] and h.books()["in_sync"] is False
    Chain.finalize()
    assert h.books()["in_sync"] is True
    assert h.rnd(rid)["state"] == OPEN


def test_a_transfer_that_never_arrives_stays_visible(h):
    finished(h)
    Chain.delayed = True
    h.claim(P.e[0])
    b = h.books()
    assert b["in_sync"] is False and b["claimed"] == str(9 * MILLI)  # the shortfall is the amount in flight


def test_solvency_before_anything_happens(h):
    b = h.books()
    assert b == {"deposited": "0", "claimed": "0", "owed": "0", "locked": "0", "balanced": True, "native": "0", "in_sync": True}
    assert h.view("audit_books") == {"ok": True, "owed": "0", "locked": "0"}


def test_audit_books_notices_a_corrupted_counter(h):
    finished(h)
    c = h.c
    c.owed = h.mod.u256(1)  # not reachable through the public interface: the audit must catch it if it ever happened
    assert h.view("audit_books")["ok"] is False
    assert h.books()["balanced"] is False


# ---- amounts --------------------------------------------------------------------------------------------------------


@pytest.mark.parametrize("prize", [2 * MILLI, 2 * MILLI + 1, 10**18, 10**18 + 123456789, 33 * 10**15 + 1])
def test_any_prize_is_paid_out_to_the_last_wei(h, prize):
    rid = h.run_round([90, 70, 50], prize=prize)
    claim_everyone(h, [P.host] + P.e[:3])
    assert Chain.total() == prize + 3 * MILLI
    assert h.books()["owed"] == "0" and Chain.native() == 0


@pytest.mark.parametrize("bond", [MILLI, MILLI + 1, 10**18])
def test_any_bond_comes_back_in_full(h, bond):
    rid = h.run_round([90, 70, 50], prize=6 * MILLI, bond=bond)
    claim_everyone(h, [P.host] + P.e[:3])
    assert Chain.total() == 6 * MILLI + 3 * bond and Chain.native() == 0


def test_a_huge_prize_does_not_overflow(h):
    big = 10**27
    rid = h.run_round([90, 70, 50], prize=big)
    claim_everyone(h, [P.host] + P.e[:3])
    assert Chain.total() == big + 3 * MILLI and Chain.native() == 0
