/**
 * Step 1: create (or load) the testnet deployer key and claim faucet funds.
 * Testnet-only key — never use on mainnet.
 *   node scripts/deploy/1-fund.mjs
 */
import { ccc } from "@ckb-ccc/ccc";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";

const ROOT = new URL("../..", import.meta.url).pathname;
const KEYFILE = ROOT + "deployment/deploy-key.json";

function client() {
  // Force HTTP transports — the default ClientPublicTestnet leads with a WS
  // url that stalls in this Node environment. open() keeps the testnet
  // known-scripts + address prefix that bare ClientJsonRpc lacks.
  return new ccc.ClientPublicTestnet({
    url: "https://testnet.ckb.dev/",
    fallbacks: ["https://testnet.ckbapp.dev/"],
  });
}

async function main() {
  try {
  const c = client();
  let priv;
  if (existsSync(KEYFILE)) {
    priv = JSON.parse(readFileSync(KEYFILE)).privateKey;
    console.log("loaded existing deploy key");
  } else {
    priv = "0x" + randomBytes(32).toString("hex");
    writeFileSync(
      KEYFILE,
      JSON.stringify(
        {
          warning: "TESTNET ONLY — funded by faucet, has no real value",
          privateKey: priv,
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    console.log("generated new deploy key ->", KEYFILE);
  }
  const signer = new ccc.SignerCkbPrivateKey(c, priv);
  const addr = (await signer.getAddressObjs())[0];
  const address = await signer.getRecommendedAddress();
  const lockHash = ccc.hashCkb(addr.script.toHex());
  console.log("address:", address);
  console.log("deployer lock hash (this address's lock):", lockHash);
  const bal = await signer.getBalance();
  console.log("balance:", Number(bal) / 1e8, "CKB");

  // Faucet claiming needs a proxy (faucet-api is blocked direct) — do it via:
  //   curl -x http://127.0.0.1:7897 -X POST https://faucet-api.nervos.org/claim_events \
  //     -H 'content-type: application/json' \
  //     -d '{"claim_event":{"address_hash":"<address>","amount":"10000"}}'
  if (bal < 2_000n * 100_000_000n) {
    console.log("balance low — claim faucet funds for", address, "via curl (see comment)");
  }
  } catch (e) {
    console.error("FAILED:", String(e?.stack ?? e).split("\n").slice(0, 3).join(" | ").slice(0, 400));
    process.exit(1);
  }
}

await main();
