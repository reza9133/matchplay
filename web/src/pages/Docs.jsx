import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CHAIN_ID, CHAIN_NAME, CONTRACT_ADDRESS, EXPLORER_URL, GITHUB_URL, LIMITS, RPC_URL } from "../config.js";
import { CONTRACT_ERRORS } from "../lib/receipt.js";
import { useTitle } from "../lib/hooks.js";

const Tbl = ({ head, rows }) => (
  <div className="table-wrap"><table><thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table></div>
);

const SECTIONS = [
  { g: "Start here", id: "overview", t: "What is Matchplay", body: (
    <>
      <p><b>Matchplay</b> is an Intelligent Contract for <a href="https://www.genlayer.com" target="_blank" rel="noreferrer">GenLayer</a>. A host puts up prize money for a mission (“fund reference pages that explain reserved example domains to ordinary readers”). Entrants pay a small refundable bond and submit a pitch with an optional evidence page. Every pair of entries then meets exactly once, in a fixed order, and an AI judge decides each match. Points turn into money at a price that was fixed before the first match. What nobody earned goes back to the host.</p>
      <p>The contract is one file with no dependencies. Letting a language model decide who gets money is the easy part; making it safe is the work. So the contract is a small deterministic shell with the model in one narrow slot.</p>
      <Tbl head={["Problem", "What the contract does"]} rows={[
        ["A model that favours “the first answer” or “the second answer”", "Every match is judged twice with the entries swapped. An entry only wins when it wins in both orders; otherwise the match is a tie."],
        ["Paying for the best of a bad lot", "Each entry is also rated on its own on five levels (fits 0, 25, 50, 75, 100). It earns only if the lower of its two scores reaches the host's bar."],
        ["A model that is wrong once", "A match is worth exactly two points, so one wrong verdict moves one match, never the round."],
        ["Prices that move while people play", "The price of a point (prize / (2 × matches)) is fixed when the round starts."],
        ["Money the host never meant to give away", "What was not earned is credited back to the host."],
        ["Pitches and pages that talk to the judge", "A narrow tripwire turns a steering pitch away and flags a steering page. A flagged entry earns nothing in the whole round."],
        ["Pages that do not load", "The match is retried two minutes apart and after three tries it is voided. Nobody is punished."],
        ["A lazy or generous leader", "Validators accept a result only when everything stored or paid on is exactly equal to their own reading."],
      ]} />
    </>) },
  { g: "Start here", id: "quick-start", t: "Quick start", body: (
    <>
      <ol>
        <li><b>Connect a wallet.</b> Click <i>Connect wallet</i>. The app lists every wallet that announces itself in your browser (EIP-6963). Choose one and approve the request.</li>
        <li><b>Switch to GenLayer Studionet</b> if the yellow banner appears. One click adds the network if your wallet does not know it.</li>
        <li><b>Get test GEN.</b> Studionet GEN has no value; fund your address from the GenLayer Studio faucet/simulator.</li>
        <li><b>Create a round</b> (<Link to="/create">Create</Link>) or <b>enter</b> one from <Link to="/rounds">Rounds</Link>.</li>
        <li>When the round is full or its entry time is over, <b>start</b> it, then press <b>Run next match</b> until every match is played, then <b>Finalize</b>.</li>
        <li>Open <Link to="/me">My Matchplay</Link> and <b>claim</b> what you are owed.</li>
      </ol>
      <div className="callout">Without a wallet you can still browse everything: rounds, entries, verdicts and the ledger are public reads.</div>
    </>) },
  { g: "Start here", id: "lifecycle", t: "Round lifecycle", body: (
    <>
      <pre><code>{`              create_round (prize attached)
                         |
                       OPEN  ---- cancel_round (host, any time) --------> CANCELLED
   top_up (host)         |  \\---- cancel_round (anyone, entry time over and too few entries)
   enter / withdraw_entry / remove_entry
                         |
          start_round (host once the minimum is there; anyone when the round is full or the entry time is over)
                         |
                      PLAYING  ---- play_next (anyone), one match per call, in the fixed order
                         |
          finalize_round (anyone, once every match is played or the playing time is over)
                         |
                       DONE  ---- claim (everyone, for what they are owed)`}</code></pre>
      <p>Entry window and playing window are chosen by the host (1 minute to 30 days). If the playing time ends before every match is played, <code>finalize_round</code> settles the rest as “nobody earns”.</p>
    </>) },
  { g: "Rules", id: "entries", t: "Entries and schedule", body: (
    <>
      <ul>
        <li><b>3 to 8 entries</b> per round, one per address; the host cannot enter.</li>
        <li><b>Name:</b> 2 to 40 characters. <b>Pitch:</b> 40 to 600 characters with at least 20 letters or digits (any script), so symbols or emoji alone are not a pitch.</li>
        <li><b>Evidence:</b> one public <code>http(s)</code> link: no private addresses, no credentials, no odd ports. The scheme may be written in any case.</li>
        <li>Two entries cannot share an evidence page (any spelling of the same link) or a pitch. Pitches are compared by their letters and digits only, in any script, and only the first 120 count.</li>
        <li>A name or pitch that trips the tripwire is refused.</li>
        <li><b>Schedule:</b> entries <code>0..n-1</code> meet in the order <code>(0,1) (0,2) … (0,n-1) (1,2) …</code>. With 8 entries that is 28 matches.</li>
      </ul>
      <p>This site checks all of these rules in your browser before you send money, and previews the tripwire with the contract's own <code>would_steer()</code> view.</p>
    </>) },
  { g: "Rules", id: "how-a-match-is-decided", t: "How a match is decided", body: (
    <>
      <p>Reading 1 shows (A, B), reading 2 shows (B, A). Each reading returns a winner (<code>1</code>, <code>2</code> or <code>tie</code>) and a <b>level</b> from 0 to 4 for both entries: 0 unrelated or harmful, 1 barely related or unsupported, 2 partly, 3 well, 4 excellent and clearly evidenced. The contract turns a level into a fit with a fixed ladder: <code>{LIMITS.LEVEL_FIT.join(", ")}</code>. The fit of an entry is the <b>lower</b> of its two readings.</p>
      <ol>
        <li>An entry <b>clears the bar</b> when its fit is at least <code>min_fit</code> and it is not flagged.</li>
        <li>Neither clears: <b>nobody earns</b> (0 – 0).</li>
        <li>Exactly one clears: it wins (2 – 0). The bar always wins over the model's “winner”.</li>
        <li>Both clear: the winner must be the same entry in <b>both</b> orders to win (2 – 0). Anything else is a <b>tie</b> (1 – 1).</li>
      </ol>
      <p>A level may be an integer or a digit string; anything else (5, 2.5, <code>85%</code>, text) is a model failure: the call fails, nothing is rounded or clamped, nothing changes, and anyone can ask again. Free numbers from 0 to 100 are not used because an independent validator model can reproduce one of five levels but not an arbitrary integer.</p>
      <p>A match record carries <code>outcome</code> (0 A wins, 1 B wins, 2 tie, 3 nobody earns), <code>by</code> (1 judge, 2 void, 3 timeout) and a <code>review</code> with both fits, the winner of each reading, the judge's one-sentence reasons and a SHA-256 of each page text. Open any played match on a round page to read it.</p>
    </>) },
  { g: "Rules", id: "strikes", t: "A strike is final", body: (
    <>
      <p>When an entry's evidence page is found to talk to the judge, the entry is <b>flagged</b>. From then on it cannot clear the bar, its page is not read again, and its bond is forfeited to the host. The strike counts for the <b>whole round</b>: matches already judged against that entry are decided again from the stored fits and winners, by the same rule. A rival is therefore not worse off because a page changed late. A match can only change in the rival's favour and still gives two points at most, so the prize cannot be overdrawn. Voided and timed-out matches stay as they are.</p>
      <p>The match shows <Link to="/rounds">a “rescored” badge</Link>: its <code>review.rescored</code> holds the old result (<code>was</code>), who was flagged and when.</p>
    </>) },
  { g: "Rules", id: "validators", t: "How validators check a match", body: (
    <>
      <p>Every validator reads the same pages, asks the model the same two questions and compares its own result with the leader's. It accepts only on <b>exact equality</b> of every field the contract stores, counts or pays on: <code>kind</code>, <code>flagged</code>, <code>bad</code> (for unreadable pages), <code>fit</code>, <code>win</code>, <code>outcome</code> and <code>hash</code>. A neighbouring level, a more cautious leader or a different winner behind the same outcome are all refused. Only the free-text reasons may differ (a plain string, at most 160 characters, no angle brackets).</p>
      <p>When validators do not agree, that voting round does not settle and another leader is tried; nothing is paid on a result that an honest reading did not reproduce. In the app you may see a transaction end as <b>UNDETERMINED</b>: no state changed and you can run the match again immediately.</p>
    </>) },
  { g: "Rules", id: "money", t: "Where the money goes", body: (
    <>
      <pre><code>{`prize (host)  = P         bond (each entrant) = b          matches M = n(n-1)/2         points 2M
price of a point u = floor(P / 2M)                         (fixed at start_round)
entrant payout     = points * u                            (flagged entries: 0)
entrant gets back  = payout + b                            (a flagged entry loses its bond)
host gets back     = P - sum(payouts) + forfeited bonds    (unearned prize, dust, forfeits)`}</code></pre>
      <p><b>Example:</b> prize 0.012 GEN, bond 0.002 GEN, three entries. Three matches, six points, one point is worth 0.002 GEN. Points 4 / 2 / 0 pay 0.008 / 0.004 / 0 plus the bonds back; the host gets nothing back. If nobody clears the bar, every point is unearned and the host gets the whole 0.012 GEN back.</p>
      <p>Everything is <b>credited</b> first and <b>claimed</b> later, in one transfer per address. <code>credit_of(address)</code> is what can be claimed now; <code>claim()</code> sends it and clears it. <code>solvency()</code> shows <code>deposited − claimed == owed + locked</code>, and <code>audit_books()</code> recomputes it from scratch. See the <Link to="/ledger">Ledger</Link>.</p>
    </>) },
  { g: "Rules", id: "what-it-defends", t: "What it does and does not defend against", body: (
    <>
      <p><b>Defended:</b> positional manipulation (“pick the first one”), a judge that cannot be trusted twice in a row, unreadable evidence, hosts changing the rules after the start, strangers touching other people's money, rounding, replays and reordering.</p>
      <p><b>Not fully defended:</b> <i>content</i> injection — a pitch or page that argues persuasively for itself in a way the tripwire does not know. Swapping the order does not cancel it because the persuasive text is the same in both orders. The defences are the tripwire, the bar and the small cap on damage. Treat the judge as a participant that can be wrong, not as an oracle.</p>
      <ul>
        <li><b>Tripwire reach:</b> it folds case, invisible characters and compatibility forms (full-width, bold, circled letters, ligatures), but not look-alike letters of other alphabets.</li>
        <li><b>Sybils:</b> one person can enter several addresses. Each entry costs a bond; the host can remove entries before the start. Run rounds with entrants the host is willing to judge.</li>
        <li><b>Third-party pages:</b> cite pages you control. A rival could plant a steering sentence on a page others can edit, and a strike costs all of that entrant's points.</li>
      </ul>
    </>) },
  { g: "Using the site", id: "wallet", t: "Wallet and network", body: (
    <>
      <p>The site discovers wallets with <b>EIP-6963</b>: it dispatches <code>eip6963:requestProvider</code> and listens for <code>eip6963:announceProvider</code>, so several installed wallets never fight over <code>window.ethereum</code>. A browser that only injects <code>window.ethereum</code> still works through a fallback entry.</p>
      <ul>
        <li><b>Connect:</b> <code>eth_requestAccounts</code> on the wallet you pick. The last wallet is remembered and reconnected silently (<code>eth_accounts</code>, no popup).</li>
        <li><b>Disconnect:</b> the site forgets the account at once and asks the wallet to revoke the permission (<code>wallet_revokePermissions</code>) where supported. It never reconnects by itself after you disconnect.</li>
        <li><b>Network switch:</b> if the chain is wrong a banner appears and transactions are blocked. <i>Switch to Studionet</i> calls <code>wallet_switchEthereumChain</code> and, if the wallet does not know the network, <code>wallet_addEthereumChain</code>.</li>
      </ul>
      <Tbl head={["Setting", "Value"]} rows={[["Network name", CHAIN_NAME], ["Chain ID", `${CHAIN_ID} (0xf22f)`], ["RPC URL", <code key="r">{RPC_URL}</code>], ["Currency", "GEN (18 decimals)"], ["Explorer", <a key="e" href={EXPLORER_URL} target="_blank" rel="noreferrer">{EXPLORER_URL}</a>], ["Contract", <code key="c">{CONTRACT_ADDRESS}</code>]]} />
    </>) },
  { g: "Using the site", id: "studionet-quirks", t: "Studionet quirks", body: (
    <>
      <div className="callout warn"><b>Refused payable calls trap GEN.</b> If <code>create_round</code>, <code>enter</code> or <code>top_up</code> is refused, the contract undoes its state changes, but on Studionet the attached value stays in the contract's balance, outside the books, where <code>claim()</code> cannot reach it. The live test measured exactly this. So this site validates every payable call against the contract's own limits (bond, prize, name, pitch and link rules), previews the tripwire with <code>would_steer()</code> and re-reads the round, all <i>before</i> it attaches money.</div>
      <div className="callout"><b>UNDETERMINED is harmless.</b> If <code>play_next</code> resolves as UNDETERMINED because the validators did not reach strict consensus, no state changes and it can be retried immediately. Only a match whose evidence page could not be read (<code>tries &gt; 0</code>) has a 120-second cool-down.</div>
      <div className="callout"><b>Rate limit.</b> Studionet allows about 500 requests per hour per address. The site caches reads for a few seconds, shares identical requests, polls slowly and backs off for as long as the node asks.</div>
      <div className="callout"><b>Reads can lag.</b> A decided transaction may take a moment to show in views; the page reloads when a transaction is decided.</div>
    </>) },
  { g: "Reference", id: "interface-write", t: "Contract interface: write", body: (
    <Tbl head={["Method", "Who", "What"]} rows={[
      [<code key="1">create_round(title, mission, entry_bond, min_entries, max_entries, entry_window, play_window, min_fit, need_evidence)</code>, "anyone, payable", "Opens a round. The attached value (at least 0.002 GEN) is the prize. entry_bond at least 0.001 GEN, min_fit 0 to 90. Returns the round id."],
      [<code key="2">top_up(round_id)</code>, "host, payable", "Adds to the prize while the round is open."],
      [<code key="3">enter(round_id, name, pitch, evidence_url)</code>, "anyone but the host, payable", "Enters with exactly the entry bond. Returns the entry index."],
      [<code key="4">withdraw_entry(round_id)</code>, "entrant", "Leaves before the start; the bond is credited."],
      [<code key="5">remove_entry(round_id, entrant, reason)</code>, "host", "Turns an entry away before the start; the bond is credited. The reason (3 to 160 characters) lives in the transaction only."],
      [<code key="6">start_round(round_id)</code>, "see lifecycle", "Fixes the schedule and the price of a point."],
      [<code key="7">cancel_round(round_id)</code>, "host, or anyone after the entry time without enough entries", "Credits the prize and every bond back."],
      [<code key="8">play_next(round_id)</code>, "anyone", "Runs the next match (real model). Unreadable pages are retried after two minutes, then voided."],
      [<code key="9">finalize_round(round_id)</code>, "anyone", "Ends the round and credits payouts, bonds and the host's return."],
      [<code key="10">claim()</code>, "anyone", "Sends the caller everything credited to them."],
    ]} />) },
  { g: "Reference", id: "interface-read", t: "Contract interface: views", body: (
    <Tbl head={["View", "Returns"]} rows={[
      [<code key="1">get_round(id)</code>, "Round with entries and matches (JSON)."],
      [<code key="2">list_rounds(offset, limit)</code>, "Rounds newest first, pages of at most 50, without entries and matches."],
      [<code key="3">rounds_of(address, offset, limit)</code>, "Rounds an address hosts or has entered."],
      [<code key="4">get_match(round_id, index)</code>, "One match with its review."],
      [<code key="5">credit_of(address)</code>, "What an address can claim now (wei, as text)."],
      [<code key="6">schedule_of(entries)</code>, "The fixed order of matches as [a, b] pairs."],
      [<code key="7">would_steer(text)</code>, "Would the tripwire flag this text?"],
      [<code key="8">stats()</code>, "Counters and the four money totals."],
      [<code key="9">solvency()</code>, "deposited, claimed, owed, locked, balanced, native balance and in_sync."],
      [<code key="10">audit_books()</code>, "The same books recomputed from scratch."],
    ]} />) },
  { g: "Reference", id: "errors", t: "Errors", body: (
    <>
      <p>Every refusal is a plain sentence, and a refused call changes nothing. The site recognises these sentences in a transaction receipt and shows them in plain words.</p>
      <ul>{CONTRACT_ERRORS.map((e) => <li key={e}>{e}</li>)}</ul>
    </>) },
  { g: "Reference", id: "limitations", t: "Limitations", body: (
    <ul>
      <li>The tripwire is a phrase list, kept narrow on purpose because a flagged page loses its bond.</li>
      <li><code>claim</code> credits are cleared when the transfer is emitted; the contract cannot see whether it was delivered, only compare its balance with its books.</li>
      <li>A page unreachable for three tries two minutes apart voids a match for both entries. An entrant who controls its own page could fail on purpose to void a match against a strong rival; it gains nothing for itself.</li>
      <li>A pitch or page that makes the model's reply unusable on every try can stall the schedule; the round then ends when the playing time ends. Keep the playing window no longer than needed.</li>
      <li>Rounds are capped at eight entries (28 matches). Studionet is a test network.</li>
    </ul>) },
  { g: "Build", id: "deploy", t: "Run and deploy this front end", body: (
    <>
      <pre><code>{`npm install
npm run dev        # http://localhost:5173
npm run build      # static site in dist/ (works from any folder)`}</code></pre>
      <p>Set <code>VITE_CONTRACT_ADDRESS</code> in <code>.env</code> to point at another deployment, and <code>VITE_DEMO_VIDEO_URL</code> for the demo video. The router uses the URL hash, so GitHub Pages, IPFS or any static server work without rewrites. Source: <a href={GITHUB_URL} target="_blank" rel="noreferrer">{GITHUB_URL}</a>.</p>
    </>) },
  { g: "Build", id: "faq", t: "FAQ", body: (
    <>
      <h3>Why was my transaction “UNDETERMINED”?</h3><p>Validators did not reach strict consensus on the judge's reading. Nothing changed; run it again.</p>
      <h3>Why can't I run the next match right now?</h3><p>The previous try could not read an evidence page, so there is a two-minute pause. After three tries the match is voided.</p>
      <h3>Why did my entry lose its bond?</h3><p>Its evidence page was found to steer the judge. The strike counts for the whole round and the bond goes to the host.</p>
      <h3>Where is my GEN?</h3><p>Check <Link to="/me">My Matchplay</Link>: credited money must be claimed with <code>claim()</code>.</p>
      <h3>Can I enter with two addresses?</h3><p>Technically yes, each costs a bond; hosts can remove entries before the start.</p>
    </>) },
];

export default function Docs() {
  useTitle("Documentation");
  const { section } = useParams();
  const nav = useNavigate();
  const [active, setActive] = useState(section || SECTIONS[0].id);
  const refs = useRef({});

  useEffect(() => {
    if (section && refs.current[section]) refs.current[section].scrollIntoView({ behavior: "smooth", block: "start" });
  }, [section]);
  useEffect(() => {
    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && setActive(e.target.id)), { rootMargin: "-90px 0px -70% 0px" });
    Object.values(refs.current).forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);
  const groups = [...new Set(SECTIONS.map((s) => s.g))];
  return (
    <>
      <div className="page-head"><span className="eyebrow">Documentation</span><h1>Matchplay documentation</h1><p>How rounds work, how the judge decides, where the money goes, and how to use this site.</p></div>
      <div className="docs">
        <nav className="docs-nav" aria-label="Documentation sections">
          {groups.map((g) => (
            <div key={g}><h5>{g}</h5>{SECTIONS.filter((s) => s.g === g).map((s) => <a key={s.id} href={`#/docs/${s.id}`} className={active === s.id ? "on" : ""} onClick={(e) => { e.preventDefault(); nav(`/docs/${s.id}`); }}>{s.t}</a>)}</div>
          ))}
        </nav>
        <article className="prose">
          {SECTIONS.map((s) => <section key={s.id} id={s.id} ref={(el) => (refs.current[s.id] = el)}><h2>{s.t}</h2>{s.body}</section>)}
        </article>
      </div>
    </>
  );
}
