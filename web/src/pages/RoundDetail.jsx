import { lazy, Suspense, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/chain.js";
import { useAsync, useDebounced, useNow, useTitle } from "../lib/hooks.js";
import { useWallet } from "../lib/wallet.jsx";
import { useTx } from "../lib/tx.jsx";
import { checkEnter, clean, pkey } from "../lib/validate.js";
import { fmtDate, fmtDuration, fmtGen, nowSec, pairsOf, parseGen, sameAddr, shortAddr, toBig } from "../lib/format.js";
import { Address, Badge, Button, Countdown, Empty, ErrorBox, Field, Gen, Notice, StateBadge } from "../components/UI.jsx";
import { NeedWallet } from "../components/WalletUI.jsx";
import { BracketLoader, JudgeSpinner } from "../components/Spinners.jsx";
import { BY, EXPLORER_URL, LIMITS as L, OUTCOME, STATE } from "../config.js";

const Arena3D = lazy(() => import("../components/Arena3D.jsx"));

const OUT_TEXT = ["A wins", "B wins", "Tie", "Nobody earns"];
const BY_TEXT = ["", "Judge", "Void", "Timeout"];
const sideName = (r, s, a, b) => (s === "A" ? r.entries[a]?.name : s === "B" ? r.entries[b]?.name : "tie");

function localPairs(n) {
  const out = [];
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) out.push([a, b]);
  return out;
}

// ---- action helpers: the contract's own checks, run before a transaction is sent ----------------------------------------
const why = {
  start: (r, me, now) => {
    if (r.state !== STATE.OPEN) return "The round is not open.";
    if (r.entries.length < r.min_entries) return "The round does not have enough entries yet.";
    if (!(now >= r.entry_deadline || r.entries.length >= r.max_entries || sameAddr(me, r.host))) return "The entry time is not over and the round is not full.";
  },
  cancel: (r, me, now) => {
    if (r.state !== STATE.OPEN) return "Only an open round can be cancelled.";
    if (!(sameAddr(me, r.host) || (now >= r.entry_deadline && r.entries.length < r.min_entries))) return "Only the host can cancel, unless the entry time is over without enough entries.";
  },
  play: (r, now) => {
    if (r.state !== STATE.PLAYING) return "The round is not being played.";
    if (now >= r.play_deadline) return "The playing time is over. Call finalize_round.";
    if (r.next_match >= r.matches.length) return "Every match has been played. Call finalize_round.";
    const m = r.matches[r.next_match];
    if (m.tries > 0 && now < m.last_try + L.RETRY_GAP) return `Wait ${fmtDuration(m.last_try + L.RETRY_GAP - now)} before asking again.`;
  },
  finalize: (r, now) => {
    if (r.state !== STATE.PLAYING) return "The round is not being played.";
    if (r.next_match < r.matches.length && now < r.play_deadline) return "Matches are still being played.";
  },
};

function EnterForm({ round, me, onDone }) {
  const tx = useTx();
  const [f, setF] = useState({ name: "", pitch: "", url: "" });
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState([]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const now = nowSec();
  const local = useMemo(() => checkEnter({ round, me, ...f, now: now + 8 }), [round, me, f, now]);
  const dn = useDebounced(clean(f.name), 700), dp = useDebounced(clean(f.pitch), 700);
  const steerN = useAsync(() => (dn.length >= 2 ? api.wouldSteer(dn) : false), [dn]);
  const steerP = useAsync(() => (dp.length >= 20 ? api.wouldSteer(dp) : false), [dp]);
  const steer = steerN.data === true || steerP.data === true;
  const letters = pkey(f.pitch).length;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setProblems([]);
    try {
      const fresh = await api.round(round.id, { force: true, ttl: 0 });
      const list = checkEnter({ round: fresh, me, ...f, now: nowSec() + 8 });
      const [sn, sp] = await Promise.all([api.wouldSteer(clean(f.name)), api.wouldSteer(clean(f.pitch))]);
      if (sn === true || sp === true) list.push("The contract's tripwire would turn this name or pitch away.");
      if (list.length) return setProblems(list);
      const r = await tx.send({ fn: "enter", label: `Enter “${clean(f.name)}”`, value: toBig(fresh.entry_bond), args: [round.id, clean(f.name), clean(f.pitch), f.url.trim()] });
      if (r.ok) onDone?.();
    } catch (err) {
      setProblems([`Could not check the round: ${err.message}`]);
    } finally {
      setBusy(false);
    }
  }
  const shown = problems.length ? problems : [];
  return (
    <form onSubmit={submit}>
      <Field label="Entry name" right={`${clean(f.name).length}/${L.MAX_NAME}`}><input value={f.name} onChange={set("name")} maxLength={60} placeholder="Your project" /></Field>
      <Field label="Pitch" right={`${clean(f.pitch).length}/${L.MAX_PITCH} · ${letters} letters`} hint="40 to 600 characters, at least 20 letters or digits. Never address the judge.">
        <textarea value={f.pitch} onChange={set("pitch")} rows={5} />
      </Field>
      <Field label={`Evidence link ${round.need_evidence ? "(required)" : "(optional)"}`} hint="A public http(s) page you control. The judge reads the first 1500 characters of its visible text.">
        <input value={f.url} onChange={set("url")} placeholder="https://…" inputMode="url" />
      </Field>
      {steer && <Notice tone="error" title="Tripwire">The contract would turn this name or pitch away because it tries to steer the judge.</Notice>}
      {(shown.length > 0 || (local.length > 0 && (f.name || f.pitch))) && (
        <ul className="issues">{(shown.length ? shown : local).map((i) => <li key={i}>{i}</li>)}</ul>
      )}
      <NeedWallet label="Connect wallet to enter">
        <Button type="submit" busy={busy} disabled={tx.busy}>Enter with a bond of {fmtGen(round.entry_bond, 6)} GEN</Button>
      </NeedWallet>
    </form>
  );
}

function FitBars({ r, m }) {
  const rv = m.review;
  return (
    <div className="fit-bars">
      {[m.a, m.b].map((idx, i) => (
        <div className="fit-bar" key={idx}>
          <span>{r.entries[idx]?.name}</span>
          <div className="progress"><i style={{ width: `${rv.fit[i]}%` }} /></div>
          <b className="mono">{rv.fit[i]}</b>
        </div>
      ))}
    </div>
  );
}

function MatchRow({ r, m, isNext }) {
  const [open, setOpen] = useState(false);
  const A = r.entries[m.a], B = r.entries[m.b];
  const played = m.state === 1;
  const win = played && m.by === BY.JUDGE ? (m.outcome === OUTCOME.A ? "a" : m.outcome === OUTCOME.B ? "b" : "") : "";
  const rv = m.review;
  return (
    <div className={`card match ${isNext ? "match-next" : ""}`}>
      <div className="match-head" onClick={() => played && setOpen((o) => !o)}>
        <span className="match-idx">#{m.index + 1}</span>
        <div className="vs">
          <span className={`side ${win === "a" ? "win" : win === "b" ? "lose" : ""}`}>{A?.name}</span><em>vs</em>
          <span className={`side ${win === "b" ? "win" : win === "a" ? "lose" : ""}`}>{B?.name}</span>
        </div>
        {played ? <><Badge tone={m.outcome === OUTCOME.TIE ? "violet" : m.outcome === OUTCOME.NEITHER ? "gray" : "green"}>{OUT_TEXT[m.outcome]}</Badge><Badge tone={m.by === BY.JUDGE ? "blue" : "orange"}>{BY_TEXT[m.by]}</Badge>{rv?.rescored && <Badge tone="red">rescored</Badge>}</>
          : isNext ? <Badge tone="orange" dot>next{m.tries ? ` · try ${m.tries + 1}` : ""}</Badge> : <Badge>pending</Badge>}
        {played && <span className="muted">{open ? "▴" : "▾"}</span>}
      </div>
      {open && rv && (
        <div className="review">
          {m.by === BY.JUDGE && rv.fit && (
            <>
              <FitBars r={r} m={m} />
              <div className="muted">Reading 1 (A first): <b>{sideName(r, rv.win[0], m.a, m.b)}</b> · Reading 2 (B first): <b>{sideName(r, rv.win[1], m.a, m.b)}</b>. An entry only wins when it wins both.</div>
              {rv.reason && <blockquote>{rv.reason}</blockquote>}
              {rv.reason2 && <blockquote>{rv.reason2}</blockquote>}
              {(rv.flagged?.[0] || rv.flagged?.[1]) && <Notice tone="error" title="Steering page found">{[0, 1].filter((i) => rv.flagged[i]).map((i) => r.entries[i === 0 ? m.a : m.b]?.name).join(" and ")} — evidence page tried to talk to the judge.</Notice>}
              {rv.rescored && <Notice tone="warn" title="Decided again after a late strike">Was: {OUT_TEXT[rv.rescored.was]} · now: {OUT_TEXT[rv.outcome]} ({fmtDate(rv.rescored.at)}).</Notice>}
              {rv.hash && <div className="muted mono" style={{ fontSize: ".75rem" }}>page fingerprints: {rv.hash.map((h) => (h ? h.slice(0, 10) + "…" : "—")).join(" · ")}</div>}
            </>
          )}
          {m.by === BY.VOID && <p className="muted">An evidence page stayed unreadable after three tries, so the match was voided. Nobody earns from it and neither entry is punished.</p>}
          {m.by === BY.TIMEOUT && <p className="muted">The playing time ended before this match was run. Nobody earns from it.</p>}
          <span className="muted" style={{ fontSize: ".8rem" }}>Settled {fmtDate(m.played_at)}</span>
        </div>
      )}
    </div>
  );
}

export default function RoundDetail() {
  const { id } = useParams();
  const rid = Number(id);
  const w = useWallet();
  const tx = useTx();
  const now = useNow();
  const [tab, setTab] = useState("entries");
  const [showEnter, setShowEnter] = useState(false);
  const [topUp, setTopUp] = useState("0.005");
  const [rm, setRm] = useState(null); // { who, reason }
  const [note, setNote] = useState(null);
  const valid = Number.isInteger(rid) && rid >= 0;
  const { data: r, error, loading, reload } = useAsync(() => api.round(rid), [rid], { every: 20000, enabled: valid });
  const credit = useAsync(() => api.credit(w.account), [w.account], { enabled: !!w.account, every: 60000 });
  useTitle(r ? r.title : `Round ${id}`);

  if (!valid) return <Empty title="No such round">The round number is not valid.</Empty>;
  if (!r && loading) return <div style={{ display: "grid", placeItems: "center", padding: 80 }}><BracketLoader label="Reading the round…" /></div>;
  if (!r) return error && /No such round/i.test(String(error.message)) ? <Empty title="No such round">There is no round #{rid}.</Empty> : <ErrorBox error={error} onRetry={reload} />;

  const me = w.account;
  const isHost = sameAddr(me, r.host);
  const myEntry = r.entries.find((e) => sameAddr(e.who, me));
  const open = r.state === STATE.OPEN, playing = r.state === STATE.PLAYING;
  const n = r.entries.length;
  const total = r.match_count;
  const next = playing ? r.matches[r.next_match] : null;
  const sorted = playing || r.state === STATE.DONE ? [...r.entries].sort((a, b) => (a.rank || 99) - (b.rank || 99) || a.index - b.index) : r.entries;
  const mycredit = toBig(credit.data);

  const fresh = () => api.round(rid, { force: true, ttl: 0 });
  const act = async (check, spec) => {
    setNote(null);
    try {
      const f = await fresh();
      const problem = check(f);
      if (problem) return setNote(problem);
      await tx.send(spec);
    } catch (e) {
      setNote(`Could not check the round: ${e.message}`);
    }
  };

  const arenaNodes = r.entries.map((e) => ({ label: e.name, sub: playing || r.state === STATE.DONE ? (e.flagged ? "flagged" : `${e.points} pts`) : "", flagged: e.flagged, rank: e.rank }));
  const arenaEdges = r.matches.length
    ? r.matches.map((m) => ({ a: m.a, b: m.b, state: m.state === 0 ? "pending" : m.outcome === 0 ? "a" : m.outcome === 1 ? "b" : m.outcome === 2 ? "tie" : "none" }))
    : localPairs(n).map(([a, b]) => ({ a, b, state: "pending" }));

  const unit = toBig(r.price_per_point);
  const barFit = L.LEVEL_FIT.find((x) => x >= r.min_fit) ?? 100;

  return (
    <>
      <p style={{ marginBottom: 6 }}><Link to="/rounds">← All rounds</Link></p>
      <div className="page-head row between" style={{ alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="row"><span className="mono muted">Round #{r.id}</span><StateBadge state={r.state} />{r.need_evidence && <Badge tone="blue">evidence required</Badge>}{isHost && <Badge tone="orange">you host this</Badge>}</div>
          <h1>{r.title}</h1>
          <p>{r.mission}</p>
          <p className="row" style={{ fontSize: ".9rem" }}><span className="muted">Host</span> <Address addr={r.host} you={isHost} /></p>
        </div>
      </div>

      <ErrorBox error={error} onRetry={reload} />
      {mycredit > 0n && (
        <Notice tone="ok" title={`You have ${fmtGen(mycredit, 8)} GEN ready to claim`} action={<NeedWallet><Button onClick={() => tx.send({ fn: "claim", label: "Claim", args: [] })} disabled={tx.busy}>Claim</Button></NeedWallet>}>Credits are plain bookkeeping until claim() sends them to your wallet.</Notice>
      )}

      <div className="kv" style={{ marginBottom: 22 }}>
        <div><span>Prize</span><b><Gen wei={r.prize} digits={5} /></b></div>
        <div><span>Entry bond</span><b><Gen wei={r.entry_bond} digits={5} /></b></div>
        <div><span>Entries</span><b>{n}/{r.max_entries} (min {r.min_entries})</b></div>
        <div><span>The bar</span><b>{r.min_fit} → needs {barFit}</b></div>
        <div><span>Matches</span><b>{playing || total ? `${r.next_match}/${total} played` : `${pairsOf(Math.max(n, r.min_entries))} planned`}</b></div>
        <div><span>1 point {r.price_final ? "" : "(est.)"}</span><b><Gen wei={r.price_per_point} digits={7} /></b></div>
        <div><span>{open ? "Entries close" : "Entries closed"}</span><b>{open ? <Countdown to={r.entry_deadline} done="closed" /> : fmtDate(r.entry_deadline)}</b></div>
        {(playing || r.state === STATE.DONE) && <div><span>{playing ? "Playing ends" : "Finished"}</span><b>{playing ? <Countdown to={r.play_deadline} done="over" /> : fmtDate(r.finished_at)}</b></div>}
      </div>
      {playing && (
        <div className="progress" style={{ marginBottom: 24 }} title={`${r.next_match} of ${total}`}><i style={{ width: `${total ? (r.next_match / total) * 100 : 0}%` }} /></div>
      )}

      <div className="layout-2">
        <div>
          <div className="tabs" role="tablist">
            {[["entries", `Entries (${n})`], ["matches", `Matches (${total || pairsOf(n)})`], ["arena", "3D arena"], ["money", "Money"]].map(([k, l]) => (
              <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}>{l}</button>
            ))}
          </div>

          {tab === "entries" && (
            <>
              {n === 0 && <Empty title="No entries yet">{open ? "Be the first to enter this round." : "This round had no entries."}</Empty>}
              {sorted.map((e) => (
                <div key={e.index} className={`card entry ${e.flagged ? "entry-flagged" : ""}`}>
                  <div className={`entry-rank ${e.rank === 1 ? "gold" : ""}`}>{e.rank ? e.rank : e.flagged ? "!" : e.index + 1}</div>
                  <div className="entry-body">
                    <div className="row between"><h4>{e.name}</h4><div className="row">{e.flagged && <Badge tone="red">flagged · bond forfeited</Badge>}{sameAddr(e.who, me) && <Badge tone="blue">you</Badge>}</div></div>
                    <Address addr={e.who} />
                    <p>{e.pitch}</p>
                    <div className="entry-meta">
                      {e.url ? <a href={e.url} target="_blank" rel="noreferrer">Evidence ↗</a> : <span className="muted">no evidence link</span>}
                      {(playing || r.state === STATE.DONE) && <Badge tone="blue">{e.points} pts · {e.wins} wins</Badge>}
                      {r.state === STATE.DONE && <Badge tone={toBig(e.payout) > 0n ? "green" : "gray"}>paid {fmtGen(e.payout, 6)} GEN</Badge>}
                      {open && <span className="muted">bond {fmtGen(e.bond, 6)} GEN</span>}
                    </div>
                    {open && isHost && (
                      rm?.who === e.who ? (
                        <div className="row" style={{ marginTop: 10 }}>
                          <input style={{ flex: 1, minWidth: 180 }} placeholder="Reason (3 to 160 characters)" value={rm.reason} onChange={(ev) => setRm({ ...rm, reason: ev.target.value })} />
                          <Button tone="danger" size="sm" disabled={tx.busy} onClick={() => { const reason = clean(rm.reason); if (reason.length < 3 || reason.length > 160) return setNote("Give a reason of 3 to 160 characters."); act((f) => (f.state !== 0 ? "Entries can only be removed while the round is open." : !f.entries.some((x) => sameAddr(x.who, e.who)) ? "That address has no entry in this round." : null), { fn: "remove_entry", label: `Remove ${e.name}`, args: [rid, e.who, reason] }).then(() => setRm(null)); }}>Remove</Button>
                          <Button tone="ghost" size="sm" onClick={() => setRm(null)}>Cancel</Button>
                        </div>
                      ) : <div style={{ marginTop: 8 }}><Button tone="ghost" size="sm" onClick={() => setRm({ who: e.who, reason: "" })}>Remove entry…</Button></div>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}

          {tab === "matches" && (
            <>
              {r.matches.length === 0 ? (
                n < 2 ? <Empty title="No schedule yet">Matches are created when the round starts. Every pair of entries meets once.</Empty> : (
                  <>
                    <Notice tone="info" title="Schedule preview">The round has not started. With {n} entries these {pairsOf(n)} matches would be played in this order.</Notice>
                    {localPairs(n).map(([a, b], i) => <div className="card match" key={i}><div className="match-head"><span className="match-idx">#{i + 1}</span><div className="vs"><span className="side">{r.entries[a].name}</span><em>vs</em><span className="side">{r.entries[b].name}</span></div></div></div>)}
                  </>
                )
              ) : r.matches.map((m) => <MatchRow key={m.index} r={r} m={m} isNext={playing && m.index === r.next_match} />)}
            </>
          )}

          {tab === "arena" && (
            <div className="arena-wrap">
              {n < 2 ? <Empty title="Waiting for entries">The arena appears when there are at least two entries.</Empty> : (
                <Suspense fallback={<div style={{ height: 460, display: "grid", placeItems: "center" }}><BracketLoader label="Setting up the arena…" /></div>}>
                  <Arena3D nodes={arenaNodes} edges={arenaEdges} active={playing ? r.next_match : -1} height={460} />
                </Suspense>
              )}
              <span className="arena-hint">Drag to rotate</span>
              <div className="arena-legend"><span><i style={{ background: "#110fff" }} />winner (arrow)</span><span><i style={{ background: "#8b5cf6" }} />tie</span><span><i style={{ background: "#ffb3b3" }} />nobody earns</span><span><i style={{ background: "#c3c7e6" }} />pending</span><span><i style={{ background: "#ff7a1a" }} />next match</span></div>
            </div>
          )}

          {tab === "money" && (
            <div className="card">
              <h3>Where the money goes</h3>
              <div className="table-wrap"><table><tbody>
                <tr><td>Prize (host)</td><td className="mono"><Gen wei={r.prize} /></td></tr>
                <tr><td>Held now: prize pool / bonds</td><td className="mono"><Gen wei={r.pool} /> / <Gen wei={r.bonds} /></td></tr>
                <tr><td>Price of one point {r.price_final ? "(final)" : "(estimate)"}</td><td className="mono"><Gen wei={r.price_per_point} digits={9} /></td></tr>
                {r.state === STATE.DONE && <><tr><td>Paid to entrants</td><td className="mono"><Gen wei={r.paid_out} /></td></tr><tr><td>Returned to the host</td><td className="mono"><Gen wei={r.returned} /></td></tr></>}
              </tbody></table></div>
              {n > 0 && (
                <div className="table-wrap" style={{ marginTop: 16 }}><table>
                  <thead><tr><th>Entry</th><th>Points</th><th>{r.state === STATE.DONE ? "Payout" : "Payout now"}</th></tr></thead>
                  <tbody>{sorted.map((e) => <tr key={e.index}><td>{e.name} {e.flagged && <Badge tone="red">flagged</Badge>}</td><td>{e.points}</td><td className="mono"><Gen wei={r.state === STATE.DONE ? e.payout : e.flagged ? 0n : BigInt(e.points) * unit} /></td></tr>)}</tbody>
                </table></div>
              )}
              <p className="muted" style={{ fontSize: ".86rem", marginTop: 14 }}>payout = points × price of a point. Entrants also get their bond back (a flagged entry loses it). The host gets back what was not earned, rounding dust and forfeited bonds. <Link to="/docs/money">Read more</Link></p>
            </div>
          )}
        </div>

        <aside className="card action-panel">
          <h3>Actions</h3>
          {note && <Notice tone="warn">{note}</Notice>}
          <div className="actions">
            {open && !isHost && !myEntry && n < r.max_entries && now < r.entry_deadline && (
              showEnter ? <EnterForm round={r} me={me} onDone={() => setShowEnter(false)} /> : <NeedWallet label="Connect wallet to enter"><Button onClick={() => setShowEnter(true)}>Enter this round</Button></NeedWallet>
            )}
            {open && !isHost && !myEntry && (n >= r.max_entries || now >= r.entry_deadline) && <p className="muted">{n >= r.max_entries ? "The round is full." : "The entry time is over."}</p>}
            {open && !!myEntry && <NeedWallet><Button tone="danger" disabled={tx.busy} onClick={() => act((f) => (f.state !== 0 ? "An entry can only be withdrawn while the round is open." : !f.entries.some((x) => sameAddr(x.who, me)) ? "You have no entry in this round." : null), { fn: "withdraw_entry", label: "Withdraw entry", args: [rid] })}>Withdraw my entry (bond comes back)</Button></NeedWallet>}

            {open && isHost && (
              <NeedWallet>
                <Field label="Top up the prize" hint="Only while the round is open. The price of a point is fixed at the start."><div className="input-suffix"><input inputMode="decimal" value={topUp} onChange={(e) => setTopUp(e.target.value)} /><em>GEN</em></div></Field>
                <Button tone="ghost" disabled={tx.busy} onClick={() => { const v = parseGen(topUp); if (!v || v <= 0n) return setNote("Send some GEN to add to the prize."); if (toBig(r.prize) + v > L.MAX_AMOUNT) return setNote("That is more than the contract accepts."); act((f) => (f.state !== 0 ? "The prize can only grow while the round is open." : null), { fn: "top_up", label: "Top up prize", value: v, args: [rid] }); }}>Add to the prize</Button>
              </NeedWallet>
            )}

            {open && (isHost || !why.start(r, me, now)) && <NeedWallet><Button disabled={tx.busy || !!why.start(r, me, now)} title={why.start(r, me, now) || ""} onClick={() => act((f) => why.start(f, me, nowSec()), { fn: "start_round", label: "Start round", args: [rid] })}>Start the round</Button></NeedWallet>}
            {open && isHost && why.start(r, me, now) && <p className="muted" style={{ fontSize: ".83rem", margin: 0 }}>{why.start(r, me, now)}</p>}
            {open && (isHost || !why.cancel(r, me, now)) && <NeedWallet><Button tone="danger" disabled={tx.busy || !!why.cancel(r, me, now)} title={why.cancel(r, me, now) || ""} onClick={() => act((f) => why.cancel(f, me, nowSec()), { fn: "cancel_round", label: "Cancel round", args: [rid] })}>Cancel the round</Button></NeedWallet>}

            {playing && (
              <>
                {next && <div className="notice notice-info" style={{ margin: 0 }}><div><b>Next match #{r.next_match + 1}</b>{r.entries[next.a]?.name} vs {r.entries[next.b]?.name}{next.tries > 0 && <div className="muted">Try {next.tries + 1} of 3 (a page could not be read)</div>}</div></div>}
                <NeedWallet>
                  <Button tone="orange" disabled={tx.busy || !!why.play(r, now)} onClick={() => act((f) => why.play(f, nowSec()), { fn: "play_next", label: `Run match #${r.next_match + 1}`, kind: "play", args: [rid] })}>
                    Run next match
                  </Button>
                </NeedWallet>
                {why.play(r, now) && <p className="muted" style={{ fontSize: ".83rem", margin: 0 }}>{why.play(r, now)}</p>}
                {tx.items.some((t) => t.kind === "play" && t.phase === "pending") && <JudgeSpinner />}
                <p className="muted" style={{ fontSize: ".8rem", margin: 0 }}>If the validators do not agree (UNDETERMINED) nothing changes and you can try again right away.</p>
                <NeedWallet><Button tone="ghost" disabled={tx.busy || !!why.finalize(r, now)} onClick={() => act((f) => why.finalize(f, nowSec()), { fn: "finalize_round", label: "Finalize round", args: [rid] })}>Finalize round</Button></NeedWallet>
                {why.finalize(r, now) && <p className="muted" style={{ fontSize: ".83rem", margin: 0 }}>{why.finalize(r, now)}</p>}
              </>
            )}
            {(r.state === STATE.DONE || r.state === STATE.CANCELLED) && <p className="muted" style={{ margin: 0 }}>{r.state === STATE.DONE ? "This round is final. Payouts were credited; anyone owed money can claim from their dashboard." : "This round was cancelled. The prize and the bonds were credited back."} <Link to="/me">Go to My Matchplay</Link></p>}
            <a className="muted" style={{ fontSize: ".8rem" }} href={`${EXPLORER_URL}/address/${r.host}`} target="_blank" rel="noreferrer">Host on the explorer ↗ ({shortAddr(r.host)})</a>
          </div>
        </aside>
      </div>
    </>
  );
}
