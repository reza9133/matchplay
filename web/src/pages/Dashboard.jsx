import { Link } from "react-router-dom";
import { api } from "../lib/chain.js";
import { useAsync, useTitle } from "../lib/hooks.js";
import { useWallet } from "../lib/wallet.jsx";
import { useTx } from "../lib/tx.jsx";
import { fmtGen, sameAddr, toBig } from "../lib/format.js";
import { Badge, Button, Countdown, Empty, ErrorBox, Gen, Stat, StateBadge } from "../components/UI.jsx";
import { NeedWallet } from "../components/WalletUI.jsx";
import { MochiSpinner } from "../components/Spinners.jsx";
import { STATE } from "../config.js";

export default function Dashboard() {
  useTitle("My Matchplay");
  const w = useWallet();
  const tx = useTx();
  const credit = useAsync(() => api.credit(w.account), [w.account], { enabled: !!w.account, every: 45000 });
  const rounds = useAsync(() => api.roundsOf(w.account, 0, 50), [w.account], { enabled: !!w.account, every: 60000 });
  const owed = toBig(credit.data);

  if (!w.connected)
    return (
      <>
        <div className="page-head"><h1>My Matchplay</h1><p>Your rounds, your entries and the GEN waiting for you.</p></div>
        <div className="card"><Empty title="Connect a wallet">Connect a wallet to see the rounds you host or entered and to claim what you are owed.</Empty><p style={{ textAlign: "center" }}><NeedWallet /></p></div>
      </>
    );

  const rows = rounds.data || [];
  const hosting = rows.filter((r) => sameAddr(r.host, w.account));
  const todo = rows.filter((r) => (r.state === STATE.PLAYING) || (sameAddr(r.host, w.account) && r.state === STATE.OPEN && r.entry_count >= r.min_entries));
  return (
    <>
      <div className="page-head"><h1>My Matchplay</h1><p>Everything tied to <span className="mono">{w.account}</span>.</p></div>
      <ErrorBox error={credit.error || rounds.error} onRetry={() => { credit.reload(); rounds.reload(); }} />
      <div className="grid g3">
        <Stat accent label="Ready to claim" value={credit.data != null ? <Gen wei={owed} digits={6} /> : "…"} sub="credited to your address" />
        <Stat label="Rounds hosted" value={rounds.data ? hosting.length : "…"} />
        <Stat label="Rounds entered" value={rounds.data ? rows.length - hosting.length : "…"} />
      </div>
      <div className="card row between" style={{ margin: "18px 0" }}>
        <div><h3 style={{ margin: 0 }}>Claim your GEN</h3><p className="muted" style={{ margin: 0 }}>claim() sends everything credited to you in one transfer. The transfer is emitted when the transaction is finalized.</p></div>
        <NeedWallet><Button disabled={owed <= 0n || tx.busy} onClick={() => tx.send({ fn: "claim", label: `Claim ${fmtGen(owed, 6)} GEN`, args: [] })}>{owed > 0n ? `Claim ${fmtGen(owed, 6)} GEN` : "Nothing to claim"}</Button></NeedWallet>
      </div>
      {todo.length > 0 && <div className="card" style={{ marginBottom: 18 }}><h3>Needs attention</h3>{todo.map((r) => <p key={r.id} style={{ margin: "4px 0" }}><Link to={`/round/${r.id}`}>#{r.id} {r.title}</Link> — {r.state === STATE.PLAYING ? `${r.next_match}/${r.match_count} matches played` : "enough entries: you can start the round"}</p>)}</div>}
      <h2 style={{ fontSize: "1.4rem" }}>Your rounds</h2>
      {rounds.loading && !rounds.data && <div style={{ display: "grid", placeItems: "center", padding: 40 }}><MochiSpinner label="Looking for your rounds…" /></div>}
      {rounds.data && rows.length === 0 && <Empty title="Nothing here yet">You have not hosted or entered a round. <Link to="/rounds">Browse rounds</Link> or <Link to="/create">open one</Link>.</Empty>}
      {rows.length > 0 && (
        <div className="card table-wrap"><table>
          <thead><tr><th>#</th><th>Title</th><th>Role</th><th>Status</th><th>Prize</th><th>When</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td className="mono">{r.id}</td>
              <td><Link to={`/round/${r.id}`}>{r.title}</Link></td>
              <td>{sameAddr(r.host, w.account) ? <Badge tone="orange">host</Badge> : <Badge tone="blue">entrant</Badge>}</td>
              <td><StateBadge state={r.state} /></td>
              <td><Gen wei={r.prize} digits={4} /></td>
              <td>{r.state === STATE.OPEN ? <Countdown to={r.entry_deadline} prefix="closes in" done="entries closed" /> : r.state === STATE.PLAYING ? <Countdown to={r.play_deadline} prefix="ends in" done="time over" /> : "—"}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  );
}
