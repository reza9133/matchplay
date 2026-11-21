// Tests of scripts/rpc.mjs. Run: node --test scripts/rpc.test.mjs   (or: npm test)
// A small fake node listens on localhost. Each test scripts what it does to the next requests (a rate limit, an HTML page,
// a reset connection, an answer that is lost after the request ran) and checks what the wrapped fetch hands back.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { createResilientFetch, inspectResponse, retryAfterMs, backoffMs, rateLimitWaitMs } from "./rpc.mjs";

const sha = (raw) => "0x" + createHash("sha256").update(String(raw)).digest("hex");
const freshStats = () => ({ requests: 0, retries: 0, rateLimited: 0, gateway: 0, network: 0, recovered: 0, giveUps: 0, waitedMs: 0, byMethod: {} });

const HTML = "<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1></center></body></html>";
const html = (res, status = 502) => {
  res.writeHead(status, { "content-type": "text/html" });
  res.end(HTML);
};
// The exact error of the live run (session of 2026-11-12), as the node sends it.
const rateError = (retry = 613) => ({ code: -32029, message: "Rate limit exceeded: 500 requests per hour", data: { bucket: "standard", window: "hour", limit: 500, current: 500, retry_after_seconds: retry } });
const rate = (res, { status = 429, retry = 613 } = {}) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, error: rateError(retry) }));
};
const reset = (res) => res.socket.destroy();

// Servers are closed when the file is done, so that a failing assertion cannot leave one open and hang the run.
const openNodes = [];
after(() => Promise.all(openNodes.map((n) => n.close())));

/** A fake node. `plan` is consumed one entry per request: { before: fn } answers without running the request,
 * { after: fn } runs it and then replaces the answer. With no entry left the request is simply answered. */
async function fakeNode() {
  const node = { plan: [], requests: [], executed: [], known: new Set() };
  node.server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const q = JSON.parse(body);
      node.requests.push(q.method);
      const step = node.plan.shift() ?? {};
      if (step.before) return step.before(res);
      let result = "0x1";
      if (q.method === "eth_sendRawTransaction") {
        const hash = sha(q.params[0]);
        if (node.known.has(hash)) {
          res.setHeader("content-type", "application/json");
          return res.end(JSON.stringify({ jsonrpc: "2.0", id: q.id, error: { code: -32000, message: "already known" } }));
        }
        node.known.add(hash);
        node.executed.push(q.method);
        result = hash;
      } else if (q.method === "eth_getTransactionByHash") {
        result = node.known.has(q.params[0]) ? { hash: q.params[0] } : null;
      } else if (q.method === "eth_sendTransaction") {
        node.executed.push(q.method);
      } else if (q.method === "gen_call") {
        if (q.params?.[0] === "revert") {
          res.setHeader("content-type", "application/json");
          return res.end(JSON.stringify({ jsonrpc: "2.0", id: q.id, error: { code: -32000, message: "execution reverted" } }));
        }
        result = "ok";
      }
      if (step.after) return step.after(res);
      res.setHeader("content-type", "application/json");
      res.setHeader("date", "Thu, 12 Nov 2026 19:41:33 GMT");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: q.id, result }));
    });
  });
  await new Promise((r) => node.server.listen(0, "127.0.0.1", r));
  node.url = `http://127.0.0.1:${node.server.address().port}`;
  node.close = () => new Promise((r) => (node.server.listening ? node.server.close(() => r()) : r()));
  openNodes.push(node);
  return node;
}

async function setup(opts = {}) {
  const node = await fakeNode();
  const sleeps = [];
  const logs = [];
  const stats = freshStats();
  const f = createResilientFetch(globalThis.fetch.bind(globalThis), {
    rpcUrl: node.url,
    sleep: async (ms) => void sleeps.push(ms),
    random: () => 0.5, // no spread: a backoff is exactly base * 2^n and the jitter is a fixed 1500 ms
    txHash: sha,
    log: (m) => logs.push(m),
    stats,
    ...opts,
  });
  // What genlayer-js does: POST, then response.json() (which throws on a page that is not JSON), then throw data.error.
  const call = async (method, params = []) => {
    const res = await f(node.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    const data = await res.json();
    if (data.error) throw Object.assign(new Error(data.error.message), data.error);
    return data.result;
  };
  return { node, sleeps, logs, stats, f, call };
}

// ---- reading answers ---------------------------------------------------------------------------------------------------

test("retryAfterMs reads the server's own wording, the header and the message text", () => {
  assert.equal(retryAfterMs({ error: rateError(613) }), 613000);
  assert.equal(retryAfterMs({ error: { message: "slow down", data: { retryAfter: 7 } } }), 7000);
  assert.equal(retryAfterMs({ headers: new Headers({ "retry-after": "42" }) }), 42000);
  // the text the SDK printed in the live run
  assert.equal(retryAfterMs({ error: { message: "Rate limit exceeded: 500 requests per hourcode: -32029, data: { bucket: 'standard', window: 'hour', limit: 500, current: 500, retry_after_seconds: 613 }" } }), 613000);
  assert.equal(retryAfterMs({ error: { message: "try again" } }), null);
});

test("inspectResponse tells a rate limit, a gateway page, a node error and a result apart", () => {
  const h = new Headers();
  assert.equal(inspectResponse(200, h, JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" })).kind, "ok");
  assert.equal(inspectResponse(200, h, JSON.stringify({ jsonrpc: "2.0", id: 1, result: null })).kind, "ok");
  assert.equal(inspectResponse(200, h, JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "execution reverted" } })).kind, "rpc_error");
  assert.equal(inspectResponse(429, h, JSON.stringify({ jsonrpc: "2.0", id: 1, error: rateError() })).kind, "rate_limit");
  assert.equal(inspectResponse(200, h, JSON.stringify({ jsonrpc: "2.0", id: 1, error: rateError() })).kind, "rate_limit");
  assert.equal(inspectResponse(429, h, "Too Many Requests").kind, "rate_limit");
  assert.equal(inspectResponse(502, h, HTML).kind, "gateway");
  assert.equal(inspectResponse(200, h, HTML).kind, "gateway"); // a page that says 200 is still a page
  assert.equal(inspectResponse(503, h, "").kind, "gateway");
  assert.equal(inspectResponse(502, h, JSON.stringify({ message: "upstream unavailable" })).kind, "gateway");
});

test("backoffMs doubles from 2 s up to 30 s", () => {
  const seq = [1, 2, 3, 4, 5, 6, 7].map((n) => backoffMs(n, { random: () => 0.5 }));
  assert.deepEqual(seq, [2000, 4000, 8000, 16000, 30000, 30000, 30000]);
});

test("rateLimitWaitMs never waits less than 5 s: a saturated limit would otherwise be hit again at once", () => {
  const r = { random: () => 0.5 };
  assert.equal(rateLimitWaitMs({ retryAfterMs: 613000 }, 1, r), 613000 + 1500);
  assert.equal(rateLimitWaitMs({ retryAfterMs: 1000 }, 1, r), 5000 + 1500, "a 1 s hint is raised to 5 s");
  assert.equal(rateLimitWaitMs({ retryAfterMs: 0 }, 1, r), 5000 + 1500);
  assert.equal(rateLimitWaitMs({ retryAfterMs: null }, 1, r), 5000 + 1500, "no hint: back off from 5 s");
  assert.equal(rateLimitWaitMs({ retryAfterMs: null }, 3, r), 20000 + 1500);
});

// ---- reads -------------------------------------------------------------------------------------------------------------

test("a normal answer passes through untouched and is counted once", async () => {
  const t = await setup();
  assert.equal(await t.call("gen_call"), "ok");
  assert.equal(t.stats.requests, 1);
  assert.equal(t.stats.retries, 0);
  assert.deepEqual(t.sleeps, []);
  await t.node.close();
});

test("the date header of an answer survives (the run reads the network clock from it)", async () => {
  const t = await setup();
  const res = await t.f(t.node.url, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) });
  assert.equal(res.headers.get("date"), "Thu, 12 Nov 2026 19:41:33 GMT");
  await t.node.close();
});

test("a rate limit (HTTP 429, error -32029) waits retry_after_seconds and then succeeds", async () => {
  const t = await setup();
  t.node.plan.push({ before: (res) => rate(res, { status: 429, retry: 613 }) });
  assert.equal(await t.call("gen_call"), "ok");
  assert.equal(t.stats.requests, 2);
  assert.equal(t.stats.rateLimited, 1);
  assert.deepEqual(t.sleeps, [613000 + 1500]); // the server's number, plus the fixed jitter of this test
  await t.node.close();
});

test("the same rate limit with HTTP 200 is handled the same way", async () => {
  const t = await setup();
  t.node.plan.push({ before: (res) => rate(res, { status: 200, retry: 30 }) });
  assert.equal(await t.call("gen_call"), "ok");
  assert.deepEqual(t.sleeps, [31500]);
  await t.node.close();
});

test("a 429 without a body uses the Retry-After header", async () => {
  const t = await setup();
  t.node.plan.push({
    before: (res) => {
      res.writeHead(429, { "retry-after": "20", "content-type": "text/plain" });
      res.end("Too Many Requests");
    },
  });
  assert.equal(await t.call("eth_getBalance", ["0x0"]), "0x1");
  assert.deepEqual(t.sleeps, [21500]);
  await t.node.close();
});

test("a rate limit without any hint backs off instead of hammering", async () => {
  const t = await setup();
  t.node.plan.push({ before: (res) => { res.writeHead(429); res.end(""); } }, { before: (res) => { res.writeHead(429); res.end(""); } });
  assert.equal(await t.call("gen_call"), "ok");
  assert.deepEqual(t.sleeps, [5000 + 1500, 10000 + 1500]);
  await t.node.close();
});

test("an HTML gateway page (the live run's 'Unexpected token <') is retried with a growing delay", async () => {
  const t = await setup();
  t.node.plan.push({ before: (res) => html(res, 502) }, { before: (res) => html(res, 200) }, { before: (res) => html(res, 504) });
  assert.equal(await t.call("gen_call"), "ok");
  assert.equal(t.stats.requests, 4);
  assert.equal(t.stats.gateway, 3);
  assert.deepEqual(t.sleeps, [2000, 4000, 8000]);
  await t.node.close();
});

test("a reset connection is retried", async () => {
  const t = await setup();
  t.node.plan.push({ before: reset });
  assert.equal(await t.call("eth_getTransactionByHash", ["0xabc"]), null);
  assert.equal(t.stats.network, 1);
  await t.node.close();
});

test("after maxAttempts the SDK sees the same failure it would have seen without retries", async () => {
  const t = await setup({ maxAttempts: 3 });
  for (let i = 0; i < 5; i++) t.node.plan.push({ before: (res) => html(res, 502) });
  await assert.rejects(t.call("gen_call"), /Unexpected token '<'|is not valid JSON/);
  assert.equal(t.stats.requests, 3);
  assert.equal(t.stats.giveUps, 1);
  await t.node.close();
});

test("an error that came from the node itself is not retried", async () => {
  const t = await setup();
  await assert.rejects(t.call("gen_call", ["revert"]), /execution reverted/);
  assert.equal(t.stats.requests, 1);
  assert.equal(t.stats.retries, 0);
  await t.node.close();
});

test("a rate limit that outlasts the total wait is handed back as the error it is", async () => {
  const t = await setup({ maxRateLimitWaitMs: 60_000 });
  t.node.plan.push({ before: (res) => rate(res, { retry: 613 }) });
  await assert.rejects(t.call("gen_call"), (e) => e.code === -32029 && e.data.retry_after_seconds === 613);
  assert.deepEqual(t.sleeps, []);
  await t.node.close();
});

test("a rate limit repeated several times is waited out each time", async () => {
  const t = await setup();
  t.node.plan.push({ before: (res) => rate(res, { retry: 10 }) }, { before: (res) => rate(res, { retry: 20 }) });
  assert.equal(await t.call("gen_call"), "ok");
  assert.deepEqual(t.sleeps, [11500, 21500]);
  assert.equal(t.stats.waitedMs, 33000);
  await t.node.close();
});

test("other URLs and plain GET requests are left alone", async () => {
  const t = await setup();
  const other = await fakeNode();
  other.plan.push({ before: (res) => html(res, 502) });
  const res = await t.f(other.url, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "gen_call", params: [] }) });
  assert.equal(res.status, 502); // not ours: no retry
  assert.equal(other.requests.length, 1);
  assert.equal(t.stats.requests, 0);
  await other.close();
  await t.node.close();
});

// ---- transactions: never twice -----------------------------------------------------------------------------------------

test("a raw transaction whose answer was lost AFTER the node ran it is not sent again", async () => {
  const t = await setup();
  t.node.plan.push({ after: (res) => html(res, 502) }); // ran, but the page that comes back is a 502
  const hash = await t.call("eth_sendRawTransaction", ["0xdeadbeef"]);
  assert.equal(hash, sha("0xdeadbeef"));
  assert.equal(t.node.executed.length, 1, "the node ran the transaction exactly once");
  assert.equal(t.stats.recovered, 1);
  assert.deepEqual(t.node.requests, ["eth_sendRawTransaction", "eth_getTransactionByHash"]);
  await t.node.close();
});

test("a raw transaction whose answer was lost BEFORE the node ran it is sent again", async () => {
  const t = await setup();
  t.node.plan.push({ before: (res) => html(res, 502) });
  const hash = await t.call("eth_sendRawTransaction", ["0xfeed"]);
  assert.equal(hash, sha("0xfeed"));
  assert.equal(t.node.executed.length, 1);
  assert.deepEqual(t.node.requests, ["eth_sendRawTransaction", "eth_getTransactionByHash", "eth_sendRawTransaction"]);
  assert.equal(t.stats.recovered, 0);
  await t.node.close();
});

test("a reset connection after a raw transaction is checked by hash too", async () => {
  const t = await setup();
  t.node.plan.push({ after: reset });
  assert.equal(await t.call("eth_sendRawTransaction", ["0xbeef"]), sha("0xbeef"));
  assert.equal(t.node.executed.length, 1);
  await t.node.close();
});

test("a rate limited raw transaction waits, checks the hash and then goes in once", async () => {
  const t = await setup();
  t.node.plan.push({ before: (res) => rate(res, { retry: 100 }) });
  assert.equal(await t.call("eth_sendRawTransaction", ["0xcafe"]), sha("0xcafe"));
  assert.equal(t.node.executed.length, 1);
  assert.deepEqual(t.sleeps, [101500]);
  await t.node.close();
});

test("when the hash check itself cannot be answered, the transaction is not sent again", async () => {
  const t = await setup({ maxAttempts: 2 });
  t.node.plan.push({ after: (res) => html(res, 502) }, { before: (res) => html(res, 502) }, { before: (res) => html(res, 502) });
  await assert.rejects(t.call("eth_sendRawTransaction", ["0xabba"]));
  assert.equal(t.node.executed.length, 1, "no second copy went in");
  await t.node.close();
});

test("without a way to compute the hash a raw transaction is never repeated after a lost answer", async () => {
  const t = await setup({ txHash: undefined });
  t.node.plan.push({ after: (res) => html(res, 502) });
  await assert.rejects(t.call("eth_sendRawTransaction", ["0x1234"]));
  assert.equal(t.node.executed.length, 1);
  assert.equal(t.node.requests.length, 1);
  await t.node.close();
});

test("any other write is not repeated after a lost answer, but is after a rate limit", async () => {
  const t = await setup();
  t.node.plan.push({ after: (res) => html(res, 502) });
  await assert.rejects(t.call("eth_sendTransaction", [{}]));
  assert.equal(t.node.executed.length, 1);
  assert.equal(t.node.requests.length, 1);
  t.node.plan.push({ before: (res) => rate(res, { retry: 5 }) });
  assert.equal(await t.call("eth_sendTransaction", [{}]), "0x1");
  assert.equal(t.node.executed.length, 2); // the second try ran once, the rate-limited request never ran
  await t.node.close();
});

test("funding a test account is retried (a second funding only adds test money)", async () => {
  const t = await setup();
  t.node.plan.push({ before: (res) => html(res, 503) });
  assert.equal(await t.call("sim_fundAccount", ["0x0", 1]), "0x1");
  await t.node.close();
});

test("statistics add up per method", async () => {
  const t = await setup();
  t.node.plan.push({ before: (res) => html(res, 502) });
  await t.call("gen_call");
  await t.call("gen_call");
  await t.call("eth_getBalance", ["0x0"]);
  assert.equal(t.stats.requests, 4);
  assert.deepEqual(t.stats.byMethod, { gen_call: 3, eth_getBalance: 1 });
  assert.equal(t.stats.retries, 1);
  await t.node.close();
});
