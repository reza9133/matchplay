// EIP-6963 wallet discovery + connection state.
//
//  * Wallets announce themselves with `eip6963:announceProvider`; we ask for them with `eip6963:requestProvider`.
//  * connect() asks the chosen wallet for accounts. disconnect() forgets the wallet here and (where the wallet supports
//    it) revokes the site's permission with wallet_revokePermissions, so the wallet itself also shows "not connected".
//  * If the wallet is on the wrong chain the app shows a banner and offers to switch to GenLayer Studionet
//    (wallet_switchEthereumChain, falling back to wallet_addEthereumChain).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "genlayer-js";
import { studionet } from "./chain.js";
import { CHAIN_ID, CHAIN_ID_HEX, CHAIN_NAME, EXPLORER_URL, RPC_URL } from "../config.js";

const Ctx = createContext(null);
export const useWallet = () => useContext(Ctx);

const LS_RDNS = "matchplay:wallet:rdns";
const LS_ON = "matchplay:wallet:connected";
const ls = {
  get: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode */
    }
  },
  del: (k) => {
    try {
      localStorage.removeItem(k);
    } catch {
      /* private mode */
    }
  },
};

const hexToInt = (h) => {
  try {
    return parseInt(h, 16);
  } catch {
    return null;
  }
};

export function WalletProvider({ children }) {
  const [providers, setProviders] = useState([]); // [{ info, provider }]
  const [scanned, setScanned] = useState(false);
  const [active, setActive] = useState(null); // { info, provider }
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [status, setStatus] = useState("disconnected"); // disconnected | connecting | connected
  const [error, setError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [notice, setNotice] = useState(null);
  const activeRef = useRef(null);
  const listeners = useRef({});

  // ---- discovery ----------------------------------------------------------------------------------------------------
  useEffect(() => {
    const seen = new Map();
    const onAnnounce = (ev) => {
      const d = ev.detail;
      if (!d?.info?.uuid || !d.provider) return;
      seen.set(d.info.uuid, d);
      setProviders(Array.from(seen.values()));
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    // a wallet that does not speak EIP-6963 but injects window.ethereum is offered as a fallback
    const t = setTimeout(() => {
      if (seen.size === 0 && window.ethereum) {
        const d = {
          info: { uuid: "legacy-injected", name: window.ethereum.isMetaMask ? "MetaMask (injected)" : "Browser wallet", icon: "", rdns: "injected.legacy" },
          provider: window.ethereum,
        };
        seen.set(d.info.uuid, d);
        setProviders(Array.from(seen.values()));
      }
      setScanned(true);
    }, 700);
    return () => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      clearTimeout(t);
    };
  }, []);

  // ---- provider events ------------------------------------------------------------------------------------------------
  const detach = useCallback(() => {
    const p = activeRef.current?.provider;
    const l = listeners.current;
    if (p?.removeListener) {
      if (l.accounts) p.removeListener("accountsChanged", l.accounts);
      if (l.chain) p.removeListener("chainChanged", l.chain);
      if (l.disconnect) p.removeListener("disconnect", l.disconnect);
    }
    listeners.current = {};
  }, []);

  const reset = useCallback(() => {
    detach();
    activeRef.current = null;
    setActive(null);
    setAccount(null);
    setChainId(null);
    setStatus("disconnected");
  }, [detach]);

  const attach = useCallback(
    (entry) => {
      detach();
      activeRef.current = entry;
      const p = entry.provider;
      const accounts = (list) => {
        if (!list || list.length === 0) {
          ls.del(LS_ON);
          reset();
          setNotice("Wallet disconnected.");
        } else setAccount(list[0]);
      };
      const chain = (id) => setChainId(hexToInt(id));
      const disc = () => {
        ls.del(LS_ON);
        reset();
      };
      listeners.current = { accounts, chain, disconnect: disc };
      p.on?.("accountsChanged", accounts);
      p.on?.("chainChanged", chain);
      p.on?.("disconnect", disc);
    },
    [detach, reset],
  );

  // ---- connect / disconnect ---------------------------------------------------------------------------------------------
  const connect = useCallback(
    async (entry) => {
      setError(null);
      setStatus("connecting");
      try {
        const accs = await entry.provider.request({ method: "eth_requestAccounts" });
        if (!accs?.length) throw new Error("The wallet returned no account.");
        const cid = await entry.provider.request({ method: "eth_chainId" });
        attach(entry);
        setActive(entry);
        setAccount(accs[0]);
        setChainId(hexToInt(cid));
        setStatus("connected");
        ls.set(LS_RDNS, entry.info.rdns || entry.info.uuid);
        ls.set(LS_ON, "1");
        setModalOpen(false);
        setNotice(null);
      } catch (e) {
        setStatus("disconnected");
        setError(e?.code === 4001 ? "You closed the wallet request." : e?.message || "Could not connect.");
      }
    },
    [attach],
  );

  const disconnect = useCallback(async () => {
    const entry = activeRef.current;
    ls.del(LS_ON); // never reconnect silently after an explicit disconnect
    try {
      await entry?.provider?.request?.({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
    } catch {
      /* not every wallet supports it; the site has still forgotten the account */
    }
    reset();
    setNotice("Disconnected. This site no longer sees your account.");
  }, [reset]);

  // silent reconnect to the wallet used last time (no popup: eth_accounts only returns what is already permitted)
  useEffect(() => {
    if (active || providers.length === 0 || ls.get(LS_ON) !== "1") return;
    const want = ls.get(LS_RDNS);
    const entry = providers.find((p) => (p.info.rdns || p.info.uuid) === want);
    if (!entry) return;
    (async () => {
      try {
        const accs = await entry.provider.request({ method: "eth_accounts" });
        if (!accs?.length) return;
        const cid = await entry.provider.request({ method: "eth_chainId" });
        attach(entry);
        setActive(entry);
        setAccount(accs[0]);
        setChainId(hexToInt(cid));
        setStatus("connected");
      } catch {
        /* ignore */
      }
    })();
  }, [providers, active, attach]);

  // ---- network ----------------------------------------------------------------------------------------------------------
  const [switching, setSwitching] = useState(false);
  const switchNetwork = useCallback(async () => {
    const p = activeRef.current?.provider;
    if (!p) return false;
    setSwitching(true);
    setError(null);
    try {
      try {
        await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_ID_HEX }] });
      } catch (e) {
        // 4902 = the wallet does not know the chain yet (some wallets use -32603 for the same thing)
        if (e?.code === 4902 || e?.code === -32603 || /unrecognized|not added|unknown chain/i.test(String(e?.message))) {
          await p.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: CHAIN_ID_HEX,
                chainName: CHAIN_NAME,
                nativeCurrency: { name: "GEN Token", symbol: "GEN", decimals: 18 },
                rpcUrls: [RPC_URL],
                blockExplorerUrls: [EXPLORER_URL],
              },
            ],
          });
          await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_ID_HEX }] });
        } else throw e;
      }
      setChainId(hexToInt(await p.request({ method: "eth_chainId" })));
      return true;
    } catch (e) {
      setError(e?.code === 4001 ? "You rejected the network switch." : e?.message || "Could not switch the network.");
      return false;
    } finally {
      setSwitching(false);
    }
  }, []);

  const client = useMemo(() => {
    if (!active || !account) return null;
    return createClient({ chain: studionet, account, provider: active.provider });
  }, [active, account]);

  const value = useMemo(
    () => ({
      providers, scanned, active, account, chainId, status, error, notice, modalOpen, switching, client,
      connected: status === "connected" && !!account,
      wrongChain: status === "connected" && chainId !== null && chainId !== CHAIN_ID,
      ready: status === "connected" && !!account && chainId === CHAIN_ID,
      connect, disconnect, switchNetwork,
      openModal: () => setModalOpen(true),
      closeModal: () => setModalOpen(false),
      clearNotice: () => setNotice(null),
      clearError: () => setError(null),
    }),
    [providers, scanned, active, account, chainId, status, error, notice, modalOpen, switching, client, connect, disconnect, switchNetwork],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
