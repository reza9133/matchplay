import { api, nativeBalance } from "../lib/chain.js";
import { useAsync, useTitle } from "../lib/hooks.js";
import { toBig, fmtGen } from "../lib/format.js";
import { Badge, Button, CopyButton, ErrorBox, Gen, Notice, SectionTitle, Stat } from "../components/UI.jsx";
import { CONTRACT_ADDRESS, EXPLORER_URL } from "../config.js";
import { BracketLoader } from "../components/Spinners.jsx";

export default function Ledger() {
  useTitle("Ledger");
  const st = useAsync(() => api.stats(), [], { every: 60000 });
  const sv = useAsync(() => api.solvency(), [], { every: 60000 });
  const au = useAsync(() => api.audit(), []);
  const bal = useAsync(() => nativeBalance(), [], { every: 60000 });
  const s = st.data, b = sv.data;
  const inside = b ? toBig(b.deposited) - toBig(b.claimed) : null;
  const extra = bal.data != null && inside != null ? bal.data - inside : null;
  return (
    <>
      <div className="page-head">
        <h1>Ledger</h1>
        <p>The contract credits first and sends later. These numbers show that every wei that came in is either sent out, waiting to be claimed, or held by a live round.</p>
      </div>
      <div className="card row between" style={{ marginBottom: 18 }}>
        <div><span className="muted">Contract on GenLayer Studionet</span><br /><code>{CONTRACT_ADDRESS}</code></div>
        <div className="row"><CopyButton text={CONTRACT_ADDRESS} /><Button as="a" tone="ghost" size="sm" href={`${EXPLORER_URL}/address/${CONTRACT_ADDRESS}`} target="_blank" rel="noreferrer">Explorer ↗</Button></div>
      </div>
      <ErrorBox error={st.error || sv.error} onRetry={() => { st.reload(); sv.reload(); }} />
      {!s && !st.error && <div style={{ display: "grid", placeItems: "center", padding: 50 }}><BracketLoader label="Reading the books…" /></div>}
      {s && b && (
        <>
          <div className="grid g4">
            <Stat label="Deposited" value={<Gen wei={s.deposited} digits={4} />} sub="every wei ever paid in" />
            <Stat label="Claimed" value={<Gen wei={s.claimed} digits={4} />} sub="sent out by claim()" />
            <Stat label="Owed" value={<Gen wei={s.owed} digits={4} />} sub="credited, not yet claimed" />
            <Stat label="Locked" value={<Gen wei={s.locked} digits={4} />} sub="held by open or playing rounds" />
          </div>
          <div className="grid g2" style={{ marginTop: 18 }}>
            <div className="card">
              <h3>Do the books balance? {b.balanced ? <Badge tone="green">yes</Badge> : <Badge tone="red">no</Badge>}</h3>
              <p className="muted">deposited − claimed = owed + locked</p>
              <p className="mono">{fmtGen(inside, 8)} = {fmtGen(toBig(b.owed) + toBig(b.locked), 8)} GEN</p>
              <h3 style={{ marginTop: 18 }}>Recomputed from scratch {au.loading ? "…" : au.data ? (au.data.ok ? <Badge tone="green">ok</Badge> : <Badge tone="red">mismatch</Badge>) : null}</h3>
              <p className="muted">audit_books() reads every round and every credit and compares them with the counters. {au.data?.why && <b className="err">{au.data.why}</b>}</p>
              {au.error && <p className="err">Could not run the audit right now.</p>}
              <Button tone="ghost" size="sm" onClick={au.reload} busy={au.loading}>Run the audit again</Button>
            </div>
            <div className="card">
              <h3>Contract balance vs. books</h3>
              <p className="mono">balance {bal.data != null ? fmtGen(bal.data, 8) : "…"} GEN<br />books {fmtGen(inside, 8)} GEN</p>
              {b.in_sync === false && <Badge tone="orange">not in sync</Badge>}
              {extra != null && extra > 0n && (
                <Notice tone="warn" title={`${fmtGen(extra, 8)} GEN sits outside the books`}>
                  Most likely GEN attached to refused payable calls (create_round, enter, top_up). On Studionet a refused call keeps its value in the contract, where claim() cannot reach it. This app checks every payable call first so it never causes this.
                </Notice>
              )}
              {extra != null && extra < 0n && <Notice tone="warn" title="Balance is lower than the books">A claim was emitted and its transfer has not been finalized yet. It should settle after the finality window.</Notice>}
              {extra === 0n && <Notice tone="ok">The contract holds exactly what the books say.</Notice>}
            </div>
          </div>
          <SectionTitle title="Counters" />
          <div className="grid g4">
            {[["Rounds", s.rounds], ["Entries", s.entries], ["Matches judged", s.judged], ["Voided", s.voided], ["Timed out", s.timeouts], ["Flagged entries", s.flagged], ["Rounds done", s.done], ["Rounds cancelled", s.cancelled], ["Claims", s.claims]].map(([l, v]) => <Stat key={l} label={l} value={v} />)}
          </div>
        </>
      )}
    </>
  );
}
