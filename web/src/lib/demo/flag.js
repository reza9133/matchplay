// Demo mode: the app talks to an in-browser copy of the contract and a pretend wallet instead of Studionet.
// Kept tiny on purpose; the engine itself (mock.js) is only downloaded when demo mode is on.
export const isDemo = () => { try { return localStorage.getItem("mp.demo") === "1"; } catch { return false; } };
export function setDemo(on) { try { on ? localStorage.setItem("mp.demo", "1") : localStorage.removeItem("mp.demo"); } catch { /* private mode */ } }
export const loadMock = () => import("./mock.js");
