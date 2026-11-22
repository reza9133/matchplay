// Sends one contract write through the connected wallet and follows it until the network has decided it.
import { createContext, useCallback, useContext, useRef, useState } from "react";
import { CONTRACT_ADDRESS, EXPLORER_URL } from "../config.js";
import { invalidateAll } from "./chain.js";
import { outcome, waitDecided } from "./receipt.js";
import { useWallet } from "./wallet.jsx";
import { isDemo, loadMock } from "./demo/flag.js";
import { JudgeSpinner, Spinner } from "../components/Spinners.jsx";

const Ctx = createContext(null);
export const useTx = () => useContext(Ctx);

export function TxProvider({ children }) {
  const wallet = useWallet();
  const [items, setItems] = useState([]);
  const seq = useRef(0);
  const busy = items.some((t) => t.phase === "wallet" || t.phase === "pending");

  const patch = (id, p) => setItems((xs) => xs.map((t) => (t.id === id ? { ...t, ...p } : t)));
  const dismiss = useCallback((id) => setItems((xs) => xs.filter((t) => t.id !== id)), []);

  /**
   * spec: { fn, args, value (bigint, optional), label, kind ("play" shows the judge animation) }
   * resolves with { ok, hash, out } and never throws: errors come back as { ok:false, error }.
   */
  const send = useCallback(
    async (spec) => {
      const id = ++seq.current;
      const base = { id, label: spec.label || spec.fn, fn: spec.fn, kind: spec.kind, value: spec.value ?? 0n, phase: "wallet", at: Date.now() };
      setItems((xs) => [...xs.filter((t) => t.phase !== "done" && t.phase !== "failed").slice(-3), base]);
      if (!wallet.client) {
        patch(id, { phase: "failed", error: "Connect a wallet first." });
        return { ok: false, error: "Connect a wallet first." };
      }
      if (!wallet.ready) {
        patch(id, { phase: "failed", error: "Switch your wallet to GenLayer Studionet first." });
        return { ok: false, error: "Wrong network." };
      }
      if (isDemo()) {
        try {
          const mock = await loadMock();
          const res = await mock.send({
            fn: spec.fn, args: spec.args ?? [], value: spec.value ?? 0n, from: wallet.account,
            onStage: (stage, info) => { if (stage === "sent") patch(id, { phase: "pending", hash: info?.hash }); },
          });
          invalidateAll();
          const out = { ok: res.ok, known: true, undetermined: false, reason: res.detail };
          if (res.ok) patch(id, { phase: "done", out });
          else patch(id, { phase: "failed", out, error: res.detail || "The contract refused this call. Nothing changed." });
          return { ok: res.ok, hash: res.hash, out };
        } catch (e) {
          const msg = String(e?.message || e).slice(0, 240);
          patch(id, { phase: "failed", error: msg });
          return { ok: false, error: msg };
        }
      }
      let hash;
      try {
        const call = { address: CONTRACT_ADDRESS, functionName: spec.fn, args: spec.args ?? [] };
        if (spec.value && spec.value > 0n) call.value = spec.value;
        hash = await wallet.client.writeContract(call);
      } catch (e) {
        const msg = e?.code === 4001 || /user rejected|denied/i.test(String(e?.message)) ? "You rejected the request in your wallet." : String(e?.shortMessage || e?.message || e).slice(0, 240);
        patch(id, { phase: "failed", error: msg, rejected: e?.code === 4001 });
        return { ok: false, error: msg };
      }
      patch(id, { phase: "pending", hash });
      try {
        const receipt = await waitDecided(wallet.client, hash);
        const out = outcome(receipt);
        invalidateAll();
        if (out.ok) patch(id, { phase: "done", out });
        else patch(id, { phase: "failed", out, error: out.reason || (out.known ? "The contract refused this call. Nothing changed." : "The result could not be read. Check the explorer.") });
        return { ok: out.ok, hash, out };
      } catch (e) {
        patch(id, { phase: "failed", error: String(e?.message || e).slice(0, 240), hash });
        return { ok: false, hash, error: String(e?.message || e) };
      }
    },
    [wallet.client, wallet.ready],
  );

  return (
    <Ctx.Provider value={{ send, busy, items }}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.phase}`}>
            <div className="toast-icon">
              {t.phase === "wallet" || t.phase === "pending" ? (t.kind === "play" && t.phase === "pending" ? <JudgeSpinner mini /> : <Spinner size={22} />) : t.phase === "done" ? <span className="tick">✓</span> : <span className="cross">!</span>}
            </div>
            <div className="toast-body">
              <b>{t.label}</b>
              <span>
                {t.phase === "wallet" && "Confirm in your wallet…"}
                {t.phase === "pending" && (t.kind === "play" ? "The judge is reading both entries twice. This can take a few minutes." : "Waiting for the network to decide…")}
                {t.phase === "done" && "Decided: success."}
                {t.phase === "failed" && (t.error || "Failed.")}
              </span>
              {t.out?.undetermined && <span className="toast-hint">No state changed. You can try again right away.</span>}
              {t.phase === "failed" && t.value > 0n && t.out?.known && !t.out?.undetermined && (
                <span className="toast-hint warn">On Studionet the GEN attached to a refused payable call stays in the contract. That is why this app checks every input first.</span>
              )}
              {t.hash && !isDemo() && (
                <a href={`${EXPLORER_URL}/transactions/${t.hash}`} target="_blank" rel="noreferrer">
                  View transaction ↗
                </a>
              )}
            </div>
            {(t.phase === "done" || t.phase === "failed") && (
              <button className="toast-x" onClick={() => dismiss(t.id)} aria-label="Dismiss">
                ×
              </button>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
