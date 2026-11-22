// A line-by-line port of the contract's input rules (contracts/matchplay.py). A payable call that the contract refuses
// leaves its GEN stuck in the contract on Studionet, so every payable call is checked here first.
import { LIMITS as L } from "../config.js";

const INVISIBLE = new Set(
  [0x00ad, 0x061c, 0x180e, 0xfeff]
    .concat(range(0x200b, 0x2010), range(0x202a, 0x202f), range(0x2060, 0x2065), range(0x2066, 0x206a)),
);
function range(a, b) {
  const out = [];
  for (let i = a; i < b; i++) out.push(i);
  return out;
}
const chars = (s) => Array.from(String(s ?? ""));
const stripInvisible = (s) => chars(s).filter((c) => !INVISIBLE.has(c.codePointAt(0))).join("");
const NONPRINT = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]/u;

/** contract _clean: printable text, single spaces, no angle brackets */
export function clean(s) {
  const out = chars(stripInvisible(s)).map((c) => (c === " " || !NONPRINT.test(c) ? c : " ")).join("");
  return out.replace(/</g, "(").replace(/>/g, ")").split(/\s+/).filter(Boolean).join(" ");
}

/** contract _norm: invisible dropped, NFKC, lower case, single spaces */
export function norm(s) {
  let t = stripInvisible(s);
  try {
    t = t.normalize("NFKC");
  } catch {
    /* keep */
  }
  return t.toLowerCase().split(/\s+/).filter(Boolean).join(" ");
}

/** contract _pkey: letters and digits of any script, first 120 */
export const pkey = (pitch) => chars(norm(pitch)).filter((c) => /[\p{L}\p{N}]/u.test(c)).slice(0, 120).join("");

const ENTRY = "(?:entry|project|submission|proposal|pitch|one)";
const STEER = new RegExp(
  [
    "ignore (?:all |any |the |every |your )?(?:previous|prior|above|earlier|preceding|former)\\b",
    "disregard (?:all |any |the |every |your )?(?:previous|prior|above|earlier|mission|rules|instructions|criteria)",
    "forget (?:all |any |the |your )?(?:previous|prior|above|earlier|mission|rules|instructions)",
    "(?:new|updated|real|actual|replace|replacing) (?:the )?(?:system|developer) (?:prompt|message|instructions?)",
    "(?:system|developer) (?:prompt|message|instructions?) ?[:=]",
    "override (?:the |all |any )?(?:mission|rules|criteria|judge|judging|bar)",
    "(?:dear|attention|note to|message to|instructions? (?:for|to)) (?:the )?(?:judge|reviewer|evaluator|ai|llm|language model)\\b",
    "(?:reply|respond|answer|output|say) (?:with|only|just) [\"']?(?:winner|entry ?(?:1|2|one|two))",
    "\"winner\"\\s*:|\\b(?:fit|level)_[12]\\b",
    "(?:pick|choose|select|prefer|declare) (?:this|my|our|the first|the second) " + ENTRY + "\\b",
    "(?:pick|choose|select|prefer|declare) entry ?(?:1|2|one|two)\\b",
    "(?:this|my|our) " + ENTRY + " (?:must|should|has to|deserves to) (?:win|be (?:picked|chosen|first|ranked first))",
    "(?:give|award|assign) (?:this|it|me|us|my|our)(?: " + ENTRY + ")? (?:the )?(?:full|top|maximum|highest|perfect|100)\\b",
    "(?:rate|score) (?:this|it|me|us|my|our)(?: " + ENTRY + ")? (?:as )?(?:100|10/10|perfect|highest)\\b",
  ].join("|"),
  "i",
);
/** local preview of the tripwire; the authoritative answer is the contract's would_steer() view */
export const steersLocal = (text) => STEER.test(norm(text));

const URL_RE = /^https?:\/\/([^/?#\s]+)([/?#]\S*)?$/;
const LABEL = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)$/;
const BAD_TLD = new Set(["local", "localhost", "internal", "lan", "home", "corp", "intranet", "test", "invalid", "example", "onion", "arpa", "localdomain"]);
const BAD_SUFFIX = ["nip.io", "sslip.io", "xip.io", "localtest.me", "lvh.me", "traefik.me"];
const TRACKING = ["utm_", "fbclid", "gclid", "mc_", "ref_src"];

export function lowerScheme(url) {
  for (const s of ["https://", "http://"]) if (url.slice(0, s.length).toLowerCase() === s) return s + url.slice(s.length);
  return url;
}

export function publicUrl(url) {
  if (!url || url.length > L.MAX_URL || chars(url).some((c) => c.codePointAt(0) < 33 || c.codePointAt(0) > 126)) return false;
  const m = URL_RE.exec(url);
  if (!m) return false;
  let host = m[1].toLowerCase();
  if (host.includes("@")) return false;
  if (host.includes(":")) {
    const i = host.indexOf(":");
    const port = host.slice(i + 1);
    host = host.slice(0, i);
    if (port !== "80" && port !== "443") return false;
  }
  const labels = host.split(".");
  if (labels.length < 2 || !labels.every((x) => LABEL.test(x))) return false;
  const tld = labels[labels.length - 1];
  if (!(/^[a-z]+$/.test(tld) && tld.length >= 2) && !tld.startsWith("xn--")) return false;
  if (BAD_TLD.has(tld)) return false;
  for (let i = 0; i < labels.length - 3; i++) if (labels.slice(i, i + 4).every((x) => /^\d+$/.test(x))) return false;
  return !BAD_SUFFIX.some((s) => host === s || host.endsWith("." + s));
}

/** contract _url_key without the hash: the same document under another spelling gives the same string */
export function urlKey(url) {
  const m = URL_RE.exec(url);
  if (!m) return "";
  let host = m[1].toLowerCase();
  for (const d of [":80", ":443"]) if (host.endsWith(d)) host = host.slice(0, -d.length);
  if (host.startsWith("www.")) host = host.slice(4);
  const rest = (m[2] || "").split("#")[0];
  const q = rest.indexOf("?");
  let path = q < 0 ? rest : rest.slice(0, q);
  const query = q < 0 ? "" : rest.slice(q + 1);
  const up = (x) => x.replace(/%[0-9a-fA-F]{2}/g, (s) => s.toUpperCase());
  path = up(path).replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  const pairs = query.split("&").filter((p) => p && !TRACKING.some((t) => p.toLowerCase().startsWith(t))).map(up).sort();
  return host + path + (pairs.length ? "?" + pairs.join("&") : "");
}

// ---- whole-call checks -------------------------------------------------------------------------------------------

export function checkCreate(f) {
  const issues = [];
  const title = clean(f.title), mission = clean(f.mission);
  if (title.length < L.MIN_TITLE || title.length > L.MAX_TITLE) issues.push(`The title needs ${L.MIN_TITLE} to ${L.MAX_TITLE} characters.`);
  if (mission.length < L.MIN_MISSION || mission.length > L.MAX_MISSION) issues.push(`The mission needs ${L.MIN_MISSION} to ${L.MAX_MISSION} characters.`);
  if (f.bond == null || f.bond < L.MIN_BOND || f.bond > L.MAX_AMOUNT) issues.push("The entry bond has to be at least 0.001 GEN.");
  if (!Number.isInteger(f.minEntries) || !Number.isInteger(f.maxEntries) || f.minEntries < L.MIN_ENTRIES || f.maxEntries > L.MAX_ENTRIES || f.minEntries > f.maxEntries)
    issues.push("The round needs 3 to 8 entries, and the minimum cannot be above the maximum.");
  if (!(f.entryWindow >= L.MIN_WINDOW && f.entryWindow <= L.MAX_WINDOW)) issues.push("The entry window has to be between 1 minute and 30 days.");
  if (!(f.playWindow >= L.MIN_WINDOW && f.playWindow <= L.MAX_WINDOW)) issues.push("The playing window has to be between 1 minute and 30 days.");
  if (!Number.isInteger(f.minFit) || f.minFit < 0 || f.minFit > L.MAX_FIT_BAR) issues.push("The bar has to be between 0 and 90.");
  if (f.prize == null || f.prize < L.MIN_POOL || f.prize > L.MAX_AMOUNT) issues.push("Attach at least 0.002 GEN as the prize.");
  else if (Number.isInteger(f.maxEntries) && f.maxEntries >= 3 && f.maxEntries <= 8) {
    const worst = (f.maxEntries * (f.maxEntries - 1)) / 2;
    if (f.prize / BigInt(2 * worst) <= 0n) issues.push("The prize is too small for this many matches.");
  }
  return issues;
}

/** Everything enter() checks, in the same order, against the round as it is now. */
export function checkEnter({ round, me, name, pitch, url, now }) {
  const issues = [];
  if (!round) return ["The round could not be read."];
  if (round.state !== 0) issues.push("The round is not open for entries.");
  if (now >= round.entry_deadline) issues.push("The entry time is over.");
  if (round.entries.length >= round.max_entries) issues.push("The round is full.");
  if (me && round.host.toLowerCase() === me.toLowerCase()) issues.push("The host cannot enter their own round.");
  if (me && round.entries.some((e) => e.who.toLowerCase() === me.toLowerCase())) issues.push("This address already has an entry in the round.");
  const n = clean(name), p = clean(pitch);
  if (n.length < L.MIN_NAME || n.length > L.MAX_NAME) issues.push("The name needs 2 to 40 characters.");
  if (p.length < L.MIN_PITCH || p.length > L.MAX_PITCH) issues.push("The pitch needs 40 to 600 characters.");
  const pk = pkey(p);
  if (pk.length < L.MIN_PITCH_LETTERS) issues.push("The pitch needs at least 20 letters or digits, not just symbols.");
  if (steersLocal(n) || steersLocal(p)) issues.push("The name or the pitch tries to steer the judge.");
  const u = lowerScheme((url || "").trim());
  let uk = "";
  if (u) {
    if (!publicUrl(u)) issues.push("The evidence must be a single public http(s) link.");
    else uk = urlKey(u);
  } else if (round.need_evidence) issues.push("This round needs a link to evidence.");
  for (const e of round.entries) {
    if (uk && e.url && urlKey(lowerScheme(e.url)) === uk) {
      issues.push("That evidence page already backs another entry.");
      break;
    }
    if (pk && pkey(e.pitch) === pk) {
      issues.push("That pitch is already used by another entry.");
      break;
    }
  }
  return issues;
}
