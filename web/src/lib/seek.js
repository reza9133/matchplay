// Seeking that works on every host.
// A static server that ignores byte-range requests (python -m http.server, some CDN misses, many simple hosts) makes the
// browser unable to jump into the middle of a video: every chapter click or click on the progress bar restarts it at 0:00.
// The browser also clamps currentTime at once, so the requested position cannot be read back afterwards.
// So we ask the server up front whether it speaks ranges (a 1-byte request). If it does not, the file is downloaded once
// and played from memory, where seeking always works. As a second safety net every chapter jump is verified.

const state = new WeakMap(); // video -> { mem: bool }
const probes = new Map(); // url -> Promise<true|false|null>

const srcOf = (v) => v.currentSrc || v.src || v.querySelector("source")?.src || "";

/** true = the server answers range requests, false = it does not, null = could not tell. */
function rangeSupported(url) {
  if (!url || url.startsWith("blob:")) return Promise.resolve(true);
  if (!probes.has(url)) {
    probes.set(
      url,
      fetch(url, { headers: { Range: "bytes=0-0" } })
        .then((r) => { r.body?.cancel?.(); return r.status === 206; })
        .catch(() => null),
    );
  }
  return probes.get(url);
}

/** Resolves once the duration is known. Starts fetching the metadata if the element is idle (preload="none"). */
export function whenReady(v) {
  return new Promise((resolve) => {
    if (v.readyState >= 1) return resolve();
    v.addEventListener("loadedmetadata", () => resolve(), { once: true });
    if (v.networkState !== 2) { // 2 = already loading
      if (v.preload === "none") v.preload = "metadata";
      v.load();
    }
  });
}

/** Download the whole file once and play it from memory, continuing at `t`. */
async function toMemory(v, card, t, resume) {
  const st = state.get(v) || {};
  if (st.mem || st.busy) return;
  st.busy = true; state.set(v, st);
  card?.classList.add("buffering");
  try {
    const res = await fetch(srcOf(v));
    const type = res.headers.get("content-type") || "video/mp4";
    const url = URL.createObjectURL(new Blob([await res.blob()], { type }));
    await new Promise((done) => { v.addEventListener("loadedmetadata", done, { once: true }); v.src = url; v.load(); });
    st.mem = true;
    v.currentTime = t || 0;
    if (resume) v.play().catch(() => {});
  } catch { /* keep whatever the browser managed to do */ } finally { st.busy = false; card?.classList.remove("buffering"); }
}

/** Jump to `t` seconds (clamped) and optionally start playing from there. */
export async function seekTo(v, t, { play = true, card } = {}) {
  await whenReady(v);
  const max = Number.isFinite(v.duration) ? Math.max(0, v.duration - 0.3) : t;
  const target = Math.min(Math.max(0, t), max);
  const st = state.get(v) || {};
  if (!st.mem && (await rangeSupported(srcOf(v))) === false) return toMemory(v, card, target, play);
  const landed = new Promise((res) => {
    const tm = setTimeout(() => res(false), 5000);
    v.addEventListener("seeked", () => { clearTimeout(tm); res(Math.abs(v.currentTime - target) <= 2.5); }, { once: true });
  });
  v.currentTime = target;
  if (play) v.play().catch(() => {});
  if (!(await landed) && !(state.get(v) || {}).mem) toMemory(v, card, target, play); // the jump did not land: use the in-memory copy
}

/** Call once per video. Probes the server early; if it has no range support, switches to the in-memory copy as soon as the
 *  video starts, so the native progress bar works too. */
export function guardSeeking(v, card) {
  rangeSupported(srcOf(v));
  v.addEventListener("play", () => {
    if ((state.get(v) || {}).mem) return;
    rangeSupported(srcOf(v)).then((ok) => { if (ok === false) toMemory(v, card, v.currentTime, !v.paused); });
  });
}
