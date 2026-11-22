// Demo mode: a small in-browser copy of the Matchplay rules plus a pretend EIP-6963 wallet, so the whole app can be tried
// (and recorded) without a wallet, GEN or a network. Nothing here touches Studionet. State lives in localStorage.
import { CONFIG, RULES } from "./rules.js";

const U = 10n ** 18n;
const KEY = "mp.demo.state.v1", WKEY = "mp.demo.wallet.v1";
export const DEMO_ADDRESS = "0x7A3c9bE1d2F4a5608C1b7e9D3f0A24b6C58e1F90";
const PEOPLE = {
  nora: "0x1B2c3D4e5F60718293a4B5c6D7e8F9012a3B4c5D",
  omar: "0x2C3d4E5f60718293A4b5C6d7E8f9012A3b4C5d6E",
  lena: "0x3D4e5F60718293a4B5c6D7e8F9012a3B4c5D6e7F",
  kai: "0x4E5f60718293A4b5C6d7E8f9012A3b4C5d6E7f80",
  zoe: "0x5F60718293a4B5c6D7e8F9012a3B4c5D6e7F8091",
  host: "0x60718293A4b5C6d7E8f9012A3b4C5d6E7f8091a2",
  demo: DEMO_ADDRESS,
};
class UserErr extends Error {}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Math.floor(Date.now() / 1000);
const pairsOf = (n) => (n * (n - 1)) / 2;
function pairAt(n, m) { let i = 0; while (i < n - 1) { const span = n - 1 - i; if (m < span) return [i, i + 1 + m]; m -= span; i++; } throw new UserErr("No such match."); }
const ser = (o) => JSON.stringify(o, (_k, v) => (typeof v === "bigint" ? { $b: v.toString() } : v));
const de = (s) => JSON.parse(s, (_k, v) => (v && typeof v === "object" && "$b" in v ? BigInt(v.$b) : v));
const hashStr = (s) => { let h = 2166136261; for (const c of s) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const hex = (n) => n.toString(16).padStart(8, "0");

// ---- the rules (a faithful, simplified copy of contracts/matchplay.py) -------------------------------------------------
import { clean, steers, pkey, lowerScheme, publicUrl, urlIdentity } from "./validate.js";
const within = (n, [a, b]) => n >= a && n <= b;
const len = (s) => Array.from(s).length;

class Sim {
  constructor(s) { this.s = s; }
  round(id) { const r = this.s.rounds[id]; if (!r) throw new UserErr("No such round."); return r; }
  credit(who, amt) { const k = who.toLowerCase(); this.s.credit[k] = (this.s.credit[k] ?? 0n) + amt; this.s.owed += amt; }
  join(who, id) { const k = who.toLowerCase(); (this.s.joined[k] ??= []); if (!this.s.joined[k].includes(id)) this.s.joined[k].push(id); }
  create(c, a) {
    const [title0, mission0, bond, minE, maxE, ew, pw, minFit, needEv] = a;
    const title = clean(title0), mission = clean(mission0);
    if (!within(len(title), RULES.TITLE)) throw new UserErr("The title needs 3 to 60 characters.");
    if (!within(len(mission), RULES.MISSION)) throw new UserErr("The mission needs 30 to 1000 characters.");
    if (bond < RULES.MIN_BOND || bond > RULES.MAX_AMOUNT) throw new UserErr("The entry bond has to be at least 0.001 GEN.");
    if (minE < 3 || maxE > 8 || minE > maxE) throw new UserErr("The round needs 3 to 8 entries, and the minimum cannot be above the maximum.");
    if (!within(ew, RULES.WINDOW)) throw new UserErr("The entry window has to be between 1 minute and 30 days.");
    if (!within(pw, RULES.WINDOW)) throw new UserErr("The playing window has to be between 1 minute and 30 days.");
    if (minFit < 0 || minFit > 90) throw new UserErr("The bar has to be between 0 and 90.");
    if (c.value < RULES.MIN_POOL || c.value > RULES.MAX_AMOUNT) throw new UserErr("Attach at least 0.002 GEN as the prize.");
    const id = this.s.rounds.length;
    this.s.rounds.push({ host: c.sender, title, mission, state: 0, need_evidence: !!needEv, min_fit: minFit, entry_bond: bond, min_entries: minE, max_entries: maxE, created: c.now, entry_deadline: c.now + ew, play_window: pw, started_at: 0, play_deadline: 0, finished_at: 0, prize: c.value, pool: c.value, bonds: 0n, unit: 0n, next_match: 0, judged: 0, voided: 0, timeouts: 0, paid_out: 0n, returned: 0n, entries: [], matches: [] });
    this.join(c.sender, id);
    this.s.deposited += c.value; this.s.locked += c.value;
    return id;
  }
  topUp(c, [id]) {
    const r = this.round(id);
    if (r.state !== 0) throw new UserErr("The prize can only grow while the round is open.");
    if (c.value <= 0n) throw new UserErr("Send some GEN to add to the prize.");
    if (r.pool + c.value > RULES.MAX_AMOUNT) throw new UserErr("That is more than the contract accepts.");
    r.prize += c.value; r.pool += c.value; this.s.deposited += c.value; this.s.locked += c.value;
  }
  enter(c, [id, name0, pitch0, url0]) {
    const r = this.round(id);
    if (r.state !== 0) throw new UserErr("The round is not open for entries.");
    if (c.now >= r.entry_deadline) throw new UserErr("The entry time is over.");
    if (r.entries.length >= r.max_entries) throw new UserErr("The round is full.");
    if (c.sender.toLowerCase() === r.host.toLowerCase()) throw new UserErr("The host cannot enter their own round.");
    if (r.entries.some((e) => e.who.toLowerCase() === c.sender.toLowerCase())) throw new UserErr("This address already has an entry in the round.");
    if (c.value !== r.entry_bond) throw new UserErr("Attach exactly the entry bond.");
    const name = clean(name0), pitch = clean(pitch0);
    if (!within(len(name), RULES.NAME)) throw new UserErr("The name needs 2 to 40 characters.");
    if (!within(len(pitch), RULES.PITCH)) throw new UserErr("The pitch needs 40 to 600 characters.");
    const key = pkey(pitch);
    if (key.length < RULES.MIN_PITCH_LETTERS) throw new UserErr("The pitch needs at least 20 letters or digits, not just symbols.");
    if (steers(name) || steers(pitch)) throw new UserErr("The name or the pitch tries to steer the judge.");
    const url = lowerScheme((url0 || "").trim());
    if (url && !publicUrl(url)) throw new UserErr("The evidence must be a single public http(s) link.");
    if (!url && r.need_evidence) throw new UserErr("This round needs a link to evidence.");
    for (const e of r.entries) {
      if (url && e.url && urlIdentity(lowerScheme(e.url)) === urlIdentity(url)) throw new UserErr("That evidence page already backs another entry.");
      if (pkey(e.pitch) === key) throw new UserErr("That pitch is already used by another entry.");
    }
    r.entries.push({ who: c.sender, name, pitch, url, flagged: false, bond: c.value, points: 0, wins: 0, rank: 0, payout: 0n, joined: c.now });
    r.bonds += c.value; this.s.deposited += c.value; this.s.locked += c.value; this.s.n_entries++;
    this.join(c.sender, id);
    return r.entries.length - 1;
  }
  withdraw(c, [id]) {
    const r = this.round(id);
    if (r.state !== 0) throw new UserErr("An entry can only be withdrawn while the round is open.");
    const i = r.entries.findIndex((e) => e.who.toLowerCase() === c.sender.toLowerCase());
    if (i < 0) throw new UserErr("You have no entry in this round.");
    this.dropEntry(r, i);
  }
  dropEntry(r, i) { const e = r.entries[i]; this.credit(e.who, e.bond); r.bonds -= e.bond; this.s.locked -= e.bond; r.entries.splice(i, 1); const k = e.who.toLowerCase(); this.s.joined[k] = (this.s.joined[k] || []).filter((x) => x !== this.s.rounds.indexOf(r)); }
  remove(c, [id, who, reason]) {
    const r = this.round(id);
    if (c.sender.toLowerCase() !== r.host.toLowerCase()) throw new UserErr("Only the host can do that.");
    if (r.state !== 0) throw new UserErr("Entries can only be removed while the round is open.");
    const t = clean(reason); if (len(t) < 3 || len(t) > 160) throw new UserErr("Give a reason of 3 to 160 characters.");
    const i = r.entries.findIndex((e) => e.who.toLowerCase() === String(who).toLowerCase());
    if (i < 0) throw new UserErr("That address has no entry in this round.");
    this.dropEntry(r, i);
  }
  start(c, [id]) {
    const r = this.round(id);
    if (r.state !== 0) throw new UserErr("The round is not open.");
    const n = r.entries.length;
    if (n < r.min_entries) throw new UserErr("The round does not have enough entries yet.");
    if (!(c.now >= r.entry_deadline || n >= r.max_entries || c.sender.toLowerCase() === r.host.toLowerCase())) throw new UserErr("The entry time is not over and the round is not full.");
    const total = pairsOf(n), unit = r.pool / BigInt(2 * total);
    if (unit <= 0n) throw new UserErr("The prize is too small for this many matches.");
    r.matches = Array.from({ length: total }, (_, m) => { const [a, b] = pairAt(n, m); return { a, b, state: 0, outcome: 3, by: 0, tries: 0, last_try: 0, played_at: 0, review: null }; });
    r.unit = unit; r.started_at = c.now; r.play_deadline = c.now + r.play_window; r.state = 1;
  }
  cancel(c, [id]) {
    const r = this.round(id);
    if (r.state !== 0) throw new UserErr("Only an open round can be cancelled.");
    const isHost = c.sender.toLowerCase() === r.host.toLowerCase();
    const short = c.now >= r.entry_deadline && r.entries.length < r.min_entries;
    if (!isHost && !short) throw new UserErr("Only the host can cancel, unless the entry time is over without enough entries.");
    const held = r.pool + r.bonds;
    for (const e of r.entries) { this.credit(e.who, e.bond); e.bond = 0n; }
    this.credit(r.host, r.pool);
    this.s.locked -= held; r.pool = 0n; r.bonds = 0n; r.state = 3; r.finished_at = c.now; this.s.n_cancelled++;
  }
  /** The pretend judge: reads each pitch twice (both orders) and is consistent but not random-looking. */
  judge(r, m) {
    const ea = r.entries[m.a], eb = r.entries[m.b];
    const flags = [ea.flagged || /steer|ignore-previous/i.test(ea.url) ? 1 : 0, eb.flagged || /steer|ignore-previous/i.test(eb.url) ? 1 : 0];
    const level = (e) => { const h = hashStr(e.pitch + r.mission); const base = [25, 50, 75, 75, 100, 100][h % 6]; return Math.min(100, base + (len(e.pitch) > 260 ? 25 : 0) > 100 ? 100 : base + (len(e.pitch) > 260 && base < 100 ? 25 : 0)); };
    const fit = [level(ea), level(eb)];
    const score = (e) => hashStr("w" + e.pitch) % 1000 + len(e.pitch);
    const sa = score(ea), sb = score(eb);
    const w1 = Math.abs(sa - sb) < 40 ? "T" : sa > sb ? "A" : "B";
    const w2 = Math.abs(sa - sb) < 140 && (hashStr(ea.name + eb.name) % 3 === 0) ? (w1 === "A" ? "B" : "A") : w1;
    const okA = fit[0] >= r.min_fit && !flags[0], okB = fit[1] >= r.min_fit && !flags[1];
    let outcome;
    if (!okA && !okB) outcome = 3; else if (okA && !okB) outcome = 0; else if (okB && !okA) outcome = 1;
    else outcome = w1 === "A" && w2 === "A" ? 0 : w1 === "B" && w2 === "B" ? 1 : 2;
    const why = ["Clearer evidence and a sharper claim.", "More specific, and the link backs it up.", "Both are close; neither pulled ahead in both orders.", "Neither cleared the bar for this mission."];
    return { at: now(), outcome, fit, win: [w1, w2], flagged: flags, reason: why[outcome], reason2: outcome === 2 ? "The winner changed when the order changed, so it is a tie." : "Same verdict with the order swapped.", hash: hex(hashStr(ea.pitch + eb.pitch)) + hex(hashStr(eb.pitch + ea.pitch)) };
  }
  play(c, [id]) {
    const r = this.round(id);
    if (r.state !== 1) throw new UserErr("The round is not being played.");
    if (c.now >= r.play_deadline) throw new UserErr("The playing time is over. Call finalize_round.");
    if (r.next_match >= r.matches.length) throw new UserErr("Every match has been played. Call finalize_round.");
    const m = r.matches[r.next_match];
    const review = this.judge(r, m);
    for (const [side, i] of [[0, m.a], [1, m.b]]) if (review.flagged[side] && !r.entries[i].flagged) { r.entries[i].flagged = true; this.s.n_flagged++; }
    m.state = 1; m.outcome = review.outcome; m.by = 1; m.played_at = c.now; m.review = review; m.tries += 1;
    r.judged++; this.s.n_judged++; r.next_match++;
  }
  tally(r) {
    const pts = r.entries.map(() => 0), wins = r.entries.map(() => 0);
    for (const m of r.matches) { if (m.state !== 1) continue; if (m.outcome === 0) { pts[m.a] += 2; wins[m.a]++; } else if (m.outcome === 1) { pts[m.b] += 2; wins[m.b]++; } else if (m.outcome === 2) { pts[m.a]++; pts[m.b]++; } }
    return { pts, wins };
  }
  order(r, pts, wins) { return r.entries.map((_, i) => i).filter((i) => !r.entries[i].flagged).sort((x, y) => pts[y] - pts[x] || wins[y] - wins[x] || x - y); }
  finalize(c, [id]) {
    const r = this.round(id);
    if (r.state !== 1) throw new UserErr("The round is not being played.");
    if (r.next_match < r.matches.length && c.now < r.play_deadline) throw new UserErr("Matches are still being played.");
    for (let i = r.next_match; i < r.matches.length; i++) { const m = r.matches[i]; m.state = 1; m.outcome = 3; m.by = 3; m.played_at = c.now; m.review = { at: c.now, timeout: true }; r.timeouts++; this.s.n_timeouts++; }
    r.next_match = r.matches.length;
    let { pts, wins } = this.tally(r);
    r.entries.forEach((e, i) => { if (e.flagged) { pts[i] = 0; wins[i] = 0; } });
    const order = this.order(r, pts, wins);
    let paid = 0n, forfeits = 0n;
    r.entries.forEach((e, i) => {
      const bond = e.bond; e.points = pts[i]; e.wins = wins[i];
      if (e.flagged) { forfeits += bond; e.rank = 0; e.payout = 0n; }
      else { const p = BigInt(pts[i]) * r.unit; paid += p; e.rank = order.indexOf(i) + 1; e.payout = p; this.credit(e.who, p + bond); }
      e.bond = 0n;
    });
    const back = r.pool - paid + forfeits;
    if (back > 0n) this.credit(r.host, back);
    const held = r.pool + r.bonds;
    r.paid_out = paid; r.returned = back > 0n ? back : 0n; r.pool = 0n; r.bonds = 0n; r.state = 2; r.finished_at = c.now;
    this.s.locked -= held; this.s.n_done++;
  }
  claim(c) {
    const k = c.sender.toLowerCase(), amt = this.s.credit[k] ?? 0n;
    if (amt <= 0n) throw new UserErr("There is nothing to claim.");
    delete this.s.credit[k]; this.s.owed -= amt; this.s.claimed += amt; this.s.n_claims++;
    this.s.balances[k] = (this.s.balances[k] ?? 0n) + amt;
  }
  // ---- views ----
  entryRow(r, i, tally, order) {
    const e = r.entries[i], done = r.state === 2;
    const points = done ? e.points : e.flagged ? 0 : tally.pts[i], wins = done ? e.wins : e.flagged ? 0 : tally.wins[i];
    const rank = done ? e.rank : r.state === 1 && order.includes(i) ? order.indexOf(i) + 1 : 0;
    return { index: i, who: e.who, name: e.name, pitch: e.pitch, url: e.url, flagged: e.flagged, bond: e.bond.toString(), points, wins, rank, payout: e.payout.toString(), joined: e.joined };
  }
  matchRow(r, i) { const m = r.matches[i]; return { index: i, a: m.a, b: m.b, state: m.state, outcome: m.outcome, by: m.by, tries: m.tries, last_try: m.last_try, played_at: m.played_at, review: m.review }; }
  roundRow(id, full) {
    const r = this.s.rounds[id], t = this.tally(r), order = this.order(r, t.pts, t.wins);
    const final = r.state === 1 || r.state === 2, n = Math.max(r.entries.length, r.min_entries);
    const price = r.state === 3 ? 0n : final ? r.unit : r.pool / BigInt(2 * pairsOf(n));
    const row = { id, host: r.host, title: r.title, mission: r.mission, state: r.state, need_evidence: r.need_evidence, min_fit: r.min_fit, entry_bond: r.entry_bond.toString(), min_entries: r.min_entries, max_entries: r.max_entries, entry_count: r.entries.length, created: r.created, entry_deadline: r.entry_deadline, play_window: r.play_window, started_at: r.started_at, play_deadline: r.play_deadline, finished_at: r.finished_at, prize: r.prize.toString(), pool: r.pool.toString(), bonds: r.bonds.toString(), price_per_point: price.toString(), price_final: final || r.state === 3, match_count: r.matches.length, next_match: r.next_match, judged: r.judged, voided: r.voided, timeouts: r.timeouts, paid_out: r.paid_out.toString(), returned: r.returned.toString() };
    if (full) { row.entries = r.entries.map((_, i) => this.entryRow(r, i, t, order)); row.matches = r.matches.map((_, i) => this.matchRow(r, i)); }
    return row;
  }
}

// ---- state: seeded once, then kept in localStorage ---------------------------------------------------------------------
function fresh() {
  const s = { rounds: [], credit: {}, joined: {}, deposited: 0n, claimed: 0n, owed: 0n, locked: 0n, n_entries: 0, n_judged: 0, n_voided: 0, n_timeouts: 0, n_flagged: 0, n_claims: 0, n_done: 0, n_cancelled: 0, balances: {}, n: 0 };
  s.balances[DEMO_ADDRESS.toLowerCase()] = 25n * U;
  const sim = new Sim(s), t = now();
  const as = (who, value, at) => ({ sender: PEOPLE[who], value, now: at });
  const day = 86400;
  // 1) a finished round
  sim.create(as("host", 3n * U, t - 6 * day), ["Best first-hour experience for new GenLayer builders", "Pitch the single change that would help a new builder ship a first Intelligent Contract in under an hour. Point to evidence: a docs page, a repo, a measured result.", 100000000000000000n, 3, 4, 2 * day, 2 * day, 50, true]);
  const pit = {
    nora: ["Nora", "A guided first contract that deploys in one click from the docs page, with the exact consensus steps shown as they happen, so the builder sees why a result is accepted.", "https://docs.genlayer.com/developers/intelligent-contracts/introduction"],
    omar: ["Omar", "A starter template picker with five tiny contracts, each with a test that runs in Studio before any wallet is needed. Cuts the setup to minutes and shows a green result first.", "https://github.com/genlayerlabs/genlayer-project-boilerplate"],
    lena: ["Lena", "An error explainer that turns a failed deploy into one plain sentence and a fix. Most first-hour drop-offs are stack traces nobody can read.", "https://docs.genlayer.com/developers"],
    demo: ["Demo Dev", "A weekly office hour in the Discord with a recorded walkthrough of the same first contract, so newcomers see it done once end to end by a human, and can replay it when they get stuck.", "https://www.genlayer.com/blog"],
  };
  for (const [k, v] of Object.entries(pit)) sim.enter(as(k, 100000000000000000n, t - 5 * day), [0, v[0], v[1], v[2]]);
  sim.start(as("host", 0n, t - 5 * day + 7200), [0]);
  for (let i = 0; i < 6; i++) sim.play({ sender: PEOPLE.host, value: 0n, now: t - 4 * day + i * 300 }, [0]);
  sim.finalize({ sender: PEOPLE.host, value: 0n, now: t - 3 * day }, [0]);
  // 2) a round being played
  sim.create(as("demo", 1500000000000000000n, t - 2 * day), ["Name the next Mochi merch drop", "Suggest a name and one-line concept for the next Mochi merch drop that fits GenLayer's playful, technical tone. Explain why the name works and link an example of the style.", 50000000000000000n, 3, 4, 3600, 3 * day, 25, false]);
  const nm = { nora: ["Nora", "Night Shift Mochi: a hoodie line for builders who ship after midnight, with a glow-in-the-dark consensus diagram on the sleeve and a pun on validators agreeing at 3 a.m."], omar: ["Omar", "Mochi Majority: a sticker pack of validators voting, each a tiny Mochi with a different expression. Cheap to make, fun to trade, instantly readable."], lena: ["Lena", "Cold Start Kit: a tote and mug set for new builders, printed with the five commands needed to deploy a first contract. Useful on the desk, not only on the shelf."], zoe: ["Zoe", "Proof of Snack: a limited tin of mochi candies with a QR code that opens the contract of the day. A physical item people actually open and talk about."] };
  for (const [k, v] of Object.entries(nm)) sim.enter(as(k, 50000000000000000n, t - 2 * day + 600), [1, v[0], v[1], ""]);
  sim.start(as("demo", 0n, t - 2 * day + 3700), [1]);
  for (let i = 0; i < 3; i++) sim.play({ sender: PEOPLE.host, value: 0n, now: t - day + i * 400 }, [1]);
  // 3) an open round
  sim.create(as("host", 800000000000000000n, t - 3600), ["Explain consensus to a 12 year old", "Write a short, correct explanation of how GenLayer validators reach agreement on a non-deterministic result, for a 12 year old. Plain words, one example, no jargon. Link a source if you have one.", 20000000000000000n, 3, 5, 2 * day, 2 * day, 50, false]);
  sim.enter({ sender: PEOPLE.lena, value: 20000000000000000n, now: t - 3000 }, [2, "Lena", "Five friends are asked what the best pizza topping is. Each answers in their own words, so they will never match exactly. They agree if most pick the same idea. Validators do that with answers.", ""]);
  sim.enter({ sender: PEOPLE.kai, value: 20000000000000000n, now: t - 2400 }, [2, "Kai", "A referee watches a game, then four more referees watch it too. The first referee says who won; the others only check that they would have said the same. If most agree, the result stands.", ""]);
  return s;
}
let cache = null;
function load() {
  if (cache) return cache;
  try { const raw = localStorage.getItem(KEY); if (raw) return (cache = de(raw)); } catch {}
  cache = fresh(); save(); return cache;
}
function save() { try { localStorage.setItem(KEY, ser(cache)); } catch {} }
export function resetDemo() { cache = null; try { localStorage.removeItem(KEY); localStorage.removeItem(WKEY); } catch {} }

// ---- the chain.js surface ----------------------------------------------------------------------------------------------
export async function read(fn, args) {
  await sleep(120);
  const s = load(), sim = new Sim(s);
  switch (fn) {
    case "stats": return { rounds: s.rounds.length, entries: s.n_entries, judged: s.n_judged, voided: s.n_voided, timeouts: s.n_timeouts, flagged: s.n_flagged, done: s.n_done, cancelled: s.n_cancelled, claims: s.n_claims, deposited: s.deposited.toString(), claimed: s.claimed.toString(), owed: s.owed.toString(), locked: s.locked.toString() };
    case "solvency": { const inside = s.deposited - s.claimed; return { deposited: s.deposited.toString(), claimed: s.claimed.toString(), owed: s.owed.toString(), locked: s.locked.toString(), balanced: inside === s.owed + s.locked, native: inside.toString(), in_sync: true }; }
    case "audit_books": { let locked = 0n; for (const r of s.rounds) if (r.state < 2) locked += r.pool + r.bonds; const owed = Object.values(s.credit).reduce((a, b) => a + b, 0n); return { ok: owed === s.owed && locked === s.locked && s.deposited - s.claimed === owed + locked, owed: owed.toString(), locked: locked.toString() }; }
    case "get_round": sim.round(args[0]); return sim.roundRow(args[0], true);
    case "list_rounds": { const [offset, limit] = args, out = []; for (let i = s.rounds.length - 1 - Math.max(0, offset); i >= 0 && out.length < Math.min(limit, 50); i--) out.push(sim.roundRow(i, false)); return out; }
    case "rounds_of": { const ids = s.joined[String(args[0]).toLowerCase()] ?? [], [offset, limit] = [args[1], args[2]], out = []; for (let i = ids.length - 1 - Math.max(0, offset); i >= 0 && out.length < Math.min(limit, 50); i--) out.push(sim.roundRow(ids[i], false)); return out; }
    case "get_match": { const r = sim.round(args[0]); if (args[1] < 0 || args[1] >= r.matches.length) throw new UserErr("No such match."); return sim.matchRow(r, args[1]); }
    case "credit_of": return (s.credit[String(args[0]).toLowerCase()] ?? 0n).toString();
    case "schedule_of": return Array.from({ length: pairsOf(args[0]) }, (_, m) => pairAt(args[0], m));
    case "would_steer": return steers(String(args[0]));
    default: throw new Error("Unknown view " + fn);
  }
}
export function balanceOf(addr) { return Promise.resolve(load().balances[String(addr).toLowerCase()] ?? 0n); }

const FN = { create_round: "create", top_up: "topUp", enter: "enter", withdraw_entry: "withdraw", remove_entry: "remove", start_round: "start", cancel_round: "cancel", play_next: "play", finalize_round: "finalize", claim: "claim" };
export async function send({ fn, args, value = 0n, from, onStage }) {
  const s = load(), sim = new Sim(s), k = String(from).toLowerCase();
  onStage("wallet"); await sleep(1100);
  const hash = "0x" + hex(hashStr(fn + Date.now())) + hex(hashStr(String(++s.n))).repeat(7);
  onStage("sent", { hash }); await sleep(700);
  onStage("queued", { hash, status: "PENDING" }); await sleep(fn === "play_next" ? 1500 : 800);
  onStage("proposing", { hash, status: "PROPOSING" }); await sleep(fn === "play_next" ? 2600 : 700);
  onStage("voting", { hash, status: "COMMITTING" }); await sleep(fn === "play_next" ? 2200 : 800);
  const bal = s.balances[k] ?? 0n;
  try {
    if (value > bal) throw new UserErr("Not enough GEN in the demo wallet.");
    const method = FN[fn]; if (!method) throw new UserErr("Unknown method.");
    const before = ser(s);
    try { sim[method]({ sender: from, value, now: now() }, args); s.balances[k] = bal - value; }
    catch (e) { Object.assign(s, de(before)); throw e; }
    save(); onStage("accepted", { hash, status: "ACCEPTED" });
    return { hash, status: "ACCEPTED", ok: true, known: true, detail: "" };
  } catch (e) {
    if (!(e instanceof UserErr)) throw e;
    // On Studionet a refused payable call leaves the attached GEN inside the contract. The demo shows the same.
    if (value > 0n && value <= bal) { s.balances[k] = bal - value; s.trapped = (s.trapped ?? 0n) + value; }
    save(); onStage("accepted", { hash, status: "ACCEPTED" });
    return { hash, status: "ACCEPTED", ok: false, known: true, detail: e.message };
  }
}

// ---- the pretend wallet (announces itself exactly like a real EIP-6963 wallet) ----------------------------------------
export function registerDemoWallet() {
  const st = (() => { try { return JSON.parse(localStorage.getItem(WKEY) || "{}"); } catch { return {}; } })();
  const persist = () => { try { localStorage.setItem(WKEY, JSON.stringify(st)); } catch {} };
  st.chain ??= 1; st.granted ??= false; st.added ??= false;
  const handlers = {};
  const fire = (ev, arg) => (handlers[ev] ?? []).forEach((f) => f(arg));
  const provider = {
    isDemo: true,
    on(ev, f) { (handlers[ev] ??= []).push(f); },
    removeListener(ev, f) { handlers[ev] = (handlers[ev] ?? []).filter((x) => x !== f); },
    async request({ method, params = [] }) {
      switch (method) {
        case "eth_requestAccounts": await sleep(700); st.granted = true; persist(); return [DEMO_ADDRESS];
        case "eth_accounts": return st.granted ? [DEMO_ADDRESS] : [];
        case "eth_chainId": return "0x" + st.chain.toString(16);
        case "wallet_switchEthereumChain": {
          const want = parseInt(params[0].chainId, 16);
          await sleep(500);
          if (want !== CONFIG.chainId || !st.added) { const e = new Error("Unrecognized chain ID. Try adding the chain using wallet_addEthereumChain first."); e.code = 4902; throw e; }
          st.chain = want; persist(); fire("chainChanged", "0x" + want.toString(16)); return null;
        }
        case "wallet_addEthereumChain": await sleep(700); st.added = true; st.chain = parseInt(params[0].chainId, 16); persist(); fire("chainChanged", "0x" + st.chain.toString(16)); return null;
        case "wallet_revokePermissions": st.granted = false; persist(); return null;
        case "eth_getBalance": return "0x" + (await balanceOf(params[0])).toString(16);
        default: { const e = new Error("The demo wallet does not support " + method); e.code = 4200; throw e; }
      }
    },
  };
  const icon = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#ff7a18"/><path d="M8 21l4-9 4 6 3-4 5 7z" fill="#fff"/></svg>');
  const detail = Object.freeze({ info: Object.freeze({ uuid: "00000000-demo-wallet", name: "Demo Wallet", icon, rdns: "app.matchplay.demo" }), provider });
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
}
