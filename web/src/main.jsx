import React from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App.jsx";
import { WalletProvider } from "./lib/wallet.jsx";
import { TxProvider } from "./lib/tx.jsx";
import { isDemo, setDemo, loadMock } from "./lib/demo/flag.js";
import "./styles/global.css";

// ?demo=1 (or #/rounds?demo=1) switches demo mode on: simulated network and wallet, nothing leaves the browser.
try {
  const hash = location.hash;
  if (new URLSearchParams(location.search).get("demo") === "1" || /[?&]demo=1/.test(hash)) {
    setDemo(true);
    const u = new URL(location.href);
    u.searchParams.delete("demo");
    u.hash = hash.replace(/[?&]demo=1/, "");
    history.replaceState(null, "", u);
  }
} catch {
  /* ignore */
}

async function start() {
  if (isDemo()) (await loadMock()).registerDemoWallet(); // announce the pretend wallet before the wallet provider scans
  // HashRouter: the site works from any static host (GitHub Pages, IPFS, a folder) without server rewrites.
  createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <HashRouter>
        <WalletProvider>
          <TxProvider>
            <App />
          </TxProvider>
        </WalletProvider>
      </HashRouter>
    </React.StrictMode>,
  );
}
start();
