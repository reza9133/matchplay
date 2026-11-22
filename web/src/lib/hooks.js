import { useCallback, useEffect, useRef, useState } from "react";
import { onVersion, dataVersion } from "./chain.js";

/**
 * useAsync(fn, deps, { every }): runs fn, reloads when `deps` change, when a transaction was decided (invalidateAll),
 * and every `every` ms while the tab is visible. Keeps the old data on screen while it reloads.
 */
export function useAsync(fn, deps = [], { every = 0, enabled = true } = {}) {
  const [state, setState] = useState({ data: undefined, error: null, loading: enabled });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const seq = useRef(0);
  const [v, setV] = useState(dataVersion());

  useEffect(() => {
    return onVersion(setV);
  }, []);

  const load = useCallback(
    async (force = false) => {
      const my = ++seq.current;
      setState((s) => ({ ...s, loading: true }));
      try {
        const data = await fnRef.current(force);
        if (my === seq.current) setState({ data, error: null, loading: false });
      } catch (error) {
        if (my === seq.current) setState((s) => ({ data: s.data, error, loading: false }));
      }
    },
    [],
  );

  useEffect(() => {
    if (!enabled) {
      setState({ data: undefined, error: null, loading: false });
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled, v]);

  useEffect(() => {
    if (!every || !enabled) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, every);
    return () => clearInterval(t);
  }, [every, enabled, load]);

  return { ...state, reload: () => load(true) };
}

/** current unix time in seconds, ticking */
export function useNow(ms = 1000) {
  const [n, setN] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setN(Math.floor(Date.now() / 1000)), ms);
    return () => clearInterval(t);
  }, [ms]);
  return n;
}

export function useDebounced(value, ms = 400) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · Matchplay` : "Matchplay · funding rounds judged twice";
  }, [title]);
}
