import { setDemo } from "../lib/demo/flag.js";
import { useEffect, useRef, useState } from "react";
import { useWallet } from "../lib/wallet.jsx";
import { shortAddr } from "../lib/format.js";
import { CHAIN_ID } from "../config.js";
import { Button, Notice } from "./UI.jsx";
import { Spinner } from "./Spinners.jsx";

export function ConnectButton() {
  const w = useWallet();
  const [menu, setMenu] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const close = (e) => ref.current && !ref.current.contains(e.target) && setMenu(false);
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  if (!w.connected)
    return (
      <Button onClick={w.openModal} busy={w.status === "connecting"}>
        Connect wallet
      </Button>
    );
  return (
    <div className="acct" ref={ref}>
      <button className={`acct-btn ${w.wrongChain ? "acct-warn" : ""}`} onClick={() => setMenu((m) => !m)} aria-expanded={menu}>
        {w.active?.info?.icon ? <img src={w.active.info.icon} alt="" /> : <i className="acct-dot" />}
        <span>{shortAddr(w.account, 6, 4)}</span>
        <small>▾</small>
      </button>
      {menu && (
        <div className="acct-menu">
          <div className="acct-row">
            <span>Wallet</span>
            <b>{w.active?.info?.name || "Browser wallet"}</b>
          </div>
          <div className="acct-row">
            <span>Network</span>
            <b className={w.wrongChain ? "err" : "ok"}>{w.wrongChain ? `Chain ${w.chainId} (wrong)` : "GenLayer Studionet"}</b>
          </div>
          <div className="acct-row">
            <span>Address</span>
            <b className="mono">{shortAddr(w.account, 10, 6)}</b>
          </div>
          {w.wrongChain && (
            <Button size="sm" onClick={w.switchNetwork} busy={w.switching}>
              Switch to Studionet
            </Button>
          )}
          <Button
            tone="danger"
            size="sm"
            onClick={() => {
              setMenu(false);
              w.disconnect();
            }}
          >
            Disconnect
          </Button>
        </div>
      )}
    </div>
  );
}

export function ConnectModal() {
  const w = useWallet();
  if (!w.modalOpen) return null;
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && w.closeModal()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Connect a wallet">
        <button className="modal-x" onClick={w.closeModal} aria-label="Close">×</button>
        <h3>Connect a wallet</h3>
        <p className="muted">Pick one of the wallets found in this browser (EIP-6963). Matchplay runs on GenLayer Studionet; if your wallet is on another network you will be asked to switch.</p>
        {w.error && <Notice tone="error">{w.error}</Notice>}
        <div className="wallet-list">
          {w.providers.map((p) => (
            <button key={p.info.uuid} className="wallet-item" onClick={() => w.connect(p)} disabled={w.status === "connecting"}>
              {p.info.icon ? <img src={p.info.icon} alt="" /> : <span className="wallet-ph">◇</span>}
              <span>
                <b>{p.info.name}</b>
                <small>{p.info.rdns || "injected"}</small>
              </span>
              {w.status === "connecting" ? <Spinner size={18} /> : <em>Connect →</em>}
            </button>
          ))}
          {w.providers.length === 0 && !w.scanned && (
            <div className="wallet-scan">
              <Spinner size={18} /> Looking for wallets…
            </div>
          )}
          {w.providers.length === 0 && w.scanned && (
            <Notice tone="warn" title="No wallet found">
              Install a browser wallet such as <a href="https://metamask.io/download/" target="_blank" rel="noreferrer">MetaMask</a>, then reload this page. Without a wallet you can still browse every round (read-only).{" "}
              <button type="button" className="linklike" style={{ marginLeft: 0 }} onClick={() => { setDemo(true); location.reload(); }}>Or look around in demo mode</button>
            </Notice>
          )}
        </div>
      </div>
    </div>
  );
}

/** Shown under the header when the wallet is connected to some other network. */
export function NetworkBanner() {
  const w = useWallet();
  if (!w.wrongChain) {
    if (w.notice)
      return (
        <div className="banner banner-info">
          <span>{w.notice}</span>
          <button onClick={w.clearNotice} aria-label="Dismiss">×</button>
        </div>
      );
    return null;
  }
  return (
    <div className="banner banner-warn">
      <span>
        Your wallet is on chain <b>{w.chainId}</b>. Matchplay lives on <b>GenLayer Studionet</b> (chain {CHAIN_ID}). Transactions are blocked until you switch.
      </span>
      <Button size="sm" onClick={w.switchNetwork} busy={w.switching}>
        Switch to Studionet
      </Button>
      {w.error && <em className="err">{w.error}</em>}
    </div>
  );
}

/** A button that needs a wallet on the right network: shows the right next step instead of failing. */
export function NeedWallet({ children, label = "Connect wallet to continue" }) {
  const w = useWallet();
  if (!w.connected) return <Button onClick={w.openModal}>{label}</Button>;
  if (w.wrongChain)
    return (
      <Button onClick={w.switchNetwork} busy={w.switching}>
        Switch to Studionet to continue
      </Button>
    );
  return children;
}
