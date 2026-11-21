// Tests of scripts/harness.mjs. Run: node --test scripts/harness.test.mjs   (or: npm test)
import { test } from "node:test";
import assert from "node:assert/strict";
import { makePoller, assessBalance, keptValueOf } from "./harness.mjs";

const MILLI = 10n ** 15n;

/** A clock that only moves when the code sleeps, so that nothing here waits for real. */
function fakeTime() {
  let t = 0;
  const sleeps = [];
  return { now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; }, sleeps };
}

// ---- until -------------------------------------------------------------------------------------------------------------

test("until returns at once when the first read is already right", async () => {
  const time = fakeTime();
  const { until } = makePoller(time);
  assert.equal(await until(async () => 5, (v) => v === 5), 5);
  assert.deepEqual(time.sleeps, []);
});

test("until slows down: 2 s, 3 s, 4.5 s, 6.75 s ... up to the cap", async () => {
  const time = fakeTime();
  const { until } = makePoller(time);
  let n = 0;
  await until(async () => ++n, (v) => v === 9, { timeout: 600 });
  assert.deepEqual(time.sleeps, [2000, 3000, 4500, 6750, 10125, 12000, 12000, 12000]);
});

test("until treats an error from the read as 'not yet' and keeps going", async () => {
  const time = fakeTime();
  const { until } = makePoller(time);
  let n = 0;
  const v = await until(async () => { if (++n < 3) throw new Error("gateway"); return "fine"; }, (x) => x === "fine");
  assert.equal(v, "fine");
  assert.equal(n, 3);
});

test("until gives back the last value when the time is up, without sleeping past the deadline", async () => {
  const time = fakeTime();
  const { until } = makePoller(time);
  let n = 0;
  const v = await until(async () => ++n, () => false, { timeout: 10 });
  assert.equal(v, n);
  assert.ok(time.now() <= 10_000, `slept ${time.now()} ms`);
});

// ---- waitDecided -------------------------------------------------------------------------------------------------------

const timedOut = (h) => new Error(`Timed out waiting for transaction ${h} to reach status "ACCEPTED" (current status: PENDING).`);

test("waitDecided asks once per round and backs off 3 s, 4.5 s, 6.75 s ... 15 s", async () => {
  const time = fakeTime();
  const { waitDecided } = makePoller(time);
  let asked = 0;
  const client = {
    async waitForTransactionReceipt(o) {
      assert.equal(o.retries, 0, "the SDK must only look once per round");
      if (++asked < 9) throw timedOut(o.hash);
      return { statusName: "ACCEPTED" };
    },
  };
  assert.deepEqual(await waitDecided(client, "0xabc"), { statusName: "ACCEPTED" });
  assert.equal(asked, 9);
  assert.deepEqual(time.sleeps, [3000, 4500, 6750, 10125, 15000, 15000, 15000, 15000]);
});

test("waitDecided also waits through 'Transaction not found' (the node can lag a moment behind a new hash)", async () => {
  const time = fakeTime();
  const { waitDecided } = makePoller(time);
  let asked = 0;
  const client = { async waitForTransactionReceipt() { if (++asked < 3) throw new Error("Transaction not found: 0xabc"); return "receipt"; } };
  assert.equal(await waitDecided(client, "0xabc"), "receipt");
  assert.equal(asked, 3);
});

test("waitDecided does not hide a real failure", async () => {
  const { waitDecided } = makePoller(fakeTime());
  const client = { async waitForTransactionReceipt() { throw new Error("UnknownRpcError: An unknown RPC error occurred."); } };
  await assert.rejects(waitDecided(client, "0xabc"), /unknown RPC error/);
});

test("waitDecided stops after the timeout with a message that names the transaction", async () => {
  const time = fakeTime();
  const { waitDecided } = makePoller(time);
  const client = { async waitForTransactionReceipt(o) { throw timedOut(o.hash); } };
  await assert.rejects(waitDecided(client, "0xfeed", { timeout: 60 }), /0xfeed was not decided within 60 seconds/);
  assert.ok(time.now() <= 60_000);
});

test("waitDecided uses the SDK's own waitForDecision when a newer SDK has one", async () => {
  const { waitDecided } = makePoller(fakeTime());
  let seen;
  const client = { async waitForDecision(o) { seen = o; return "decided"; }, async waitForTransactionReceipt() { throw new Error("must not be used"); } };
  assert.equal(await waitDecided(client, "0xabc"), "decided");
  assert.equal(seen.hash, "0xabc");
  assert.ok(seen.interval >= 10_000, "a slow pace, not 3 s");
});

// ---- the balance against the books ---------------------------------------------------------------------------------------

const books = (native, deposited, claimed) => ({ native: String(native), deposited: String(deposited), claimed: String(claimed) });

test("the live run of 2026-11-12: 0.038 GEN held, 0.006 GEN in the books, 0.032 GEN attached to refused calls -> ok", () => {
  // Numbers from the run: deposited 0.034, claimed 0.028 (cancel scenario), native 0.038.
  const b = books(38n * MILLI, 34n * MILLI, 28n * MILLI);
  assert.equal(assessBalance(b, { baseline: 0n, kept: 32n * MILLI, keptPossible: 32n * MILLI }).state, "ok");
  // ... and without knowing about the kept value it is the false alarm that was reported
  const old = assessBalance(b, { baseline: 0n, kept: 0n, keptPossible: 0n });
  assert.equal(old.state, "surplus");
  assert.equal(old.extra, 32n * MILLI);
});

test("a deployment that already held stray money before the run is judged by what changed during the run", () => {
  const b = books(38n * MILLI, 34n * MILLI, 28n * MILLI);
  assert.equal(assessBalance(b, { baseline: 32n * MILLI, kept: 0n, keptPossible: 0n }).state, "ok");
});

test("a claim whose transfer is not finalized yet shows as a surplus (so the run waits), not as ok", () => {
  const b = books(40n * MILLI, 34n * MILLI, 30n * MILLI); // 2 mGEN claimed, still in the balance
  assert.equal(assessBalance(b, { baseline: 0n, kept: 0n, keptPossible: 0n }).state, "surplus");
});

test("money missing from the contract is 'short', never excused by the kept value", () => {
  const b = books(2n * MILLI, 10n * MILLI, 6n * MILLI); // should hold 4
  const r = assessBalance(b, { baseline: 0n, kept: 0n, keptPossible: 0n });
  assert.equal(r.state, "short");
  assert.equal(r.extra, -2n * MILLI);
  // when 2 mGEN of refused value was expected to be kept, the shortfall is even larger
  assert.equal(assessBalance(b, { baseline: 0n, kept: 2n * MILLI, keptPossible: 2n * MILLI }).state, "short");
});

test("Studionet gave back some or all of the refused value: nothing is missing, so it passes as 'refunded'", () => {
  const ledger = { baseline: 0n, kept: 5n * MILLI, keptPossible: 5n * MILLI };
  assert.equal(assessBalance(books(13n * MILLI, 10n * MILLI, 0n), ledger).state, "refunded"); // 3 of 5 stayed
  assert.equal(assessBalance(books(10n * MILLI, 10n * MILLI, 0n), ledger).state, "refunded"); // all of it came back
});

test("a refund never excuses a balance below the books", () => {
  const ledger = { baseline: 0n, kept: 5n * MILLI, keptPossible: 5n * MILLI };
  assert.equal(assessBalance(books(9n * MILLI, 10n * MILLI, 0n), ledger).state, "short");
});

test("an outcome that could not be read allows the whole range", () => {
  const ledger = { baseline: 0n, kept: 2n * MILLI, keptPossible: 4n * MILLI };
  for (const extra of [2n, 3n, 4n]) assert.equal(assessBalance(books(10n * MILLI + extra * MILLI, 10n * MILLI, 0n), ledger).state, "ok");
  assert.equal(assessBalance(books(15n * MILLI, 10n * MILLI, 0n), ledger).state, "surplus");
  assert.equal(assessBalance(books(11n * MILLI, 10n * MILLI, 0n), ledger).state, "refunded"); // 1 of at least 2
  assert.equal(assessBalance(books(9n * MILLI, 10n * MILLI, 0n), ledger).state, "short");
});

test("a contract that cannot tell its balance is not judged", () => {
  assert.equal(assessBalance({ native: null, deposited: "1", claimed: "0" }, { baseline: 0n, kept: 0n, keptPossible: 0n }).state, "unknown");
});

test("amounts beyond 2^53 are compared exactly", () => {
  const b = books(10n ** 24n + 7n, 10n ** 24n, 0n);
  assert.equal(assessBalance(b, { baseline: 0n, kept: 7n, keptPossible: 7n }).state, "ok");
  assert.equal(assessBalance(b, { baseline: 0n, kept: 6n, keptPossible: 6n }).state, "surplus");
});

// ---- what a step leaves behind -----------------------------------------------------------------------------------------------

test("keptValueOf: a refused payable call keeps its value, a successful one does not", () => {
  const v = (2n * MILLI).toString();
  assert.deepEqual(keptValueOf({ value: v, hash: "0x1", known: true, ok: false }), { kept: 2n * MILLI, possible: 2n * MILLI });
  assert.deepEqual(keptValueOf({ value: v, hash: "0x1", known: true, ok: true }), { kept: 0n, possible: 0n });
});

test("keptValueOf: an unpaid call keeps nothing", () => {
  assert.deepEqual(keptValueOf({ value: "0", hash: "0x1", known: true, ok: false }), { kept: 0n, possible: 0n });
  assert.deepEqual(keptValueOf({}), { kept: 0n, possible: 0n });
});

test("keptValueOf: an unreadable receipt, or an SDK failure after signing, is only 'possible'", () => {
  const v = (2n * MILLI).toString();
  assert.deepEqual(keptValueOf({ value: v, hash: "0x1", known: false, ok: false }), { kept: 0n, possible: 2n * MILLI });
  assert.deepEqual(keptValueOf({ value: v, thrown: true, ok: false }), { kept: 0n, possible: 2n * MILLI });
});
