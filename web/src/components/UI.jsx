import { useRef, useState } from "react";
import { EXPLORER_URL, STATE_NAME } from "../config.js";
import { fmtDuration, fmtGen, shortAddr } from "../lib/format.js";
import { useNow } from "../lib/hooks.js";
import { Spinner } from "./Spinners.jsx";

export function Badge({ tone = "gray", children, dot }) {
  return (
    <span className={`badge badge-${tone}`}>
      {dot && <i className="badge-dot" />}
      {children}
    </span>
  );
}

const STATE_TONE = ["green", "blue", "violet", "gray"];
export const StateBadge = ({ state }) => <Badge tone={STATE_TONE[state] || "gray"} dot={state === 0 || state === 1}>{STATE_NAME[state] ?? "?"}</Badge>;

export function Stat({ label, value, sub, accent }) {
  return (
    <div className={`stat ${accent ? "stat-accent" : ""}`}>
      <span className="stat-label">{label}</span>
      <b className="stat-value">{value}</b>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

export function Gen({ wei, digits = 6, strong }) {
  const t = `${fmtGen(wei, digits)} GEN`;
  return strong ? <b className="gen">{t}</b> : <span className="gen">{t}</span>;
}

export function Address({ addr, you, link = true }) {
  const [ok, setOk] = useState(false);
  if (!addr) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(addr);
      setOk(true);
      setTimeout(() => setOk(false), 1200);
    } catch {
      /* ignore */
    }
  };
  return (
    <span className="addr">
      {link ? (
        <a href={`${EXPLORER_URL}/address/${addr}`} target="_blank" rel="noreferrer" title={addr}>
          {shortAddr(addr)}
        </a>
      ) : (
        <span title={addr}>{shortAddr(addr)}</span>
      )}
      <button className="icon-btn" onClick={copy} aria-label="Copy address" title="Copy">
        {ok ? "✓" : "⧉"}
      </button>
      {you && <Badge tone="blue">you</Badge>}
    </span>
  );
}

export function Countdown({ to, done = "ended", prefix }) {
  const now = useNow();
  if (!to) return <span>—</span>;
  const left = to - now;
  return <span className="mono">{left > 0 ? `${prefix ? prefix + " " : ""}${fmtDuration(left)}` : done}</span>;
}

export function Button({ children, tone = "primary", busy, disabled, onClick, type = "button", size, title, as: As = "button", ...rest }) {
  return (
    <As className={`btn btn-${tone} ${size ? "btn-" + size : ""}`} disabled={disabled || busy} onClick={onClick} type={As === "button" ? type : undefined} title={title} {...rest}>
      {busy && <Spinner size={16} />}
      {children}
    </As>
  );
}

export function Field({ label, hint, error, right, children }) {
  return (
    <label className={`field ${error ? "field-error" : ""}`}>
      <span className="field-top">
        <span className="field-label">{label}</span>
        {right && <span className="field-right">{right}</span>}
      </span>
      {children}
      {error ? <span className="field-msg err">{error}</span> : hint ? <span className="field-msg">{hint}</span> : null}
    </label>
  );
}

export function Notice({ tone = "info", title, children, action }) {
  return (
    <div className={`notice notice-${tone}`}>
      <div>
        {title && <b>{title}</b>}
        <div>{children}</div>
      </div>
      {action}
    </div>
  );
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return (
    <Notice tone="error" title={error.rateLimited ? "The Studionet node is rate limiting reads" : "Could not read from the contract"} action={onRetry && <Button tone="ghost" size="sm" onClick={onRetry}>Retry</Button>}>
      {error.rateLimited ? "Studionet allows about 500 requests per hour. The app waits and retries by itself." : String(error.shortMessage || error.message || error).slice(0, 260)}
    </Notice>
  );
}

export function Empty({ title, children, art = "./img/mochi-face.webp" }) {
  return (
    <div className="empty">
      <img src={art} alt="" />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

/** 3D tilt on pointer move (pure CSS transform; respects reduced motion) */
export function Tilt({ children, max = 9, className = "", as: As = "div", ...rest }) {
  const ref = useRef(null);
  const move = (e) => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty("--rx", `${(-y * max).toFixed(2)}deg`);
    el.style.setProperty("--ry", `${(x * max).toFixed(2)}deg`);
    el.style.setProperty("--gx", `${(x + 0.5) * 100}%`);
    el.style.setProperty("--gy", `${(y + 0.5) * 100}%`);
  };
  const leave = () => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--ry", "0deg");
  };
  return (
    <As ref={ref} className={`tilt ${className}`} onPointerMove={move} onPointerLeave={leave} {...rest}>
      {children}
    </As>
  );
}

export function CopyButton({ text, label = "Copy" }) {
  const [ok, setOk] = useState(false);
  return (
    <Button
      tone="ghost"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setOk(true);
          setTimeout(() => setOk(false), 1200);
        } catch {
          /* ignore */
        }
      }}
    >
      {ok ? "Copied ✓" : label}
    </Button>
  );
}

export function SectionTitle({ eyebrow, title, children }) {
  return (
    <header className="section-title">
      {eyebrow && <span className="eyebrow">{eyebrow}</span>}
      <h2>{title}</h2>
      {children && <p>{children}</p>}
    </header>
  );
}
