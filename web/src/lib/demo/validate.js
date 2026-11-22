// A browser port of the checks in contracts/matchplay.py.
// Why it exists: on Studionet a payable call that the contract refuses keeps the attached GEN inside the contract, outside
// the books, where claim() cannot reach it. So every payable call (create_round, enter, top_up) is checked here first,
// against the same limits, before any money is attached.
import steer from "./_steer.json";
import { RULES } from "./rules.js";

const STEER = new RegExp(steer.pattern, steer.flags);
const INVISIBLE = new Set([0x00ad, 0x061c, 0x180e, 0xfeff, ...range(0x200b, 0x2010), ...range(0x202a, 0x202f), ...range(0x2060, 0x2065), ...range(0x2066, 0x206a)]);
function range(a, b) { return Array.from({ length: b - a }, (_, i) => a + i); }
const strip = (s) => Array.from(String(s ?? "")).filter((ch) => !INVISIBLE.has(ch.codePointAt(0))).join("");
const len = (s) => Array.from(s).length;

/** Printable text with single spaces and no angle brackets (same as the contract's _clean). */
export function clean(s) {
  const out = Array.from(strip(s)).map((ch) => (/[\p{C}\p{Zl}\p{Zp}]/u.test(ch) || (/\p{Zs}/u.test(ch) && ch !== " ") ? " " : ch)).join("");
  return out.replace(/</g, "(").replace(/>/g, ")").split(/\s+/).filter(Boolean).join(" ");
}
export function norm(s) {
  return strip(s).normalize("NFKC").toLowerCase().split(/\s+/).filter(Boolean).join(" ");
}
export const steers = (text) => STEER.test(norm(text));
/** Identity of a pitch: its letters and digits in any script, first 120 only. */
export const pkey = (pitch) => Array.from(norm(pitch)).filter((ch) => /[\p{L}\p{N}]/u.test(ch)).join("").slice(0, 120);
export function lowerScheme(url) {
  for (const sch of ["https://", "http://"]) if (url.slice(0, sch.length).toLowerCase() === sch) return sch + url.slice(sch.length);
  return url;
}

const URL_RE = /^https?:\/\/([^/?#\s]+)([/?#]\S*)?$/;
const LABEL = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)$/;
const BAD_TLD = ["local", "localhost", "internal", "lan", "home", "corp", "intranet", "test", "invalid", "example", "onion", "arpa", "localdomain"];
const BAD_SUFFIX = ["nip.io", "sslip.io", "xip.io", "localtest.me", "lvh.me", "traefik.me"];
const TRACKING = ["utm_", "fbclid", "gclid", "mc_", "ref_src"];

export function publicUrl(url) {
  if (!url || url.length > RULES.MAX_URL || Array.from(url).some((c) => c.charCodeAt(0) < 33 || c.charCodeAt(0) > 126)) return false;
  const m = URL_RE.exec(url);
  if (!m) return false;
  let host = m[1].toLowerCase();
  if (host.includes("@")) return false;
  if (host.includes(":")) {
    const i = host.indexOf(":"); const port = host.slice(i + 1); host = host.slice(0, i);
    if (port !== "80" && port !== "443") return false;
  }
  const labels = host.split(".");
  if (labels.length < 2 || !labels.every((x) => LABEL.test(x))) return false;
  const tld = labels[labels.length - 1];
  if (!(/^[a-z]+$/.test(tld) && tld.length >= 2) && !tld.startsWith("xn--")) return false;
  if (BAD_TLD.includes(tld)) return false;
  for (let i = 0; i < labels.length - 3; i++) if (labels.slice(i, i + 4).every((x) => /^\d+$/.test(x))) return false;
  return !BAD_SUFFIX.some((s) => host === s || host.endsWith("." + s));
}
/** Same document under another spelling -> same string (the contract hashes this; equality is all we need). */
export function urlIdentity(url) {
  const m = URL_RE.exec(url);
  if (!m) return "";
  let host = m[1].toLowerCase();
  for (const d of [":80", ":443"]) if (host.endsWith(d)) host = host.slice(0, -d.length);
  if (host.startsWith("www.")) host = host.slice(4);
  const rest = (m[2] || "").split("#", 1)[0];
  const qi = rest.indexOf("?");
  let path = qi < 0 ? rest : rest.slice(0, qi); const query = qi < 0 ? "" : rest.slice(qi + 1);
  path = path.replace(/%[0-9a-fA-F]{2}/g, (x) => x.toUpperCase()).replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  const ps = query.split("&").filter((p) => p && !TRACKING.some((t) => p.toLowerCase().startsWith(t))).map((p) => p.replace(/%[0-9a-fA-F]{2}/g, (x) => x.toUpperCase())).sort();
  return host + path + (ps.length ? "?" + ps.join("&") : "");
}

const within = (n, [lo, hi]) => n >= lo && n <= hi;
const E = (field, message) => ({ field, message });

/** create_round arguments, as the contract reads them. Returns { errors, values }. */
export function checkRound(f) {
  const errors = [];
  const title = clean(f.title), mission = clean(f.mission);
  if (!within(len(title), RULES.TITLE)) errors.push(E("title", "The title needs 3 to 60 characters."));
  if (!within(len(mission), RULES.MISSION)) errors.push(E("mission", "The mission needs 30 to 1000 characters."));
  if (f.bond == null || f.bond < RULES.MIN_BOND || f.bond > RULES.MAX_AMOUNT) errors.push(E("bond", "The entry bond has to be at least 0.001 GEN."));
  if (!Number.isInteger(f.minEntries) || !Number.isInteger(f.maxEntries) || f.minEntries < RULES.MIN_ENTRIES || f.maxEntries > RULES.MAX_ENTRIES || f.minEntries > f.maxEntries)
    errors.push(E("entries", "The round needs 3 to 8 entries, and the minimum cannot be above the maximum."));
  if (!Number.isInteger(f.entryWindow) || !within(f.entryWindow, RULES.WINDOW)) errors.push(E("entryWindow", "The entry window has to be between 1 minute and 30 days."));
  if (!Number.isInteger(f.playWindow) || !within(f.playWindow, RULES.WINDOW)) errors.push(E("playWindow", "The playing window has to be between 1 minute and 30 days."));
  if (!Number.isInteger(f.minFit) || f.minFit < 0 || f.minFit > RULES.MAX_BAR) errors.push(E("minFit", "The bar has to be between 0 and 90."));
  if (f.prize == null || f.prize < RULES.MIN_POOL || f.prize > RULES.MAX_AMOUNT) errors.push(E("prize", "Attach at least 0.002 GEN as the prize."));
  else if (!errors.some((e) => e.field === "entries")) {
    const worst = (f.maxEntries * (f.maxEntries - 1)) / 2;
    if (f.prize / BigInt(2 * worst) <= 0n) errors.push(E("prize", "The prize is too small for a full round: one point would be worth nothing."));
  }
  return { errors, values: { title, mission } };
}

/** enter arguments. `round` is the get_round row (with entries), `me` the connected address. */
export function checkEntry(f, round, me) {
  const errors = [];
  if (round.state !== 0) errors.push(E("round", "The round is not open for entries."));
  if (Date.now() / 1000 >= round.entry_deadline) errors.push(E("round", "The entry time is over."));
  if (round.entries.length >= round.max_entries) errors.push(E("round", "The round is full."));
  if (me && me.toLowerCase() === round.host.toLowerCase()) errors.push(E("round", "The host cannot enter their own round."));
  if (me && round.entries.some((e) => e.who.toLowerCase() === me.toLowerCase())) errors.push(E("round", "This address already has an entry in the round."));
  const name = clean(f.name), pitch = clean(f.pitch);
  if (!within(len(name), RULES.NAME)) errors.push(E("name", "The name needs 2 to 40 characters."));
  if (!within(len(pitch), RULES.PITCH)) errors.push(E("pitch", "The pitch needs 40 to 600 characters."));
  const key = pkey(pitch);
  if (len(pitch) >= RULES.PITCH[0] && key.length < RULES.MIN_PITCH_LETTERS) errors.push(E("pitch", "The pitch needs at least 20 letters or digits, not just symbols."));
  if (steers(name) || steers(pitch)) errors.push(E("pitch", "The name or the pitch tries to steer the judge."));
  const url = lowerScheme((f.url || "").trim());
  let ident = "";
  if (url) {
    if (!publicUrl(url)) errors.push(E("url", "The evidence must be a single public http(s) link."));
    else ident = urlIdentity(url);
  } else if (round.need_evidence) errors.push(E("url", "This round needs a link to evidence."));
  for (const e of round.entries) {
    if (ident && e.url && urlIdentity(lowerScheme(e.url)) === ident) { errors.push(E("url", "That evidence page already backs another entry.")); break; }
    if (key && pkey(e.pitch) === key) { errors.push(E("pitch", "That pitch is already used by another entry.")); break; }
  }
  return { errors, values: { name, pitch, url } };
}
export function checkReason(r) {
  const t = clean(r);
  return len(t) >= 3 && len(t) <= 160 ? { ok: true, value: t } : { ok: false, message: "Give a reason of 3 to 160 characters." };
}
export const isAddress = (a) => /^0x[0-9a-fA-F]{40}$/.test(String(a || "").trim());
