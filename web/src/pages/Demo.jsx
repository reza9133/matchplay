import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { DEMO_VIDEO_URL } from "../config.js";
import { useTitle } from "../lib/hooks.js";
import { setDemo } from "../lib/demo/flag.js";
import { guardSeeking, seekTo, whenReady } from "../lib/seek.js";
import { Button, SectionTitle, Tilt } from "../components/UI.jsx";
import { OrbitSpinner } from "../components/Spinners.jsx";

// Chapter start times in seconds (the recording is 5:14).
const CHAPTERS = [["Welcome", 0], ["Connect a wallet", 21], ["Switch to Studionet", 35], ["Browse the arena", 53], ["Enter a round", 69], ["Run the judge", 125], ["Results and claim", 171], ["Host a round", 213], ["The ledger", 257], ["Documentation", 271], ["Disconnect and wrap up", 290]];
const mm = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const POSTER = "./demo/poster.jpg";

function youtubeId(u) {
  const m = /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/.exec(u);
  return m?.[1];
}

export default function Demo() {
  useTitle("Demo");
  const yt = youtubeId(DEMO_VIDEO_URL);
  const video = useRef(null);
  const box = useRef(null);
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);
  const [dur, setDur] = useState(0);
  const [now, setNow] = useState(0);
  const [ytStart, setYtStart] = useState(0);

  // metadata early (the duration label), and recovery when the host cannot serve byte ranges
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    guardSeeking(v, box.current);
    whenReady(v).then(() => setDur(v.duration));
  }, []);

  const play = () => {
    setStarted(true);
    video.current?.play().catch(() => {});
  };
  const jump = (t) => {
    setStarted(true);
    if (yt) setYtStart(t);
    else seekTo(video.current, t, { card: box.current });
  };
  const tryDemo = () => {
    setDemo(true);
    window.location.hash = "#/rounds";
    window.location.reload();
  };
  const active = started ? CHAPTERS.reduce((k, [, s], i) => (now >= s - 0.5 ? i : k), 0) : -1;

  return (
    <>
      <div className="page-head" style={{ textAlign: "center" }}>
        <span className="eyebrow">Demo</span>
        <h1>See a round from start to payout</h1>
        <p style={{ margin: "0 auto" }}>Press play for a walkthrough, or jump straight to the part you care about: connect, create, enter, judge, claim.</p>
      </div>

      <div className="demo-grid">
        <div>
          <div className="video-box" ref={box}>
            {yt ? (
              started && <iframe key={ytStart} src={`https://www.youtube-nocookie.com/embed/${yt}?autoplay=1&rel=0&start=${ytStart}`} title="Matchplay demo" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
            ) : (
              <video
                ref={video}
                src={DEMO_VIDEO_URL}
                poster={POSTER}
                preload="metadata"
                playsInline
                controls={started}
                onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}
                onSeeked={(e) => setNow(e.currentTarget.currentTime)}
                onEnded={(e) => { e.currentTarget.currentTime = 0; setStarted(false); }}
                onError={() => setFailed(true)}
              />
            )}
            {!started && (
              <button className="video-poster" style={{ backgroundImage: `url(${POSTER})`, backgroundSize: "cover", backgroundPosition: "center" }} onClick={play} aria-label="Play the demo video">
                <span className="play" />
              </button>
            )}
            {failed && (
              <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "rgba(10,10,31,.86)", color: "#fff", padding: 24, textAlign: "center" }}>
                <div>
                  <OrbitSpinner size={90} />
                  <p style={{ marginTop: 16 }}>The demo video file was not found.<br />It should be at <code>public/demo/matchplay-demo.mp4</code>, or set <code>VITE_DEMO_VIDEO_URL</code>.</p>
                </div>
              </div>
            )}
          </div>
          <p className="muted" style={{ fontSize: ".85rem", marginTop: 14 }}>
            <b>About this recording.</b> It was captured in demo mode: a pretend wallet and a simulated network, so no real GEN or transactions are involved. The screens and steps are the real ones; results on Studionet depend on the live judge.{dur > 0 && ` Length ${mm(dur)}.`}
          </p>
        </div>

        <aside className="card" style={{ padding: 22 }}>
          <h3 style={{ marginTop: 0 }}>Chapters</h3>
          <ol className="chapters">
            {CHAPTERS.map(([title, s], i) => (
              <li key={s} className={i === active ? "on" : ""}>
                <button onClick={() => jump(s)}>
                  <time>{mm(s)}</time>
                  {title}
                </button>
              </li>
            ))}
          </ol>
          <div style={{ marginTop: 18 }}>
            <Button onClick={tryDemo}>Try demo mode yourself</Button>
          </div>
        </aside>
      </div>

      <section className="section">
        <SectionTitle title="The walkthrough, step by step" />
        <div className="grid g3">
          {[["1 · Connect", "Pick a wallet from the list (EIP-6963). If it is on another network, switch to GenLayer Studionet with one click."], ["2 · Create", "Write the mission, attach the prize, choose the bar and the time windows. Inputs are checked against the contract before any GEN is sent."], ["3 · Enter", "Entrants pay the bond and submit a pitch with an evidence link. The tripwire is previewed live with would_steer()."], ["4 · Judge", "Anyone presses “Run next match”. The judge reads each match twice with the entries swapped."], ["5 · Finalize", "When every match is played or time is up, anyone finalizes. Money is credited by the books."], ["6 · Claim", "Entrants and the host claim their credit. The ledger page shows that the books balance."]].map(([t, d]) => (
            <Tilt key={t} className="card feature">
              <h3>{t}</h3>
              <p>{d}</p>
            </Tilt>
          ))}
        </div>
        <p style={{ textAlign: "center", marginTop: 28 }}>
          <Button as={Link} to="/rounds" size="lg">Try it on Studionet</Button>
        </p>
      </section>
    </>
  );
}
