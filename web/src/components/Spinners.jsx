// A small family of loaders. All of them are CSS only (see styles/spinners in global.css).
const TOKEN = "./brand/gen-token.svg";

/** inline ring */
export function Spinner({ size = 20 }) {
  return <span className="ring-spinner" style={{ width: size, height: size }} role="status" aria-label="Loading" />;
}

/** 3D: the GEN token turning inside three tilted orbit rings */
export function OrbitSpinner({ size = 120, label }) {
  return (
    <div className="orbit-wrap" role="status" aria-label={label || "Loading"}>
      <div className="orbit" style={{ "--s": `${size}px` }}>
        <i className="o o1" />
        <i className="o o2" />
        <i className="o o3" />
        <img src={TOKEN} alt="" className="orbit-coin" />
        <b className="o-dot d1" />
        <b className="o-dot d2" />
      </div>
      {label && <p className="loader-label">{label}</p>}
    </div>
  );
}

/** the judge reads every match twice with the entries swapped: two cards trade places */
export function JudgeSpinner({ mini = false, label }) {
  return (
    <div className={`judge ${mini ? "judge-mini" : ""}`} role="status" aria-label={label || "The judge is reading"}>
      <div className="judge-stage">
        <span className="jc jc-a">A</span>
        <span className="jc jc-b">B</span>
        {!mini && <span className="judge-scale">⚖</span>}
      </div>
      {!mini && <p className="loader-label">{label || "Reading 1, then reading 2 with the entries swapped…"}</p>}
    </div>
  );
}

/** the mascot with a spinning ring and bouncing dots */
export function MochiSpinner({ size = 96, label }) {
  return (
    <div className="mochi-spin" role="status" aria-label={label || "Loading"}>
      <div className="mochi-ring" style={{ width: size, height: size }}>
        <img src="./img/mochi-face.webp" alt="" style={{ width: size - 14, height: size - 14 }} />
      </div>
      <div className="dots">
        <i />
        <i />
        <i />
      </div>
      {label && <p className="loader-label">{label}</p>}
    </div>
  );
}

/** a tournament bracket that draws itself */
export function BracketLoader({ label }) {
  return (
    <div className="bracket-loader" role="status" aria-label={label || "Loading"}>
      <svg viewBox="0 0 120 72" width="120" height="72" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path className="bl bl1" d="M6 10h22v16H6M6 46h22v16H6" />
        <path className="bl bl2" d="M28 18h14v36H28" />
        <path className="bl bl3" d="M42 36h24" />
        <path className="bl bl4" d="M114 10H92v16h22M114 46H92v16h22" />
        <path className="bl bl5" d="M92 18H78v36h14" />
        <path className="bl bl6" d="M78 36H54" />
        <circle className="bl-ball" cx="60" cy="36" r="5" />
      </svg>
      {label && <p className="loader-label">{label}</p>}
    </div>
  );
}

export function PageLoader({ label = "Loading…" }) {
  return (
    <div className="page-loader">
      <OrbitSpinner size={132} label={label} />
    </div>
  );
}
