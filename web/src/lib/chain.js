import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { CONTRACT_ADDRESS } from "../config.js";
import { isDemo, loadMock } from "./demo/flag.js";

export { studionet };
export const readClient = createClient({ chain: studionet });

// ---- rate limits -----------------------------------------------------------------------------------------------------
// Studionet allows about 500 requests per hour per address. Reads are cached for a few seconds, identical reads that are
// in flight are shared, and after a limit the front end backs off for as long as the node asks.
let blockedUntil = 0;
const limitListeners = new Set();
export const onRateLimit = (fn) => (limitListeners.add(fn), () => limitListeners.delete(fn));
export const rateLimitedUntil = () => blockedUntil;

const isLimit = (e) => {
  const code = Number(e?.code ?? e?.cause?.code);
  const text = String(e?.message ?? e?.shortMessage ?? e ?? "");
  return code === -32029 || code === -32005 || /rate.?limit|too many requests|429/i.test(text);
};
const retryAfterMs = (e) => {
  const d = e?.data ?? e?.cause?.data;
  const n = d && typeof d === "object" ? d.retry_after_seconds ?? d.retryAfter ?? d.retry_after : undefined;
  if (Number.isFinite(Number(n)) && Number(n) > 0) return Math.max(5000, Number(n) * 1000);
  const m = /retry[_ -]?after\D{0,12}(\d+(?:\.\d+)?)/i.exec(String(e?.message ?? ""));
  return m ? Math.max(5000, Number(m[1]) * 1000) : 30000;
};

const cache = new Map(); // key -> { at, promise }
let version = 0;
const versionListeners = new Set();
export const onVersion = (fn) => (versionListeners.add(fn), () => versionListeners.delete(fn));
export const dataVersion = () => version;
/** Call after a transaction was decided: every cached read is stale and every mounted hook reloads. */
export function invalidateAll() {
  cache.clear();
  version++;
  versionListeners.forEach((f) => f(version));
}

function parse(raw) {
  if (typeof raw === "boolean") return raw;
  const text = typeof raw === "string" ? raw : String(raw);
  if (/^\s*[[{]/.test(text)) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text; // a plain number stays text so a large amount is never rounded
}

/** Read one contract view. Resolves with parsed JSON for objects and lists, a string for numbers, a boolean for would_steer. */
export function readView(fn, args = [], { ttl = 6000, force = false } = {}) {
  const key = fn + "|" + JSON.stringify(args, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < ttl) return hit.promise;
  if (Date.now() < blockedUntil) return Promise.reject(Object.assign(new Error("Rate limited by the Studionet node. Retrying shortly."), { rateLimited: true }));
  const promise = (async () => {
    try {
      if (isDemo()) {
        const a = args.map((x) => (typeof x === "string" && /^\d+$/.test(x) ? Number(x) : x));
        return await (await loadMock()).read(fn, a);
      }
      const raw = await readClient.readContract({ address: CONTRACT_ADDRESS, functionName: fn, args });
      return parse(raw);
    } catch (e) {
      if (isLimit(e)) {
        blockedUntil = Date.now() + retryAfterMs(e);
        limitListeners.forEach((f) => f(blockedUntil));
        throw Object.assign(new Error("Rate limited by the Studionet node. Retrying shortly."), { rateLimited: true });
      }
      cache.delete(key);
      throw e;
    }
  })();
  cache.set(key, { at: Date.now(), promise });
  promise.catch(() => cache.delete(key));
  return promise;
}

export const api = {
  stats: () => readView("stats"),
  solvency: (o) => readView("solvency", [], o),
  audit: (o) => readView("audit_books", [], o),
  round: (id, o) => readView("get_round", [id], o),
  rounds: (offset = 0, limit = 20, o) => readView("list_rounds", [offset, limit], o),
  roundsOf: (who, offset = 0, limit = 50, o) => readView("rounds_of", [who, offset, limit], o),
  match: (rid, i) => readView("get_match", [rid, i]),
  credit: (who, o) => readView("credit_of", [who], o),
  schedule: (n) => readView("schedule_of", [n], { ttl: 3600_000 }),
  wouldSteer: (text) => readView("would_steer", [text], { ttl: 60_000 }),
};

// ---- the contract's own balance (for the ledger page) --------------------------------------------------------------------
export async function nativeBalance() {
  if (isDemo()) return BigInt((await (await loadMock()).read("solvency", [])).native ?? 0);
  const hex = await readClient.request({ method: "eth_getBalance", params: [CONTRACT_ADDRESS, "latest"] });
  return BigInt(hex);
}
