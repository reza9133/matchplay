import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/chain.js";
import { useTitle } from "../lib/hooks.js";
import { useWallet } from "../lib/wallet.jsx";
import { useTx } from "../lib/tx.jsx";
import { checkCreate, clean } from "../lib/validate.js";
import { fmtGen, pairsOf, parseGen } from "../lib/format.js";
import { Button, Field, Notice } from "../components/UI.jsx";
import { NeedWallet } from "../components/WalletUI.jsx";
import { LIMITS as L } from "../config.js";

const PRESETS = [
  { name: "Docs for beginners", title: "Beginner docs fund", mission: "Fund reference pages that explain reserved example domains to ordinary readers, in plain language, with at least one concrete example.", bar: 50 },
  { name: "Open-source tooling", title: "Small tools grant", mission: "Fund small open-source command line tools that save a developer at least ten minutes a day. The tool must be public, documented and usable today.", bar: 50 },
  { name: "Community event", title: "Meetup micro-grant", mission: "Fund a community meetup that brings at least twenty newcomers together to learn one concrete skill, with a clear plan for the venue and the agenda.", bar: 25 },
];
const UNITS = { minutes: 60, hours: 3600, days: 86400 };

function Duration({ label, value, unit, onValue, onUnit, hint }) {
  return (
    <Field label={label} hint={hint}>
      <div className="split" style={{ gridTemplateColumns: "1fr 130px" }}>
        <input type="number" min="1" value={value} onChange={(e) => onValue(e.target.value)} />
        <select value={unit} onChange={(e) => onUnit(e.target.value)}>{Object.keys(UNITS).map((u) => <option key={u}>{u}</option>)}</select>
      </div>
    </Field>
  );
}

export default function Create() {
  useTitle("Create a round");
  const nav = useNavigate();
  const w = useWallet();
  const tx = useTx();
  const [f, setF] = useState({ title: "", mission: "", prize: "0.02", bond: "0.002", min: 3, max: 4, ev: "1", evU: "hours", pv: "6", pvU: "hours", bar: 50, needEvidence: false });
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState([]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? (e.target.type === "checkbox" ? e.target.checked : e.target.value) : e }));

  const parsed = useMemo(
    () => ({
      title: f.title, mission: f.mission, prize: parseGen(f.prize), bond: parseGen(f.bond),
      minEntries: Number(f.min), maxEntries: Number(f.max),
      entryWindow: Math.round(Number(f.ev) * UNITS[f.evU]), playWindow: Math.round(Number(f.pv) * UNITS[f.pvU]), minFit: Number(f.bar), needEvidence: f.needEvidence,
    }),
    [f],
  );
  const live = useMemo(() => checkCreate(parsed), [parsed]);
  const eco = useMemo(() => {
    if (parsed.prize == null) return null;
    const row = (n) => ({ n, m: pairsOf(n), unit: parsed.prize / BigInt(2 * pairsOf(n)) });
    return [row(Math.max(3, parsed.minEntries || 3)), row(Math.min(8, parsed.maxEntries || 8))];
  }, [parsed]);
  const ladder = L.LEVEL_FIT.find((x) => x >= parsed.minFit) ?? 100;

  async function submit(e) {
    e.preventDefault();
    const problems = checkCreate(parsed);
    setIssues(problems);
    if (problems.length) return;
    setBusy(true);
    const r = await tx.send({
      fn: "create_round", label: "Create round", value: parsed.prize,
      args: [clean(parsed.title), clean(parsed.mission), parsed.bond, parsed.minEntries, parsed.maxEntries, parsed.entryWindow, parsed.playWindow, parsed.minFit, parsed.needEvidence],
    });
    if (r.ok && w.account) {
      for (let i = 0; i < 6; i++) {
        try {
          const mine = await api.roundsOf(w.account, 0, 1, { force: true, ttl: 0 });
          if (mine?.[0]) { nav(`/round/${mine[0].id}`); break; }
        } catch { /* retry */ }
        await new Promise((res) => setTimeout(res, 3000));
      }
    }
    setBusy(false);
  }

  return (
    <>
      <div className="page-head">
        <h1>Create a round</h1>
        <p>You are the host. The GEN you attach becomes the prize. What nobody earns comes back to you when the round ends.</p>
      </div>
      <form className="layout-2" onSubmit={submit}>
        <div className="card">
          <div className="chips" style={{ marginBottom: 18 }}>
            <span className="muted" style={{ alignSelf: "center" }}>Start from:</span>
            {PRESETS.map((p) => <button type="button" className="chip" key={p.name} onClick={() => setF((x) => ({ ...x, title: p.title, mission: p.mission, bar: p.bar }))}>{p.name}</button>)}
          </div>
          <Field label="Title" right={`${clean(f.title).length}/${L.MAX_TITLE}`}><input value={f.title} onChange={set("title")} maxLength={90} placeholder="Beginner docs fund" /></Field>
          <Field label="Mission" right={`${clean(f.mission).length}/${L.MAX_MISSION}`} hint="What should the winning entries do? The judge compares entries against exactly this text.">
            <textarea value={f.mission} onChange={set("mission")} rows={5} placeholder="Fund reference pages that…" />
          </Field>
          <div className="split">
            <Field label="Prize" hint={`At least 0.002 GEN. Fixed price per point is set at the start.`}><div className="input-suffix"><input inputMode="decimal" value={f.prize} onChange={set("prize")} /><em>GEN</em></div></Field>
            <Field label="Entry bond" hint="Refunded to entrants unless their evidence page steers the judge. At least 0.001 GEN."><div className="input-suffix"><input inputMode="decimal" value={f.bond} onChange={set("bond")} /><em>GEN</em></div></Field>
          </div>
          <div className="split">
            <Field label="Minimum entries"><select value={f.min} onChange={(e) => { const v = Number(e.target.value); setF((x) => ({ ...x, min: v, max: Math.max(v, x.max) })); }}>{[3, 4, 5, 6, 7, 8].map((n) => <option key={n}>{n}</option>)}</select></Field>
            <Field label="Maximum entries" hint={`${pairsOf(Number(f.max))} matches at most`}><select value={f.max} onChange={(e) => { const v = Number(e.target.value); setF((x) => ({ ...x, max: v, min: Math.min(v, x.min) })); }}>{[3, 4, 5, 6, 7, 8].map((n) => <option key={n}>{n}</option>)}</select></Field>
          </div>
          <div className="split">
            <Duration label="Entry window" value={f.ev} unit={f.evU} onValue={(v) => setF((x) => ({ ...x, ev: v }))} onUnit={(v) => setF((x) => ({ ...x, evU: v }))} hint="1 minute to 30 days" />
            <Duration label="Playing window" value={f.pv} unit={f.pvU} onValue={(v) => setF((x) => ({ ...x, pv: v }))} onUnit={(v) => setF((x) => ({ ...x, pvU: v }))} hint="Matches not played by then earn nothing" />
          </div>
          <Field label={`The bar: ${f.bar}`} hint={`An entry earns from a match only if the lower of its two scores is at least the bar. Scores are 0, 25, 50, 75 or 100, so a bar of ${f.bar} means an entry needs ${ladder}${ladder === 100 ? "" : " or more"}.`}>
            <input type="range" min="0" max={L.MAX_FIT_BAR} value={f.bar} onChange={set("bar")} />
          </Field>
          <label className="check"><input type="checkbox" checked={f.needEvidence} onChange={set("needEvidence")} /> Entries must include a link to an evidence page</label>
          {issues.length > 0 && <ul className="issues">{issues.map((i) => <li key={i}>{i}</li>)}</ul>}
          <NeedWallet label="Connect wallet to create">
            <Button type="submit" size="lg" busy={busy} disabled={tx.busy}>Create round for {parsed.prize != null ? fmtGen(parsed.prize, 6) : "?"} GEN</Button>
          </NeedWallet>
        </div>
        <aside className="card action-panel">
          <h3>What the numbers mean</h3>
          {eco ? (
            <table>
              <thead><tr><th>Entries</th><th>Matches</th><th>One point</th></tr></thead>
              <tbody>{eco.map((r, i) => <tr key={i}><td>{r.n}</td><td>{r.m}</td><td className="mono">{fmtGen(r.unit, 8)} GEN</td></tr>)}</tbody>
            </table>
          ) : <p className="err">Enter a valid prize.</p>}
          <p className="muted" style={{ fontSize: ".88rem" }}>A match is worth 2 points, so a round has 2 × matches points. The price of a point is <code>floor(prize / points)</code>, fixed at the start.</p>
          {live.length > 0 && <Notice tone="warn" title="Not valid yet">{live[0]}</Notice>}
          <Notice tone="info" title="Before you send money">This page checks every rule of the contract first. On Studionet a refused payable call keeps its GEN inside the contract, outside the books, so refused calls are never sent.</Notice>
        </aside>
      </form>
    </>
  );
}
