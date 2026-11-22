import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/chain.js";
import { useAsync, useTitle } from "../lib/hooks.js";
import { Button, Empty, ErrorBox } from "../components/UI.jsx";
import { BracketLoader } from "../components/Spinners.jsx";
import RoundCard from "../components/RoundCard.jsx";
import { STATE_NAME } from "../config.js";

const PAGE = 12;

export default function Rounds() {
  useTitle("Rounds");
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const { data, error, loading, reload } = useAsync(() => api.rounds(page * PAGE, PAGE), [page], { every: 30000 });
  const stats = useAsync(() => api.stats(), []);
  const total = stats.data?.rounds ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const rows = (data || []).filter((r) => (filter === "all" || r.state === Number(filter)) && (!q || `${r.id} ${r.title} ${r.mission}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <>
      <div className="page-head row between">
        <div>
          <h1>Rounds</h1>
          <p>Every round on the contract, newest first. {total ? `${total} in total.` : ""}</p>
        </div>
        <Button as={Link} to="/create">Create a round</Button>
      </div>
      <div className="row between" style={{ marginBottom: 18 }}>
        <div className="chips">
          {[["all", "All"], ...STATE_NAME.map((n, i) => [String(i), n])].map(([v, l]) => (
            <button key={v} className={`chip ${filter === v ? "on" : ""}`} onClick={() => setFilter(v)}>{l}</button>
          ))}
        </div>
        <div style={{ width: 260 }}><input placeholder="Search title or mission…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" /></div>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data && <div style={{ display: "grid", placeItems: "center", padding: 60 }}><BracketLoader label="Reading rounds from Studionet…" /></div>}
      <div className="grid g3">{rows.map((r) => <RoundCard key={r.id} r={r} />)}</div>
      {data && rows.length === 0 && <Empty title="No rounds here">{data.length ? "Nothing on this page matches the filter." : "No round has been opened yet. Open the first one."}</Empty>}
      {pages > 1 && (
        <div className="row" style={{ justifyContent: "center", marginTop: 28 }}>
          <Button tone="ghost" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>← Newer</Button>
          <span className="muted">Page {page + 1} of {pages}</span>
          <Button tone="ghost" size="sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Older →</Button>
        </div>
      )}
    </>
  );
}
