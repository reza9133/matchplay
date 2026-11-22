# Matchplay web

The front end for the **Matchplay** Intelligent Contract on **GenLayer Studionet**.

- Contract: `0xdd842644E5fEaba5c4FDB28d97236b5B58C5C69c` (change it in `.env` or `src/config.js`)
- Repo: https://github.com/reza9133/matchplay · Author: https://x.com/amirhp771

## Run

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # static site in dist/ (hash router, relative base: works on GitHub Pages, IPFS, any folder)
```

Copy `.env.example` to `.env` to override the contract address or the demo video.
Drop your demo video at `public/demo/matchplay-demo.mp4` (or set `VITE_DEMO_VIDEO_URL` to a YouTube/hosted link).

## Pages

| Route | What it does |
|---|---|
| `#/` | Landing: hero, live stats, how it works, 3D arena, latest rounds |
| `#/rounds` | All rounds, filter / search / paging |
| `#/round/:id` | Entries, matches with full verdict reviews, 3D arena, money table, every write action |
| `#/create` | Create a round with live economics and full input validation |
| `#/me` | Your rounds, your credit, claim |
| `#/ledger` | `stats()`, `solvency()`, `audit_books()` and the contract's real balance |
| `#/docs` | Full documentation (lifecycle, rules, money, wallet, Studionet quirks, interface, errors, FAQ) |
| `#/demo` | Click-to-play demo video |

## Demo mode

Open the site with `?demo=1` (for example `https://your-site/?demo=1`), or press *Or look around in demo mode* in the wallet dialog,
or *Try demo mode yourself* on the Demo page. The app then talks to an in-browser copy of the contract rules
(`src/lib/demo/`) and a pretend EIP-6963 wallet that starts on the wrong network, so the real connect and switch flow can be tried.
Nothing is sent anywhere and no GEN is needed. The orange bar has *Reset demo data* and *Exit demo*. The engine is only downloaded in demo mode.

## Demo video

`public/demo/matchplay-demo.mp4` + `poster.jpg` are included. The video has a keyframe every ~2.4 s and its index at the front,
and `src/lib/seek.js` makes chapter jumps and the progress bar work even on a host that does not serve byte ranges
(it falls back to playing an in-memory copy).

## Wallet (EIP-6963)

`src/lib/wallet.jsx` discovers wallets with `eip6963:requestProvider` / `eip6963:announceProvider`
(with a `window.ethereum` fallback). Connect = `eth_requestAccounts`; disconnect forgets the account and calls
`wallet_revokePermissions` where supported, and never auto-reconnects afterwards. A wrong network shows a banner and blocks
transactions until the user switches (`wallet_switchEthereumChain`, then `wallet_addEthereumChain` for chain 61999).

## Studionet quirks handled

- **Refused payable calls trap GEN** (`create_round`, `enter`, `top_up`): `src/lib/validate.js` ports the contract's rules
  (lengths, bond/prize minimums, pitch letters, public-URL rules, duplicate evidence/pitch, tripwire) and the app also calls
  the contract's `would_steer()` view and re-reads the round right before attaching any value.
- **`play_next` UNDETERMINED**: shown as "no state changed, retry now"; the 120 s cool-down is applied only when `tries > 0`.
- **500 requests/hour rate limit**: reads are cached, de-duplicated, polled slowly and back off (`src/lib/chain.js`).

## Layout

```
src/
  lib/        chain.js (reads, cache, rate limits) · wallet.jsx · tx.jsx · receipt.js · validate.js · format.js · hooks.js
  components/ Logo · Spinners · Arena3D (three.js) · UI · WalletUI · Layout · RoundCard
  pages/      Home · Rounds · RoundDetail · Create · Dashboard · Ledger · Docs · Demo · NotFound
public/       brand/ (GenLayer logo/symbol/GEN token from the media kit, Matchplay mark) · img/ (Mochi + arena art) · demo/
```

Third-party artwork: GenLayer logo, symbol and GEN token from the GenLayer media kit; the arena image and Mochi mascot
from the supplied image.
