// Reads the outcome of a decided transaction without depending on one exact receipt shape (same approach as the
// project's scripts/receipt.mjs). A receipt without a readable result never counts as a success.
const replacer = (_k, v) => (typeof v === "bigint" ? v.toString() : v);
const dump = (v) => {
  try {
    return JSON.stringify(v ?? null, replacer) ?? "";
  } catch {
    return String(v);
  }
};
const FAIL = /ERROR|REVERT|FAIL/i;
const PASS = /RETURN|SUCCESS/i;

export const leaderOf = (r) => r?.consensus_data?.leader_receipt?.[0] ?? r?.data?.leader_receipt?.[0] ?? r?.leader_receipt?.[0];

// Every sentence the contract can refuse with, so a refusal is shown in plain words.
export const CONTRACT_ERRORS = [
  "A round has 2 to 8 entries.", "An entry can only be withdrawn while the round is open.", "Attach at least 0.002 GEN as the prize.",
  "Attach exactly the entry bond.", "Entries can only be removed while the round is open.", "Every match has been played. Call finalize_round.",
  "Give a reason of 3 to 160 characters.", "Matches are still being played.", "No such match.", "No such round.",
  "Only an open round can be cancelled.", "Only the host can cancel, unless the entry time is over without enough entries.",
  "Only the host can do that.", "Send some GEN to add to the prize.", "That address has no entry in this round.",
  "That evidence page already backs another entry.", "That is more than the contract accepts.", "That is not a valid address.",
  "That pitch is already used by another entry.", "The bar has to be between 0 and 90.", "The entry bond has to be at least 0.001 GEN.",
  "The entry time is not over and the round is not full.", "The entry time is over.", "The entry window has to be between 1 minute and 30 days.",
  "The evidence must be a single public http(s) link.", "The host cannot enter their own round.", "The judge returned an unusable result.",
  "The mission needs 30 to 1000 characters.", "The name needs 2 to 40 characters.", "The name or the pitch tries to steer the judge.",
  "The pitch needs 40 to 600 characters.", "The pitch needs at least 20 letters or digits, not just symbols.",
  "The playing time is over. Call finalize_round.", "The playing window has to be between 1 minute and 30 days.",
  "The prize can only grow while the round is open.", "The prize is too small for this many matches.",
  "The round does not have enough entries yet.", "The round is full.", "The round is not being played.",
  "The round is not open for entries.", "The round is not open.", "The round needs 3 to 8 entries, and the minimum cannot be above the maximum.",
  "The title needs 3 to 60 characters.", "There is nothing to claim.", "This address already has an entry in the round.",
  "This round needs a link to evidence.", "Wait two minutes before asking again.", "You have no entry in this round.",
  "the judge did not return a JSON object", "the judge did not return valid JSON", "the judge gave no level", "the judge named no winner",
];

export function outcome(receipt) {
  const named = receipt?.statusName ?? receipt?.status_name ?? "";
  const leader = leaderOf(receipt);
  const text = dump(receipt);
  const undetermined = /UNDETERMINED/i.test(String(named)) || /"status(?:_name|Name)?"\s*:\s*"UNDETERMINED"/i.test(text);
  if (undetermined) return { ok: false, known: true, undetermined: true, status: "UNDETERMINED", reason: "The validators did not reach consensus. Nothing changed." };
  const reason = CONTRACT_ERRORS.find((m) => text.includes(m));
  const direct = [receipt?.txExecutionResultName, receipt?.resultName, leader?.execution_result, leader?.result?.status];
  for (const v of direct) {
    if (typeof v !== "string" || !v) continue;
    if (FAIL.test(v)) return { ok: false, known: true, status: `${named || "decided"} / ${v}`, reason };
    if (PASS.test(v)) return { ok: true, known: true, status: `${named || "decided"} / ${v}` };
  }
  if (/FINISHED_WITH_ERROR|"execution_result"\s*:\s*"ERROR"/.test(text)) return { ok: false, known: true, status: `${named || "decided"} / error`, reason };
  if (/FINISHED_WITH_RETURN|"execution_result"\s*:\s*"SUCCESS"/.test(text)) return { ok: true, known: true, status: `${named || "decided"} / success` };
  return { ok: false, known: false, status: `unreadable receipt`, reason };
}

/** Poll until the node has decided a transaction; slows down instead of hammering the (rate-limited) node. */
export async function waitDecided(client, hash, { first = 3, factor = 1.5, max = 15, timeout = 1500, onTick } = {}) {
  const deadline = Date.now() + timeout * 1000;
  let delay = first * 1000;
  for (;;) {
    try {
      return await client.waitForTransactionReceipt({ hash, status: "ACCEPTED", retries: 0, interval: 0 });
    } catch (err) {
      const msg = String(err?.message ?? err);
      if (!/Timed out waiting for transaction|Transaction not found|rate.?limit|429|-32029/i.test(msg)) throw err;
      if (Date.now() + delay > deadline) throw new Error(`The transaction was not decided within ${Math.round(timeout / 60)} minutes. It may still be processing: check the explorer.`);
    }
    onTick?.();
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(max * 1000, Math.round(delay * factor));
  }
}
