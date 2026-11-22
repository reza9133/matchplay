import { Link } from "react-router-dom";
import { Gen, StateBadge, Tilt, Countdown } from "./UI.jsx";
import { STATE } from "../config.js";

export default function RoundCard({ r }) {
  return (
    <Tilt as="div" className="card round-card-wrap" max={5}>
      <Link to={`/round/${r.id}`} className="round-card">
        <div className="row between">
          <span className="mono muted">#{r.id}</span>
          <StateBadge state={r.state} />
        </div>
        <h3>{r.title}</h3>
        <p>{r.mission}</p>
        <div className="kv">
          <div><span>Prize</span><b><Gen wei={r.prize} digits={4} /></b></div>
          <div><span>Entries</span><b>{r.entry_count}/{r.max_entries}</b></div>
          <div><span>{r.state === STATE.OPEN ? "Entries close" : r.state === STATE.PLAYING ? "Matches" : "Bond"}</span>
            <b>{r.state === STATE.OPEN ? <Countdown to={r.entry_deadline} done="closed" /> : r.state === STATE.PLAYING ? `${r.next_match}/${r.match_count}` : <Gen wei={r.entry_bond} digits={4} />}</b></div>
        </div>
      </Link>
    </Tilt>
  );
}
