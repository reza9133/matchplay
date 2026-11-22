import { lazy, Suspense } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/chain.js";
import { useAsync, useTitle } from "../lib/hooks.js";
import { fmtGen } from "../lib/format.js";
import { Button, ErrorBox, SectionTitle, Stat, Tilt } from "../components/UI.jsx";
import { BracketLoader, JudgeSpinner, MochiSpinner } from "../components/Spinners.jsx";
import RoundCard from "../components/RoundCard.jsx";
import { CONTRACT_ADDRESS } from "../config.js";

const Arena3D = lazy(() => import("../components/Arena3D.jsx"));

const DEMO_NODES = ["Aurora", "Basalt", "Cobalt", "Dune", "Ember", "Fjord"].map((label, i) => ({ label, sub: `${[8, 6, 4, 6, 2, 0][i]} pts`, rank: i === 0 ? 1 : 0 }));
const DEMO_EDGES = (() => {
  const st = ["a", "a", "a", "a", "a", "a", "tie", "a", "b", "b", "pending", "pending", "pending", "none", "pending"];
  const out = [];
  let k = 0;
  for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) out.push({ a, b, state: st[k++] });
  return out;
})();

const STEPS = [
  ["Open", "A host attaches prize money and writes a mission, a bar and the rules of the round."],
  ["Enter", "Entrants pay a small refundable bond and submit a pitch with an optional evidence page."],
  ["Start", "The schedule and the price of a point are fixed. Every pair of entries meets exactly once."],
  ["Judge", "Each match is judged twice with the entries swapped. An entry must win in both orders."],
  ["Claim", "Points become money at the fixed price. What nobody earned goes back to the host."],
];
const SAFE = [
  ["⚖️", "Judged in both orders", "Position bias can never decide a match: a win must hold with the entries swapped, or it is a tie."],
  ["🎯", "A bar on absolute quality", "Each entry is also rated on its own. Entries below the host's bar earn nothing, even against a weaker rival."],
  ["🔒", "A price fixed up front", "The price of a point is set when the round starts. The prize can only grow while the round is open."],
  ["🚨", "Tripwire for steering text", "Pitches and evidence pages that talk to the judge are turned away or flagged. A strike counts for the whole round."],
  ["🤝", "Validators must agree exactly", "Every field the contract stores or pays on has to match the leader's reading. No tolerance, no neighbouring level."],
  ["📒", "Books you can audit", "Money is credited first and claimed later. solvency() and audit_books() check the ledger against the contract balance."],
];

export default function Home() {
  useTitle("");
  const stats = useAsync(() => api.stats(), [], { every: 45000 });
  const latest = useAsync(() => api.rounds(0, 3), [], { every: 60000 });
  const s = stats.data;
  return (
    <>
      <section className="hero" style={{ backgroundImage: "url(./img/hero.webp)", backgroundSize: "cover", backgroundPosition: "center" }}>
        <div className="hero-in">
          <span className="eyebrow">GenLayer Intelligent Contract · Studionet</span>
          <h1>Funding rounds where the judge must say <em>the same thing twice.</em></h1>
          <p>A host puts up a prize for a mission. Entrants pitch. Every pair meets once, an AI judge decides each match in both orders, and the money follows the points.</p>
          <div className="row" style={{ marginTop: 26 }}>
            <Button as={Link} to="/rounds" size="lg">Browse rounds</Button>
            <Button as={Link} to="/create" tone="orange" size="lg">Create a round</Button>
            <Button as={Link} to="/docs" tone="ghost" size="lg">Read the docs</Button>
          </div>
        </div>
        <div className="hero-coin float"><img src="./brand/gen-token.svg" alt="" /></div>
      </section>

      <div className="stat-strip">
        <div className="grid g4">
          <Stat label="Rounds" value={s ? s.rounds : "…"} sub={s ? `${s.done} done · ${s.cancelled} cancelled` : ""} />
          <Stat label="Entries" value={s ? s.entries : "…"} sub={s ? `${s.flagged} flagged` : ""} />
          <Stat label="Matches judged" value={s ? s.judged : "…"} sub={s ? `${s.voided} voided · ${s.timeouts} timed out` : ""} />
          <Stat accent label="GEN in play" value={s ? `${fmtGen(s.locked, 4)}` : "…"} sub={s ? `${fmtGen(s.deposited, 4)} deposited in total` : ""} />
        </div>
      </div>
      {stats.error && <ErrorBox error={stats.error} onRetry={stats.reload} />}

      <section className="section">
        <SectionTitle eyebrow="How it works" title="Five steps from prize to payout">One small contract, no dependencies. The model sits in one narrow slot; everything around it is deterministic.</SectionTitle>
        <div className="grid g3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
          {STEPS.map(([t, d], i) => (
            <Tilt key={t} className="card step-card">
              <div className="step-n">{i + 1}</div>
              <h3>{t}</h3>
              <p>{d}</p>
            </Tilt>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="grid g2" style={{ alignItems: "center", gap: 36 }}>
          <div>
            <span className="eyebrow">The arena</span>
            <h2 style={{ fontSize: "clamp(1.7rem,3.4vw,2.4rem)" }}>Every pair meets exactly once.</h2>
            <p className="muted">With n entries there are n(n−1)/2 matches, played in a fixed order. Each match is worth exactly two points, so a wrong verdict can move one match, never the round. Drag the arena to look around: blue arrows point at the winner of a match, purple is a tie, orange is the match being played.</p>
            <div className="card" style={{ display: "flex", gap: 22, alignItems: "center", padding: 18 }}>
              <JudgeSpinner label="Reading 1 (A first), reading 2 (B first)" />
              <p className="muted" style={{ margin: 0, fontSize: ".9rem" }}>An entry only wins when it wins in <b>both</b> orders. Otherwise the match is a 1–1 tie.</p>
            </div>
          </div>
          <div className="arena-wrap">
            <Suspense fallback={<div style={{ height: 440, display: "grid", placeItems: "center" }}><BracketLoader label="Setting up the arena…" /></div>}>
              <Arena3D nodes={DEMO_NODES} edges={DEMO_EDGES} active={10} height={440} />
            </Suspense>
            <span className="arena-hint">Drag to rotate · sample round</span>
          </div>
        </div>
      </section>

      <section className="section">
        <SectionTitle eyebrow="Why it is safe to let a model decide" title="A small deterministic shell around one narrow slot" />
        <div className="grid g3">
          {SAFE.map(([i, t, d]) => (
            <Tilt key={t} className="card feature"><span className="ico">{i}</span><h3>{t}</h3><p>{d}</p></Tilt>
          ))}
        </div>
        <p style={{ textAlign: "center", marginTop: 20 }}><Link to="/docs/what-it-defends">What it does and does not defend against →</Link></p>
      </section>

      <section className="section">
        <div className="grid g2" style={{ alignItems: "center", gap: 36 }}>
          <Tilt className="mascot-card" max={6}>
            <img src="./img/mochi-stage.webp" alt="Mochi, the GenLayer mascot, in the playoff arena" />
            <div className="bubble">Hi, I am Mochi! I keep the score while the judge reads twice. 🏆</div>
          </Tilt>
          <div>
            <span className="eyebrow">Play along</span>
            <h2 style={{ fontSize: "clamp(1.7rem,3.4vw,2.4rem)" }}>Run a round in a few minutes.</h2>
            <p className="muted">Connect a wallet on GenLayer Studionet, open a round with a small prize, invite three friends to enter, then run the matches. Anyone can press “Run next match”, and anyone can finalize when the matches are done.</p>
            <div className="row"><Button as={Link} to="/create">Open a round</Button><Button as={Link} to="/demo" tone="ghost">Watch the demo</Button></div>
            <div style={{ marginTop: 22 }}><MochiSpinner size={70} label="Mochi is waiting for the next match…" /></div>
          </div>
        </div>
      </section>

      <section className="section">
        <SectionTitle eyebrow="Live from Studionet" title="Latest rounds" />
        <ErrorBox error={latest.error} onRetry={latest.reload} />
        <div className="grid g3">{(latest.data || []).map((r) => <RoundCard key={r.id} r={r} />)}</div>
        {latest.data?.length === 0 && <p className="muted" style={{ textAlign: "center" }}>No rounds yet. <Link to="/create">Be the first to open one.</Link></p>}
        <p style={{ textAlign: "center", marginTop: 18 }}><Link to="/rounds">All rounds →</Link> <span className="muted"> · contract </span><code>{CONTRACT_ADDRESS}</code></p>
      </section>
    </>
  );
}
