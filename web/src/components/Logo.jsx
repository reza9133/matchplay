import { useId } from "react";

/** The Matchplay mark: an "M" drawn as two meeting brackets, with the coin (the prize) on its peak. */
export function LogoMark({ size = 40, className = "" }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="Matchplay">
      <defs>
        <linearGradient id={`g${id}`} x1="6" y1="4" x2="58" y2="60" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4B3BFF" />
          <stop offset="1" stopColor="#110FFF" />
        </linearGradient>
        <radialGradient id={`c${id}`} cx="35%" cy="30%" r="80%">
          <stop stopColor="#FFD79A" />
          <stop offset="0.55" stopColor="#FF9A2E" />
          <stop offset="1" stopColor="#E85D00" />
        </radialGradient>
        <filter id={`s${id}`} x="-20%" y="-20%" width="140%" height="150%">
          <feDropShadow dx="0" dy="1.5" stdDeviation="1.4" floodColor="#07063a" floodOpacity="0.35" />
        </filter>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="18" fill={`url(#g${id})`} />
      <rect x="2" y="2" width="60" height="60" rx="18" fill="none" stroke="#fff" strokeOpacity="0.28" />
      <path d="M15 47V21m34 26V21M15 21l17 17 17-17" fill="none" stroke="#fff" strokeWidth="6.2" strokeLinecap="round" strokeLinejoin="round" filter={`url(#s${id})`} />
      <circle cx="32" cy="20.5" r="7.2" fill={`url(#c${id})`} stroke="#fff" strokeWidth="2.2" />
      <path d="M32 16.4l3.1 5.6h-6.2z" fill="#fff" fillOpacity="0.92" />
    </svg>
  );
}

export function Wordmark({ size = 40 }) {
  return (
    <span className="wordmark">
      <LogoMark size={size} />
      <span className="wordmark-text">
        Match<b>play</b>
      </span>
    </span>
  );
}
