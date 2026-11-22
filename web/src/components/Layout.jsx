import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { CONTRACT_ADDRESS, EXPLORER_URL, GENLAYER_URL, GITHUB_URL, X_URL } from "../config.js";
import { onRateLimit, rateLimitedUntil } from "../lib/chain.js";
import { Wordmark } from "./Logo.jsx";
import { ConnectButton, ConnectModal, NetworkBanner } from "./WalletUI.jsx";
import { shortAddr } from "../lib/format.js";
import { isDemo, setDemo, loadMock } from "../lib/demo/flag.js";

const NAV = [
  ["/", "Home", true],
  ["/rounds", "Rounds"],
  ["/create", "Create"],
  ["/me", "My Matchplay"],
  ["/ledger", "Ledger"],
  ["/docs", "Docs"],
  ["/demo", "Demo"],
];

function DemoBar() {
  if (!isDemo()) return null;
  const reset = async () => {
    (await loadMock()).resetDemo();
    location.reload();
  };
  const exit = () => {
    setDemo(false);
    location.reload();
  };
  return (
    <div className="demo-bar">
      <div className="demo-bar-in">
        <span>
          <b>Demo mode</b> · simulated network and wallet, no real GEN, nothing is sent to Studionet.
        </span>
        <span>
          <button className="linklike" onClick={reset}>Reset demo data</button>
          <button className="linklike" onClick={exit}>Exit demo</button>
        </span>
      </div>
    </div>
  );
}

function RateLimitBar() {
  const [until, setUntil] = useState(rateLimitedUntil());
  const [, tick] = useState(0);
  useEffect(() => {
    return onRateLimit(setUntil);
  }, []);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.ceil((until - Date.now()) / 1000);
  if (left <= 0) return null;
  return <div className="banner banner-warn">Studionet is rate limiting this browser (about 500 requests per hour). Reads resume in {left}s.</div>;
}

export default function Layout({ children }) {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => {
    setOpen(false);
  }, [loc.pathname]);
  return (
    <div className="shell">
      <DemoBar />
      <div className="bg-deco" aria-hidden="true">
        <i className="blob b1" />
        <i className="blob b2" />
        <i className="blob b3" />
      </div>
      <header className="topbar">
        <div className="topbar-in">
          <Link to="/" className="brand" aria-label="Matchplay home">
            <Wordmark size={38} />
          </Link>
          <nav className={`nav ${open ? "nav-open" : ""}`}>
            {NAV.map(([to, label, end]) => (
              <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? "active" : "")}>
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="topbar-right">
            <span className="net-pill" title="Network">
              <i /> Studionet
            </span>
            <ConnectButton />
            <button className="burger" onClick={() => setOpen((o) => !o)} aria-label="Menu" aria-expanded={open}>
              <span />
              <span />
              <span />
            </button>
          </div>
        </div>
      </header>
      <NetworkBanner />
      <RateLimitBar />
      <main className="main">{children}</main>
      <footer className="footer">
        <div className="footer-in">
          <div className="footer-col">
            <Wordmark size={34} />
            <p>Head-to-head funding rounds where the judge has to say the same thing in both orders. An Intelligent Contract on GenLayer.</p>
            <a className="built-on" href={GENLAYER_URL} target="_blank" rel="noreferrer">
              <span>Built on</span>
              <img src="./brand/genlayer-logo-black.svg" alt="GenLayer" />
            </a>
          </div>
          <div className="footer-col">
            <h4>App</h4>
            <Link to="/rounds">Rounds</Link>
            <Link to="/create">Create a round</Link>
            <Link to="/me">My Matchplay</Link>
            <Link to="/ledger">Ledger</Link>
          </div>
          <div className="footer-col">
            <h4>Learn</h4>
            <Link to="/docs">Documentation</Link>
            <Link to="/docs/how-a-match-is-decided">How a match is decided</Link>
            <Link to="/docs/money">Where the money goes</Link>
            <Link to="/demo">Demo video</Link>
          </div>
          <div className="footer-col">
            <h4>Project</h4>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub ↗</a>
            <a href={X_URL} target="_blank" rel="noreferrer">@amirhp771 on X ↗</a>
            <a href={`${EXPLORER_URL}/address/${CONTRACT_ADDRESS}`} target="_blank" rel="noreferrer" title={CONTRACT_ADDRESS}>
              Contract {shortAddr(CONTRACT_ADDRESS, 8, 6)} ↗
            </a>
          </div>
        </div>
        <div className="footer-bottom">
          <span>Studionet is a test network: GEN here has no market value.</span>
          <span>© {new Date().getFullYear()} Matchplay</span>
        </div>
      </footer>
      <ConnectModal />
    </div>
  );
}
