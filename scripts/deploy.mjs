// Deploys contracts/matchplay.py to Studionet and prints the address.
// Usage: DEPLOY_KEY=0x... node scripts/deploy.mjs      (the address is also written to .matchplay-address)
import { readFileSync, writeFileSync } from "node:fs";
import { outcome } from "./receipt.mjs";

export async function deploy(key = process.env.DEPLOY_KEY ?? process.env.HOST_KEY) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(key ?? "")) {
    throw new Error("Set DEPLOY_KEY (or HOST_KEY) to the private key (0x...) of an account funded on Studionet.");
  }
  const sdk = await import("genlayer-js");
  const { studionet } = await import("genlayer-js/chains");
  const account = sdk.createAccount(key);
  const client = sdk.createClient({ chain: studionet, account });
  const code = new Uint8Array(readFileSync(new URL("../contracts/matchplay.py", import.meta.url)));
  console.log(`Deploying from ${account.address} ...`);
  const hash = await client.deployContract({ code, args: [] });
  const opts = { hash, retries: 200, interval: 3000 };
  const receipt =
    typeof client.waitForDecision === "function"
      ? await client.waitForDecision(opts)
      : await client.waitForTransactionReceipt({ ...opts, status: "ACCEPTED" });
  const out = outcome(receipt);
  if (!out.known) console.log(`note: the receipt has no readable result (${out.status}); continuing to look for the contract address.`);
  if (out.known && !out.ok) throw new Error(`Deployment was decided as ${out.status}`);
  const address = receipt?.txDataDecoded?.contractAddress ?? receipt?.data?.contract_address ?? receipt?.recipient ?? receipt?.to_address;
  if (!address) throw new Error(`Deployed, but the address is not in the receipt. Look up transaction ${hash} in the explorer.`);
  return { address, hash };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const { address, hash } = await deploy();
    writeFileSync(new URL("../.matchplay-address", import.meta.url), address + "\n");
    console.log(`Contract: ${address}\nTransaction: ${hash}`);
  } catch (err) {
    console.error(String(err?.message ?? err));
    process.exit(1);
  }
}
