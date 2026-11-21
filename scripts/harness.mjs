// Small pieces of the live run that are worth testing on their own (see harness.test.mjs).
//
//   makePoller({ now, sleep })   until() and waitDecided(): polling that slows down instead of hammering the node
//   assessBalance(books, ledger) is the contract's native balance what the books say, plus the value Studionet kept?
//   keptValueOf(step)            how much of a transaction's attached value stayed in the contract although it was refused

/** Polling with a growing pause: first, first*factor, ... up to max (seconds). `now` is in ms and `sleep` takes ms. */
export function makePoller({ now, sleep }) {
  /** Calls get() until ok(value) holds or `timeout` seconds have passed. An error from get() counts as "not yet". Returns the last value. */
  async function until(get, ok, { timeout = 120, first = 2, factor = 1.5, max = 12 } = {}) {
    const deadline = now() + timeout * 1000;
    let delay = first * 1000;
    let last;
    for (;;) {
      try {
        last = await get();
        if (ok(last)) return last;
      } catch {
        /* try again */
      }
      if (now() + delay > deadline) return last;
      await sleep(delay);
      delay = Math.min(max * 1000, Math.round(delay * factor));
    }
  }

  /**
   * Waits until a transaction is decided and returns its receipt. The SDK's own waiting polls at a fixed pace and dies on the
   * first error; this asks it once per round (retries: 0 makes it answer "not decided yet" with an error), and waits 3 s,
   * 4.5 s, 6.75 s ... up to 15 s between rounds, so a transaction that the AI takes a minute over costs 8 calls and not 20.
   */
  async function waitDecided(client, hash, { first = 3, factor = 1.5, max = 15, timeout = 1500 } = {}) {
    if (typeof client.waitForDecision === "function") return client.waitForDecision({ hash, retries: Math.ceil(timeout / max), interval: max * 1000 });
    const deadline = now() + timeout * 1000;
    let delay = first * 1000;
    for (;;) {
      try {
        return await client.waitForTransactionReceipt({ hash, status: "ACCEPTED", retries: 0, interval: 0 });
      } catch (err) {
        // Not decided yet, or not visible yet: ask again. Anything else is a real failure.
        if (!/Timed out waiting for transaction|Transaction not found/i.test(String(err?.message ?? err))) throw err;
        if (now() + delay > deadline) throw new Error(`The transaction ${hash} was not decided within ${timeout} seconds.`);
      }
      await sleep(delay);
      delay = Math.min(max * 1000, Math.round(delay * factor));
    }
  }
  return { until, waitDecided };
}

/**
 * Studionet keeps the value that was attached to a payable call that the contract refused: the call is decided as
 * ACCEPTED / ERROR, its state changes are undone (so `deposited` does not move), but the money stays in the contract's balance.
 * The books cannot see it, so the balance check has to know about it:
 *
 *   native = deposited - claimed            what the books say is inside
 *          + baseline                       whatever the contract already held beyond its books before this run began
 *          + kept                           the value of this run's refused payable calls
 *
 * `ledger` = { baseline, kept, keptPossible } (bigint): `kept` counts calls whose refusal was read from the receipt,
 * `keptPossible` adds the ones whose outcome is unknown (the value may or may not have stayed).
 * Returns { state, extra, inside, lo, hi } with state
 *   "ok"        the balance is exactly what it should be (or within the range that unknown outcomes allow)
 *   "refunded"  more than the books but less than the kept value would add: Studionet gave back some or all of the value of refused
 *               calls. Nothing is missing and nothing is unexplained, so this passes (with a note)
 *   "surplus"   more is held than the books and the kept value explain: a transfer that is not finalized yet, or money nobody accounts for
 *   "short"     less is held than the books say: a transfer went out that the books do not show. This is the one that is a failure
 *   "unknown"   the contract could not tell its own balance
 */
export function assessBalance(b, ledger) {
  if (b?.native === null || b?.native === undefined) return { state: "unknown" };
  const inside = BigInt(b.deposited) - BigInt(b.claimed);
  const extra = BigInt(b.native) - inside - BigInt(ledger.baseline);
  const lo = BigInt(ledger.kept);
  const hi = BigInt(ledger.keptPossible);
  return { state: extra < 0n ? "short" : extra < lo ? "refunded" : extra > hi ? "surplus" : "ok", extra, inside, lo, hi };
}

/** What one recorded step adds to the ledger: { kept, possible } in wei (bigint). */
export function keptValueOf(step) {
  const value = BigInt(step.value ?? 0);
  if (value === 0n) return { kept: 0n, possible: 0n };
  if (step.hash && step.known === true && step.ok === false) return { kept: value, possible: value }; // decided as an error: the value stayed
  if (step.hash && step.known === false) return { kept: 0n, possible: value }; // decided, but the receipt could not be read
  if (!step.hash && step.thrown) return { kept: 0n, possible: value }; // the SDK failed somewhere between signing and the receipt: unknown
  return { kept: 0n, possible: 0n }; // it succeeded (a deposit that the books know), or it never left
}
