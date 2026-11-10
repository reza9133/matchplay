# Matchplay

**Head-to-head funding rounds where the judge has to say the same thing in both orders.**

Matchplay is an Intelligent Contract for [GenLayer](https://www.genlayer.com). A host puts up prize money for a
mission ("fund reference pages that explain reserved example domains to ordinary readers"). Entrants pay a small refundable bond and
submit a pitch with an optional evidence page. Every pair of entries then meets exactly once, in a fixed order, and an AI
judge decides each match. Points turn into money at a price that was fixed before the first match. What nobody earned
goes back to the host.

It is written for Studionet and contains no dependencies: one file, `contracts/matchplay.py`.

## Why it is built this way

Letting a language model decide who gets money is the easy part. Making it safe to do is the work, so the contract is
a small deterministic shell with the model in one narrow slot.

| Problem | What the contract does |
| --- | --- |
| A model that favours "the first answer" or "the second answer" (or a pitch that asks for it) | Every match is judged **twice, with the entries swapped**. An entry only wins when it wins in both orders. Otherwise the match is a tie. Position bias alone can never decide a match. |
| Paying for the best of a bad lot | Each entry is also scored **on its own** (0 to 100). It earns from a match only if the lower of its two scores reaches the host's **bar**. A match between two entries that miss the bar pays nobody. |
| A model that is wrong once | A match is worth exactly two points. Nobody can earn more than two points per rival, so one wrong verdict moves one match, never the round. |
| Prices that move while people play | The price of a point (`prize / (2 * matches)`) is **fixed when the round starts**. The prize can only grow while the round is open. |
| Money the host never meant to give away | What was not earned (unplayed matches, no-points matches, rounding dust, forfeited bonds) is credited back to the host. |
| Evidence pages that talk to the judge | A narrow tripwire flags pages that address the judge. The page is withheld, the entry can no longer score, and its bond goes to the host. A flagged entry is also not read again, so it cannot take points from rivals in later matches. |
| Pages that do not load | The match is retried (two minutes apart), and after three tries it is **voided**: nobody earns from it. The entry is not punished. |
| A leader that is more generous than the truth | Validators judge the match again and accept the leader's result only if it gives each side **no more** than their own reading. Disagreements drift towards "tie" and "nobody earns", never towards paying. |
| Nobody runs the matches | Anyone can run the next match. When the playing time ends, unplayed matches count as "nobody earns", and the round can be finalized by anyone. |
| Transfers that go wrong | State changes only credit a ledger. Money leaves in one place (`claim`). The books (`solvency`, `audit_books`) can always be checked against the contract's own balance. |

### What this does and does not defend against

* **Defended:** positional manipulation ("pick the first one"), a judge that cannot be trusted twice in a row, evidence
  that is unreadable, hosts who try to change the rules after the start, strangers who try to touch other people's money,
  rounding, replays and reordering.
* **Not fully defended:** *content* injection, a pitch or page that argues persuasively for itself in a way the tripwire
  does not know. Swapping the order does not cancel that, because the persuasive text is the same in both orders. The
  defences are the tripwire, the bar, and the small cap on damage described above. Treat the judge as a participant
  that can be wrong, not as an oracle.
* **Sybils:** one person can enter several addresses. Each entry costs a bond, only one entry per address and per
  evidence page or pitch is allowed, and the host can remove entries before the start. A round should be run
  with entrants the host is willing to judge.
* **Third-party pages:** the tripwire reads what the page shows at match time. If an entrant cites a page that others can edit,
  a rival could plant a steering sentence there. Entrants should cite pages they control.

## How a round works

```
              create_round (prize attached)
                         |
                       OPEN  ---- cancel_round (host, any time) --------> CANCELLED
   top_up (host)         |  \---- cancel_round (anyone, entry time over and too few entries)
   enter / withdraw_entry / remove_entry
                         |
          start_round (host once the minimum is there; anyone when the round is full or the entry time is over)
                         |
                      PLAYING  ---- play_next (anyone), one match per call, in the fixed order
                         |
          finalize_round (anyone, once every match is played or the playing time is over)
                         |
                       DONE  ---- claim (everyone, for what they are owed)
```

* **Entries.** 3 to 8 per round, one per address, the host cannot enter. A pitch is 40 to 600 characters, the evidence is
  one public `http(s)` link (no private addresses, no credentials, no odd ports). Two entries cannot share an evidence
  page (any spelling of the same link) or a pitch (spacing and punctuation do not disguise a copy).
* **Schedule.** Entries `0..n-1` meet in the order `(0,1) (0,2) ... (0,n-1) (1,2) ...`. `schedule_of(n)` returns it.
* **A match.** The leader reads both evidence pages, asks the model once with entry A first and once with B first, and
  combines the two answers (below). Validators repeat the whole thing and compare.
* **Time.** Entry window and playing window are chosen by the host (1 minute to 30 days). If the playing time ends before every match
  is played, `finalize_round` settles the rest as "nobody earns".

### How one match is decided

Reading 1 shows (A, B), reading 2 shows (B, A). Each reading returns a winner (`1`, `2` or `tie`) and a fit for both
entries. The fit of an entry is the **lower** of its two readings.

1. An entry **clears the bar** when its fit is at least `min_fit` and it is not flagged.
2. Neither clears: **nobody earns** (0 - 0).
3. Exactly one clears: it wins (2 - 0). The bar always wins over the model's "winner".
4. Both clear: the winner must be the same entry in **both** orders to win (2 - 0). Anything else is a **tie** (1 - 1).

### Where the money goes

```
prize (host)  = P         bond (each entrant) = b          matches M = n(n-1)/2         points 2M
price of a point u = floor(P / 2M)                         (fixed at start_round)
entrant payout     = points * u                            (flagged entries: 0)
entrant gets back  = payout + b                            (a flagged entry loses its bond)
host gets back     = P - sum(payouts) + forfeited bonds    (unearned prize, dust, forfeits)
```

Example: prize 0.012 GEN, bond 0.002 GEN, three entries. Three matches, six points, one point is worth 0.002 GEN. Points
4 / 2 / 0 pay 0.008 / 0.004 / 0 plus the bonds back; the host gets nothing back. If the judge finds that nobody clears the bar,
every point is unearned and the host gets the whole 0.012 GEN back.

Everything is **credited** first and **claimed** later, in one transfer per address:

* `credit_of(address)` is what an address can claim now (wei, as text).
* `claim()` sends it and clears it.
* `solvency()` shows `deposited - claimed == owed + locked`, and compares the contract's native balance with what the
  books say is inside (`in_sync`). The transfer is emitted when the transaction is finalized, so `in_sync` can be `false`
  for a short while after a claim on a network with a finality window.
* `audit_books()` recomputes the same from scratch by reading every round and every credit.

## Interface

### Write

| Method | Who | What |
| --- | --- | --- |
| `create_round(title, mission, entry_bond, min_entries, max_entries, entry_window, play_window, min_fit, need_evidence)` payable | anyone | Opens a round. The attached value (at least 0.002 GEN) is the prize. `entry_bond` at least 0.001 GEN, `min_fit` 0 to 90. Returns the round id. |
| `top_up(round_id)` payable | host | Adds to the prize while the round is open. |
| `enter(round_id, name, pitch, evidence_url)` payable | anyone but the host | Enters with exactly the entry bond. Returns the entry index. |
| `withdraw_entry(round_id)` | entrant | Leaves before the start; the bond is credited. |
| `remove_entry(round_id, entrant, reason)` | host | Turns an entry away before the start; the bond is credited. |
| `start_round(round_id)` | see above | Fixes the schedule and the price of a point. |
| `cancel_round(round_id)` | host, or anyone when the entry time is over without enough entries | Credits the prize and every bond back. |
| `play_next(round_id)` | anyone | Runs the next match (real model). A page that cannot be read is retried after two minutes, then voided. |
| `finalize_round(round_id)` | anyone | Ends the round and credits payouts, bonds and the host's return. |
| `claim()` | anyone | Sends the caller everything credited to them. |

### View

`get_round(id)` (with entries and matches), `list_rounds(offset, limit)`, `rounds_of(address, offset, limit)`,
`get_match(round_id, index)`, `credit_of(address)`, `schedule_of(entries)`, `would_steer(text)` (preview the tripwire on
a pitch or a page before entering), `stats()`, `solvency()`, `audit_books()`.

A match record carries `outcome` (`0` A wins, `1` B wins, `2` tie, `3` nobody earns), `by` (`1` judge, `2` void, `3` timeout) and a
`review` with both fits, the winner of each reading, the judge's one-sentence reasons and a SHA-256 of each page text.

### Errors

Every refusal is a plain sentence ("The round is full.", "Attach exactly the entry bond.", ...). A refused call
changes nothing: all checks run before the first state change, and the tests verify it for every refusal.

## Quick start

Requirements: Python 3.10+, Node 18+.

```bash
bash scripts/setup.sh          # python packages, a local GenVM runtime for the tests, node packages
npm run keys                   # five fresh Studionet accounts in .env, funded through the simulator
bash scripts/run-all.sh        # static check + local tests + live run on Studionet
```

Or step by step:

```bash
genvm-lint check contracts/matchplay.py        # static check
python3 -m pytest -q                           # 539 local tests, about two minutes, no network
bash rehearsal/run.sh                          # the live script against a simulated network, about one minute
npm run deploy                                 # deploys contracts/matchplay.py, writes .matchplay-address
npm run e2e                                    # the live run (deploys first when there is no address yet)
```

In GenLayer Studio you can instead paste `contracts/matchplay.py` into a new contract, deploy it with no
arguments and call the methods from the UI. Then run the live script against it with
`MATCHPLAY_ADDRESS=0x... npm run e2e`.

### The live run (`scripts/e2e.mjs`)

The AI is real, so its verdicts are not predictable. The script accepts any verdict and checks what must hold for all of them.

| Scenario | What it does | Time |
| --- | --- | --- |
| `basics` | open, top up, enter, withdraw, remove, cancel; claims every refund | 2 min |
| `adversarial` | about 40 calls that must be refused, each followed by "no totals changed"; then a round that nobody plays | 5 min |
| `cancel` | a cancelled round returns prize, top-up and bonds | 2 min |
| `timeout` | no one runs the matches; everything comes back | 3 min |
| `tournament` | the real model judges three entries (three matches, six model readings); payouts, claims, balances | 5 to 10 min |
| `strike` | an evidence page that talks to the judge; flag, forfeited bond | 5 to 10 min |
| `views` | paging, schedule, tripwire preview, books recomputed from scratch | 1 min |
| `void` (`--with-void`) | an evidence page that never loads: retried, then voided | about 10 min |

Useful options: `--only tournament,views`, `--with-void`, `--dry-run`. Accounts and options are read from `.env`
(see `.env.example`). Reports are written to `reports/matchplay-e2e-<time>.{html,md,json}` after every transaction,
and the HTML page refreshes itself while the run is going. The exit code is 1 when a check fails.

**Evidence that money really moved.** After every claim the script reads the contract's own balance and the recipient's
balance from the node and checks that the contract fell by exactly the credited amount and that the recipient gained
it (the report has a table "Money that really moved", with the claim transaction and whether a `FINALIZED` receipt was
seen). The transfer is emitted when the transaction is finalized, so the script waits up to `FINALITY_WAIT` seconds
(default 120) for it to arrive. A transfer that has not arrived is reported as a failed check, not hidden.

### The rehearsal (`rehearsal/run.sh`)

Runs the **same** `scripts/e2e.mjs` against a stand-in for the network: the real contract runs in the local test
runner, a stub plays `genlayer-js` and the node, and the clock runs 120 times faster. It checks the script's logic, not the
real model.

```bash
bash rehearsal/run.sh --with-void                   # an honest scripted judge
JUDGE=biased  bash rehearsal/run.sh --with-void     # a judge that always names the first entry
JUDGE=noisy   bash rehearsal/run.sh --with-void     # random scores and winners
JUDGE=flaky   bash rehearsal/run.sh --with-void     # transactions that fail now and then (exercises the retries)
FINALITY_DELAY=60 bash rehearsal/run.sh             # transfers arrive a minute after the claim
```

## Tests

`python3 -m pytest` runs the local suite on the real GenLayer SDK (genlayer-test direct mode). The judge model and the
web are scripted; the contract code is the real one.

| File | Covers |
| --- | --- |
| `test_text.py` | cleaning, the tripwire (hits and ordinary text that must not hit), links, page-to-text including hostile pages, the schedule, the full decision table, the validator acceptance rule |
| `test_rounds.py` | opening, topping up, entering, withdrawing, removing, starting, cancelling; every validation edge; paging |
| `test_play.py` | what a match turns into, position bias, the bar, steering pages, unreadable pages and retries, unusable model output, timeouts, exact payout arithmetic, an eight-entry round of 28 matches |
| `test_money.py` | claims, conservation of every wei, delayed transfers, refunds, odd amounts, huge prizes |
| `test_consensus.py` | the closures sent to the network are serializable and capture plain values only; honest validators agree; a more generous or different leader is refused |
| `test_adversarial.py` | a permission matrix (every call, every kind of caller, every state: 168 combinations), steering text, hostile pages, ordering and replay, sybils and squatters, bounded damage |
| `test_fuzz.py` | 14 random walks over the whole interface; after every call the books, round states and chain money are checked, and a refused call must change nothing |

## Troubleshooting

* **`404` when the tests start.** `genlayer-test` downloads the GenVM runtime of the newest release, and some release
  candidates do not carry that file. `scripts/setup.sh` puts a known-good runtime (v0.2.16, the one the contract's
  `py-genlayer` header names) into the cache first.
* **Studionet refuses the contract's header.** The header pins one GenVM runner hash, the same one the Leash project
  uses on Studionet. If Studionet moves on, update the `Depends` line to the hash that Studio
  shows for a freshly generated contract.
* **A model failure during `play_next`.** The transaction fails and changes nothing. Ask again; the live script retries three times.
* **Studionet reads lag.** The script re-reads until the state shows up (`until`), but a very slow node can still
  make a check fail; run the single scenario again with `--only`.
* **Evidence pages.** Use pages that are public, stable and not editable by others. Large pages are fine: only the first 1500
  characters of visible text are shown to the model.

## Limitations

* The tripwire is a phrase list and is kept narrow on purpose (a flagged page loses its bond). It will not catch every
  attempt; see "What this does and does not defend against".
* `claim` credits are cleared when the transfer is emitted; the contract cannot see whether a transfer was delivered, only
  compare its balance with its books (`solvency().in_sync`).
* A page that is unreachable for three tries two minutes apart voids a match for both entries, even when the outage was
  not the entrant's fault. Entries cannot be re-matched.
* The round size is capped at eight entries so that a full round (28 matches) can be played in a reasonable time.
* Studionet is a test network. Before using the contract elsewhere, review the validators' tolerance (the
  "never more generous" rule), the prompt against the validators' real models and the minimum amounts.

## Layout

```
contracts/matchplay.py      the contract
tests/direct/               local test suite (pytest)
scripts/e2e.mjs             live run on Studionet with a report that updates as it goes
scripts/deploy.mjs          deploys the contract to Studionet
scripts/keys.mjs            creates and funds test accounts (.env)
scripts/receipt.mjs         reads the outcome of a decided transaction
scripts/setup.sh            installs everything; scripts/run-all.sh runs everything
rehearsal/                  the offline stand-in for the network
.devcontainer/              GitHub Codespaces setup
reports/                    reports of live runs and of the local tests
```
