"""The leader/validator pair of a match, exercised through the validators the direct runner captures: the closures
have to be serializable, honest validators agree, and a leader that is more generous than the validator's own
reading, or that saw different pages, is refused."""

import cloudpickle
import pytest

from conftest import *

from test_play import STEER_PAGE, go


def judged(h, qualities=(90, 70, 50), urls=None, **kw):
    """Play the first match and return (round id, the leader's result)."""
    rid = go(h, list(qualities), urls=urls, **kw)
    h.vm.clear_validators()
    h.play(rid, offset=100)
    return rid, dict(h.vm._captured_validators[-1][0])


def validate(h, **kw) -> bool:
    return h.vm.run_validator(**kw)


def test_the_closures_sent_to_the_network_can_be_serialized(h):
    judged(h)
    _, leader_fn, validator_fn = h.vm._captured_validators[-1]
    assert cloudpickle.loads(cloudpickle.dumps(leader_fn)) is not None
    assert cloudpickle.loads(cloudpickle.dumps(validator_fn)) is not None


def test_they_capture_plain_values_only(h):
    judged(h)
    _, leader_fn, validator_fn = h.vm._captured_validators[-1]
    for fn in (leader_fn, validator_fn):
        for cell in fn.__closure__ or ():
            value = cell.cell_contents
            assert isinstance(value, (str, int, list, bool, type(None))), type(value)


def test_an_honest_validator_agrees_with_the_leader(h):
    judged(h)
    assert validate(h) is True


def test_an_honest_validator_agrees_on_every_kind_of_result(h):
    h.model.gap = 100
    judged(h)  # a tie
    assert validate(h) is True
    h.model.gap = 0
    judged(h, qualities=(30, 20, 10), min_fit=40)  # nobody clears the bar
    assert validate(h) is True


def test_the_stored_review_is_the_leaders_result(h):
    rid, leader = judged(h)
    m = h.match(rid, 0)
    assert m["outcome"] == leader["outcome"]
    assert m["review"]["fit"] == leader["fit"] and m["review"]["win"] == leader["win"]


def test_a_validator_accepts_a_more_cautious_leader(h):
    rid, leader = judged(h)  # the validator will see A_WINS
    assert validate(h, leader_result=dict(leader, outcome=NEITHER)) is True


def test_a_validator_refuses_a_more_generous_leader(h):
    h.model.gap = 100
    rid, leader = judged(h)  # the validator will see TIE
    assert leader["outcome"] == TIE
    assert validate(h, leader_result=dict(leader, outcome=A_WINS)) is False
    assert validate(h, leader_result=dict(leader, outcome=B_WINS)) is False
    assert validate(h, leader_result=dict(leader, outcome=TIE)) is True
    assert validate(h, leader_result=dict(leader, outcome=NEITHER)) is True


def test_a_validator_refuses_a_leader_that_names_the_other_winner(h):
    rid, leader = judged(h)
    assert validate(h, leader_result=dict(leader, outcome=B_WINS)) is False
    assert validate(h, leader_result=dict(leader, outcome=TIE)) is False  # B would get a point


def test_a_validator_who_sees_a_weaker_result_refuses_a_stronger_leader(h):
    rid, leader = judged(h)
    h.model.bias = "first"  # the validator's own reading will be a tie (position bias cancels out)
    assert validate(h) is False  # the leader said A_WINS
    h.model.bias = None
    assert validate(h) is True


def test_a_validator_who_sees_a_win_refuses_a_tie_leader_but_accepts_one_that_awards_nothing(h):
    """A tie gives B a point the validator would not give; "nobody earns" gives nobody anything."""
    h.model.bias = "first"
    rid, leader = judged(h, min_fit=0)
    assert leader["outcome"] == TIE
    h.model.bias = None  # the validator now reads a clean win for A
    assert validate(h) is False
    assert validate(h, leader_result=dict(leader, outcome=NEITHER)) is True


def test_leader_error_is_not_accepted(h):
    judged(h)
    assert validate(h, leader_error=Exception("[LLM_ERROR] the judge failed")) is False


@pytest.mark.parametrize("junk", [None, 5, "x", [], [1, 2], {}, {"kind": "OK"}, {"kind": "OK", "outcome": 0}, {"kind": "UNREADABLE"}])
def test_garbage_from_the_leader_is_refused_without_raising(h, junk):
    judged(h)
    assert validate(h, leader_result=junk) is False


def test_malformed_but_plausible_leader_results_are_refused(h):
    rid, leader = judged(h)
    assert validate(h, leader_result=dict(leader, fit=[1, 2, 3])) is False
    assert validate(h, leader_result=dict(leader, win=["A"])) is False
    assert validate(h, leader_result=dict(leader, hash=["zz", ""])) is False
    assert validate(h, leader_result=dict(leader, reason="<b>bold</b>")) is False
    assert validate(h, leader_result=dict(leader, flagged=[1, 0])) is False
    assert validate(h, leader_result=dict(leader, outcome=True)) is False
    assert validate(h, leader_result=dict(leader, kind="UNREADABLE")) is False


def test_a_validator_who_reads_a_page_differently_refuses(h):
    rid, leader = judged(h, urls=[EVIDENCE_A, EVIDENCE_B, EVIDENCE_C])
    h.web.serve(EVIDENCE_A, STEER_PAGE)  # the validator's copy of the page tries to steer
    assert validate(h) is False  # leader saw it clean: the flagged sets differ
    h.web.serve(EVIDENCE_A, page(GOOD_TEXT))
    assert validate(h) is True


def test_a_leader_that_hid_a_steering_page_is_refused(h):
    rid, leader = judged(h, urls=[EVIDENCE_A, EVIDENCE_B, EVIDENCE_C])
    h.web.serve(EVIDENCE_A, STEER_PAGE)
    assert validate(h, leader_result=dict(leader, outcome=NEITHER)) is False


def test_a_leader_that_invented_a_strike_is_refused(h):
    rid, leader = judged(h, urls=[EVIDENCE_A, EVIDENCE_B, EVIDENCE_C])
    assert validate(h, leader_result=dict(leader, flagged=[1, 0], outcome=B_WINS)) is False


def test_unreadable_results_must_name_the_same_pages(h):
    h.web.serve(EVIDENCE_A, "", 404)
    rid = go(h, [60, 60, 60], urls=[EVIDENCE_A, EVIDENCE_B, EVIDENCE_C])
    h.vm.clear_validators()
    h.play(rid, offset=100)
    leader = dict(h.vm._captured_validators[-1][0])
    assert leader == {"kind": "UNREADABLE", "bad": [1, 0], "flagged": [0, 0]}
    assert validate(h) is True
    assert validate(h, leader_result=dict(leader, bad=[0, 1])) is False
    assert validate(h, leader_result=dict(leader, bad=[1, 1])) is False
    h.web.serve(EVIDENCE_A, page(GOOD_TEXT))  # the validator can read it: the leader's "unreadable" is refused
    assert validate(h) is False


def test_a_leader_that_claims_a_page_is_readable_when_the_validator_cannot_read_it(h):
    rid, leader = judged(h, urls=[EVIDENCE_A, EVIDENCE_B, EVIDENCE_C])
    h.web.serve(EVIDENCE_A, "", 404)
    assert validate(h) is False


def test_a_validator_whose_model_fails_raises_instead_of_voting(h):
    judged(h)
    h.model.fail = RuntimeError("model down")
    with pytest.raises(Exception):
        validate(h)


def test_a_validator_never_changes_the_contract(h):
    rid, leader = judged(h)
    before = h.fingerprint()
    validate(h)
    validate(h, leader_result=dict(leader, outcome=B_WINS))
    assert h.fingerprint() == before


def test_both_orders_are_asked_by_the_validator_too(h):
    judged(h)
    before = len(h.model.prompts)
    validate(h)
    assert len(h.model.prompts) - before == 2
