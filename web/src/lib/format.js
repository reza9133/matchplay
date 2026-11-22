const E18 = 10n ** 18n;

export const toBig = (v) => {
  try {
    return BigInt(v ?? 0);
  } catch {
    return 0n;
  }
};

/** wei -> "0.0123" (trailing zeros trimmed). Exact, never goes through floats. */
export function fmtGen(wei, maxDecimals = 6) {
  const v = toBig(wei);
  const neg = v < 0n;
  const a = neg ? -v : v;
  const whole = a / E18;
  let frac = (a % E18).toString().padStart(18, "0");
  let shown = frac.slice(0, maxDecimals).replace(/0+$/, "");
  // a tiny non-zero amount must not read as 0
  if (!shown && a % E18 !== 0n && whole === 0n) return `${neg ? "-" : ""}<${(1 / 10 ** maxDecimals).toFixed(maxDecimals)}`;
  return `${neg ? "-" : ""}${whole.toLocaleString("en-US")}${shown ? "." + shown : ""}`;
}

/** "0.002" -> 2000000000000000n; returns null for anything that is not a plain decimal with at most 18 places. */
export function parseGen(text) {
  const t = String(text ?? "").trim().replace(",", ".");
  if (!/^\d+(\.\d{0,18})?$/.test(t) && !/^\.\d{1,18}$/.test(t)) return null;
  const [w, f = ""] = t.split(".");
  return BigInt(w || "0") * E18 + BigInt((f + "0".repeat(18)).slice(0, 18));
}

export const shortAddr = (a, l = 6, r = 4) => (a ? `${a.slice(0, l)}…${a.slice(-r)}` : "");
export const sameAddr = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

export function fmtDuration(sec) {
  sec = Math.max(0, Math.floor(sec));
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

export const nowSec = () => Math.floor(Date.now() / 1000);

export function fmtDate(sec) {
  if (!sec) return "—";
  return new Date(sec * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export const pairsOf = (n) => (n * (n - 1)) / 2;

export const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
