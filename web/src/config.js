// Everything that is deployment-specific lives here (or in a .env file, see .env.example).
export const CONTRACT_ADDRESS =
  import.meta.env?.VITE_CONTRACT_ADDRESS || "0xdd842644E5fEaba5c4FDB28d97236b5B58C5C69c";

export const GITHUB_URL = "https://github.com/reza9133/matchplay";
export const X_URL = "https://x.com/amirhp771";
export const GENLAYER_URL = "https://www.genlayer.com";
export const GENLAYER_DOCS = "https://docs.genlayer.com";

// Studionet (GenLayer Studio network). The numbers come from genlayer-js's own chain definition, see lib/chain.js.
export const CHAIN_ID = 61999;
export const CHAIN_ID_HEX = "0xf22f";
export const CHAIN_NAME = "GenLayer Studio Network";
export const RPC_URL = "https://studio.genlayer.com/api";
export const EXPLORER_URL = "https://genlayer-explorer.vercel.app";

// Demo video: drop an mp4 at public/demo/matchplay-demo.mp4, or point this at a YouTube / hosted link.
export const DEMO_VIDEO_URL = import.meta.env?.VITE_DEMO_VIDEO_URL || "./demo/matchplay-demo.mp4";

// The same limits the contract enforces (contracts/matchplay.py). The front end checks them before any money is attached.
export const LIMITS = {
  MIN_POOL: 2n * 10n ** 15n, // 0.002 GEN
  MIN_BOND: 10n ** 15n, // 0.001 GEN
  MAX_AMOUNT: 10n ** 27n,
  MIN_ENTRIES: 3,
  MAX_ENTRIES: 8,
  MIN_TITLE: 3, MAX_TITLE: 60,
  MIN_MISSION: 30, MAX_MISSION: 1000,
  MIN_NAME: 2, MAX_NAME: 40,
  MIN_PITCH: 40, MAX_PITCH: 600,
  MIN_PITCH_LETTERS: 20,
  MAX_REASON: 160,
  MAX_URL: 300,
  MIN_WINDOW: 60, MAX_WINDOW: 30 * 86400,
  MAX_FIT_BAR: 90,
  RETRY_GAP: 120,
  LEVEL_FIT: [0, 25, 50, 75, 100],
};

export const STATE = { OPEN: 0, PLAYING: 1, DONE: 2, CANCELLED: 3 };
export const STATE_NAME = ["Open", "Playing", "Done", "Cancelled"];
export const OUTCOME = { A: 0, B: 1, TIE: 2, NEITHER: 3 };
export const BY = { NONE: 0, JUDGE: 1, VOID: 2, TIMEOUT: 3 };
