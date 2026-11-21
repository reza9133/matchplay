// A resilient transport for the live run.
//
// genlayer-js sends every JSON-RPC call through one `fetch(...)` followed by `response.json()`, and it is created with
// `retryCount: 0`. So a single hiccup ends the call: a rate limit (`-32029`, 500 requests per hour on Studionet) or a
// gateway that answers with an HTML page (`Unexpected token '<', "<!DOCTYPE "... is not valid JSON`, shown by viem as
// `UnknownRpcError`) fails the step, or the whole scenario. Everything the live run does goes through that one fetch:
// reads (gen_call), the transaction itself, and the receipt polling. That is why the retries live here and nowhere
// else: wrapping `fetch` covers every call, including the ones inside the SDK.
//
//   const rpc = await installResilientFetch({ rpcUrl, sleep, log });   // once, before any client is used
//   rpc.stats                                                          // what was sent, retried and waited for
//
// What is retried, and how
//   rate limit      HTTP 429, or a JSON-RPC error with code -32029 / -32005 / "rate limit" in it. The request was turned away
//                   before it ran, so it is always safe to send again, whatever the method. The wait is `retry_after_seconds`
//                   (also read from data.retryAfter, a Retry-After header or the message text), at least 5 s, plus a little jitter.
//   gateway page    an answer that is not JSON-RPC at all: an HTML page, an empty body, a 5xx without a JSON-RPC body. The
//                   wait grows 2s, 4s, 8s ... up to 30s, for `maxAttempts` tries.
//   network error   the connection was reset, timed out or could not be made. Same waits.
// A JSON-RPC error that came from the node itself (a revert, "insufficient funds", ...) is an answer, not a hiccup: it
// is handed to the caller at once.
//
// Sending a transaction twice must never happen (a second `claim` or `create_round` would change what the test checks), so
// the methods are sorted by what a repeat can do:
//   read            eth_call, gen_call, eth_getBalance, eth_getTransactionByHash, ... retried on any hiccup.
//   eth_sendRawTransaction
//                   a raw transaction has a fixed hash (keccak256 of the signed bytes). When the answer was lost (a gateway
//                   page, a reset), the node is asked whether that hash is already known: if it is, the transaction went in
//                   and its hash is returned as if the answer had arrived; if it is not, the same bytes are sent again.
//   anything else   (eth_sendTransaction, ...) is only repeated after a rate limit or a connection that was never made. After
//                   an answer that may have been lost the failure is handed to the caller, because the node may have run it.
//   sim_fundAccount counts as a read here: funding twice only adds test money.

const RATE_LIMIT_CODES = new Set([-32029, -32005]);
const RATE_LIMIT_TEXT = /rate.?limit|too many requests|limit exceeded|requests? per (second|minute|hour|day)/i;
// Connection failures that happen before a single byte was sent: the request cannot have been processed.
const NEVER_SENT = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ERR_INVALID_URL"]);
const READ_METHOD =
  /^(eth_(call|chainId|getBalance|getCode|getStorageAt|getTransactionByHash|getTransactionReceipt|getTransactionCount|blockNumber|estimateGas|gasPrice|maxPriorityFeePerGas|feeHistory|getBlockByHash|getBlockByNumber|getLogs|syncing|accounts)|net_\w+|web3_\w+|gen_(call|get\w*|estimate\w*)|sim_(get|read|list|count)\w*)$/;
const COUNTS_AS_READ = new Set(["sim_fundAccount"]);

export const rpcStats = {
  requests: 0, // every request that left this process, retries included
  retries: 0,
  rateLimited: 0,
  gateway: 0,
  network: 0,
  recovered: 0, // a transaction whose answer was lost but that the node had already accepted
  giveUps: 0, // failures handed back to the SDK after the retries ran out
  waitedMs: 0,
  byMethod: {},
};
export function snapshotStats() {
  return { ...rpcStats, byMethod: { ...rpcStats.byMethod } };
}
export function resetStats() {
  for (const k of Object.keys(rpcStats)) rpcStats[k] = k === "byMethod" ? {} : 0;
}

// ---- reading an answer -----------------------------------------------------------------------------------------------

/** Seconds the server asked to wait, in milliseconds, or null. Reads the structured data first, then a header, then the text. */
export function retryAfterMs({ error, headers, text } = {}) {
  const d = error?.data;
  const named = d && typeof d === "object" ? (d.retry_after_seconds ?? d.retryAfterSeconds ?? d.retry_after ?? d.retryAfter) : undefined;
  if (named !== undefined && named !== null && named !== "" && Number.isFinite(Number(named)) && Number(named) >= 0) return Math.ceil(Number(named) * 1000);
  const header = headers?.get?.("retry-after");
  if (header) {
    const n = Number(header);
    if (Number.isFinite(n) && n >= 0) return Math.ceil(n * 1000);
    const at = Date.parse(header);
    if (Number.isFinite(at)) return Math.max(0, at - Date.now());
  }
  const m = /retry[_ -]?after[_ -]?(?:seconds)?\D{0,12}?(\d+(?:\.\d+)?)/i.exec(`${error?.message ?? ""} ${typeof d === "string" ? d : ""} ${text ?? ""}`);
  return m ? Math.ceil(Number(m[1]) * 1000) : null;
}

const isRateLimitError = (e) => Boolean(e) && (RATE_LIMIT_CODES.has(Number(e.code)) || RATE_LIMIT_TEXT.test(String(e.message ?? "")));

/**
 * Sorts one HTTP answer: "ok" (a JSON-RPC result), "rpc_error" (the node refused: not a hiccup), "rate_limit" or "gateway"
 * (the answer is not JSON-RPC: an HTML page, an empty body, a proxy error).
 */
export function inspectResponse(status, headers, text) {
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  const items = Array.isArray(body) ? body : body && typeof body === "object" ? [body] : [];
  const looksRpc = items.length > 0 && items.every((x) => x && typeof x === "object" && ("result" in x || "error" in x));
  const limited = items.map((x) => x?.error).find(isRateLimitError);
  if (limited) return { kind: "rate_limit", error: limited, retryAfterMs: retryAfterMs({ error: limited, headers, text }), detail: `${limited.message ?? "rate limit"} (code ${limited.code})` };
  if (status === 429) return { kind: "rate_limit", error: items[0]?.error, retryAfterMs: retryAfterMs({ error: items[0]?.error, headers, text }), detail: "HTTP 429" };
  if (looksRpc) return { kind: items.some((x) => x.error) ? "rpc_error" : "ok" };
  const sample = String(text ?? "").replace(/\s+/g, " ").slice(0, 60);
  return { kind: "gateway", detail: `HTTP ${status}${sample ? `, not JSON-RPC: ${sample}` : ", empty body"}` };
}

function fromThrown(err) {
  const code = err?.cause?.code ?? err?.code;
  const aborted = err?.name === "AbortError" || err?.name === "TimeoutError";
  return { kind: "network", error: err, notSent: NEVER_SENT.has(code), detail: `${aborted ? "timed out" : (code ?? err?.cause?.message ?? err?.message ?? "network error")}` };
}

function methodKind(methods) {
  if (methods.every((m) => READ_METHOD.test(m) || COUNTS_AS_READ.has(m))) return "read";
  if (methods.length === 1 && methods[0] === "eth_sendRawTransaction") return "send_raw";
  return "write";
}

const noContent = new Set([101, 204, 205, 304]);
const rebuild = ({ status, statusText, headers, text }) => new Response(noContent.has(status) ? null : text, { status, statusText, headers });

/**
 * How long to wait after a rate limit: what the server asked for, but never less than 5 s. Once a limit of 500 per hour is used up,
 * "retry after" is only the few seconds until the oldest request leaves the window, so waiting exactly that frees one slot and the
 * next request is turned away again; a limit of 500 per hour lets one request through every 7.2 s anyway. Plus up to 3 s of jitter.
 */
export function rateLimitWaitMs(outcome, attempt, { random = Math.random } = {}) {
  const asked = outcome.retryAfterMs ?? backoffMs(attempt, { base: 5000, max: 60000, random });
  return Math.max(5000, asked) + Math.round(random() * 3000);
}

/** The wait before try number `attempt` (1, 2, 3 ...): base, 2x, 4x ... up to `max`, spread by +-25%. */
export function backoffMs(attempt, { base = 2000, max = 30000, random = Math.random } = {}) {
  const raw = Math.min(max, base * 2 ** (attempt - 1));
  return Math.round(raw * (0.75 + 0.5 * random()));
}

// ---- the wrapper -----------------------------------------------------------------------------------------------------

/**
 * Returns a drop-in `fetch` that retries the way the header describes. `realFetch` is the fetch to wrap.
 * Options: rpcUrl (only this URL is touched; others pass through), sleep(ms), random(), maxAttempts (gateway and network
 * tries, default 8), maxRateLimitWaitMs (total wait per call for rate limits, default 65 minutes: it has to be longer than the limit's window, or a wait that would have worked is refused), requestTimeoutMs (default
 * 90 s), txHash(rawHex) (hash of a signed transaction; without it a raw transaction is treated like any other write),
 * log(text), stats.
 */
export function createResilientFetch(realFetch, opts = {}) {
  const {
    rpcUrl,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    random = Math.random,
    maxAttempts = 8,
    maxRateLimitWaitMs = 65 * 60 * 1000,
    requestTimeoutMs = 90 * 1000,
    txHash,
    log = () => {},
    stats = rpcStats,
  } = opts;

  const withTimeout = (signal) => {
    if (!requestTimeoutMs || typeof AbortSignal?.timeout !== "function") return signal;
    const t = AbortSignal.timeout(requestTimeoutMs);
    return signal && typeof AbortSignal.any === "function" ? AbortSignal.any([signal, t]) : (signal ?? t);
  };

  /** One attempt: the outcome of a single request, with the answer kept as text so that it can be read twice. */
  async function attemptOnce(input, init, label) {
    stats.requests++;
    stats.byMethod[label] = (stats.byMethod[label] ?? 0) + 1;
    try {
      const res = await realFetch(input, { ...init, signal: withTimeout(init.signal) });
      const text = await res.text();
      const outcome = inspectResponse(res.status, res.headers, text);
      outcome.response = { status: res.status, statusText: res.statusText, headers: res.headers, text };
      return outcome;
    } catch (err) {
      return fromThrown(err);
    }
  }

  async function resilient(input, init = {}) {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url;
    if ((rpcUrl && url !== rpcUrl) || String(init.method ?? "GET").toUpperCase() !== "POST" || typeof init.body !== "string") return realFetch(input, init);
    let payload;
    try {
      payload = JSON.parse(init.body);
    } catch {
      return realFetch(input, init);
    }
    const calls = Array.isArray(payload) ? payload : [payload];
    const methods = calls.map((c) => c?.method).filter((m) => typeof m === "string");
    if (!methods.length) return realFetch(input, init);
    const kind = methodKind(methods);
    const label = methods.join(",");
    const canCheckByHash = kind === "send_raw" && typeof txHash === "function";
    let rateWaited = 0;

    const giveUp = (outcome) => {
      stats.giveUps++;
      if (outcome.response) return rebuild(outcome.response); // the SDK reads it and fails exactly as it would have without us
      throw outcome.error;
    };

    // Did the node already accept this raw transaction? "found" / "absent" / "unknown" (the question itself failed).
    async function lookup(hash) {
      const ask = { ...init, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionByHash", params: [hash] }) };
      for (let attempt = 1; ; attempt++) {
        const o = await attemptOnce(input, ask, "eth_getTransactionByHash");
        if (o.kind === "ok") {
          const result = JSON.parse(o.response.text)?.result;
          return result ? "found" : "absent";
        }
        if (o.kind === "rpc_error") return "unknown";
        if (attempt >= maxAttempts) return "unknown";
        const wait = o.kind === "rate_limit" ? rateLimitWaitMs(o, attempt, { random }) : backoffMs(attempt, { random });
        stats.retries++;
        stats.waitedMs += wait;
        log(`rpc: checking whether the transaction is known: ${o.detail}; retrying in ${Math.round(wait / 1000)}s`);
        await sleep(wait);
      }
    }

    for (let attempt = 1; ; attempt++) {
      const outcome = await attemptOnce(input, init, label);
      if (outcome.kind === "ok" || outcome.kind === "rpc_error") return rebuild(outcome.response);

      // From here on the request met a hiccup. First: how long to wait, or whether to stop.
      let wait;
      if (outcome.kind === "rate_limit") {
        stats.rateLimited++;
        wait = rateLimitWaitMs(outcome, attempt, { random });
        if (rateWaited + wait > maxRateLimitWaitMs) {
          log(`rpc: ${label} is still rate limited after ${Math.round(rateWaited / 1000)}s of waiting; giving up`);
          return giveUp(outcome);
        }
        rateWaited += wait;
      } else {
        outcome.kind === "gateway" ? stats.gateway++ : stats.network++;
        if (attempt >= maxAttempts) {
          log(`rpc: ${label} failed ${attempt} times (${outcome.detail}); giving up`);
          return giveUp(outcome);
        }
        wait = backoffMs(attempt, { random });
        // The answer may have been lost after the node ran the request. A repeat is only safe for a read, for a raw
        // transaction that can be looked up by hash, or when nothing was sent at all.
        const mayHaveRun = !outcome.notSent;
        if (mayHaveRun && kind === "write") {
          log(`rpc: ${label} got ${outcome.detail}; it is not repeated because the node may have run it`);
          return giveUp(outcome);
        }
        if (mayHaveRun && kind === "send_raw" && !canCheckByHash) {
          log(`rpc: ${label} got ${outcome.detail}; it is not repeated because the node may have run it (no transaction hash available)`);
          return giveUp(outcome);
        }
      }

      stats.retries++;
      stats.waitedMs += wait;
      log(`rpc: ${label} ${outcome.kind === "rate_limit" ? "was rate limited" : "got a bad answer"} (${outcome.detail}); waiting ${Math.round(wait / 1000)}s, then trying again (attempt ${attempt + 1})`);
      await sleep(wait);

      if (canCheckByHash) {
        const hash = txHash(calls[0].params?.[0]);
        const known = await lookup(hash);
        if (known === "found") {
          stats.recovered++;
          log(`rpc: the node had already accepted transaction ${hash.slice(0, 14)}...; not sending it again`);
          return rebuild({ status: 200, statusText: "OK", headers: { "content-type": "application/json" }, text: JSON.stringify({ jsonrpc: "2.0", id: calls[0].id, result: hash }) });
        }
        if (known === "unknown") {
          log(`rpc: could not find out whether transaction ${hash.slice(0, 14)}... is known; not sending it again`);
          return giveUp(outcome);
        }
      }
    }
  }
  resilient.isResilient = true;
  return resilient;
}

/**
 * Replaces globalThis.fetch with the resilient one (once; a second call returns the first one's handle). Loads keccak256
 * from viem, which genlayer-js depends on, so that a raw transaction can be recognized by its hash.
 */
export async function installResilientFetch(opts = {}) {
  if (globalThis.fetch?.isResilient) return { stats: rpcStats, fetch: globalThis.fetch, installed: false };
  let txHash = opts.txHash;
  if (!txHash) {
    try {
      const { keccak256 } = await import("viem");
      txHash = (raw) => keccak256(raw);
    } catch {
      (opts.log ?? (() => {}))("rpc: viem could not be loaded, so a lost answer to a transaction is never retried (nothing can be double-sent)");
    }
  }
  const wrapped = createResilientFetch(globalThis.fetch.bind(globalThis), { ...opts, txHash });
  globalThis.fetch = wrapped;
  return { stats: opts.stats ?? rpcStats, fetch: wrapped, installed: true };
}
