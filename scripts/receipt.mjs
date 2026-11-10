// Reads the outcome of a decided transaction without depending on one exact receipt shape.
// genlayer-js versions name the fields differently, so the sources are tried from the most to the least direct:
// the receipt's own result name, then the leader's execution result, and only then a search of the whole receipt.
// A receipt without a readable result never counts as a success.
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

export function leaderOf(receipt) {
  return receipt?.consensus_data?.leader_receipt?.[0] ?? receipt?.data?.leader_receipt?.[0] ?? receipt?.leader_receipt?.[0];
}

export function outcome(receipt) {
  const named = receipt?.statusName ?? receipt?.status_name ?? "";
  const leader = leaderOf(receipt);
  const direct = [receipt?.txExecutionResultName, receipt?.resultName, leader?.execution_result, leader?.result?.status];
  for (const v of direct) {
    if (typeof v !== "string" || !v) continue;
    if (FAIL.test(v)) return { ok: false, known: true, status: `${named || "decided"} / ${v}`, detail: dump(leader ?? receipt).slice(0, 1200) };
    if (PASS.test(v)) return { ok: true, known: true, status: `${named || "decided"} / ${v}` };
  }
  const text = dump(receipt);
  if (/FINISHED_WITH_ERROR|"execution_result"\s*:\s*"ERROR"/.test(text)) return { ok: false, known: true, status: `${named || "decided"} / error (found in receipt)`, detail: text.slice(0, 1200) };
  if (/FINISHED_WITH_RETURN|"execution_result"\s*:\s*"SUCCESS"/.test(text)) return { ok: true, known: true, status: `${named || "decided"} / success (found in receipt)` };
  return { ok: false, known: false, status: `unreadable receipt (${Object.keys(receipt ?? {}).slice(0, 12).join(", ") || "empty"})`, raw: text.slice(0, 1200), detail: text.slice(0, 1200) };
}
