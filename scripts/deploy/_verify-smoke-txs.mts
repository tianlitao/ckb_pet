/**
 * Read-only verification of a smoke run.
 *
 * Without arguments it tries deployment/smoke-latest.json, then falls back to
 * the historical 2026-10-27 run whose labels were recovered from chain
 * lineage. It checks committed status, block/txIndex, lineage, and loot inputs.
 *
 * Run: npx tsx scripts/deploy/_verify-smoke-txs.mts [smoke-json]
 */
import { existsSync, readFileSync } from "node:fs";
import { ccc } from "@ckb-ccc/ccc";

const ROOT = new URL("../..", import.meta.url).pathname;
const client = new ccc.ClientPublicTestnet({
  url: "https://testnet.ckb.dev/",
  fallbacks: ["https://testnet.ckbapp.dev/"],
});

interface Step {
  step: string;
  txHash: string;
  block?: string;
  txIndex?: string;
  committed?: boolean;
  outPoint?: string;
  consumed?: string;
}

interface Report {
  runId?: string;
  steps: Step[];
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function parseOutpoint(value: string) {
  const [txHash, rawIndex] = value.split("#");
  assert(txHash?.startsWith("0x") && rawIndex !== undefined, `bad outpoint: ${value}`);
  return { txHash, index: BigInt(rawIndex) };
}

function sameOutpoint(
  input: { previousOutput: { txHash: string; index: bigint } },
  expected: { txHash: string; index: bigint },
) {
  return (
    input.previousOutput.txHash === expected.txHash &&
    input.previousOutput.index === expected.index
  );
}

function historicalReport(): Report {
  // Labels recovered from exact input/output lineage, not from the old
  // truncated console log.
  return {
    runId: "mvqhjr2v",
    steps: [
      {
        step: "A adopt",
        txHash: "0x132162310d951cc2fd05ee1479014d13ff1e6a2a56eb4d39a8ac6f7ca13007bf",
        outPoint:
          "0x132162310d951cc2fd05ee1479014d13ff1e6a2a56eb4d39a8ac6f7ca13007bf#0",
      },
      {
        step: "A feed",
        txHash: "0x8b96efdd908fec29cc74bec1d64a3b8f5abd747b80b43c5a84c913ae785fd904",
        consumed:
          "0x132162310d951cc2fd05ee1479014d13ff1e6a2a56eb4d39a8ac6f7ca13007bf#0",
        outPoint:
          "0x8b96efdd908fec29cc74bec1d64a3b8f5abd747b80b43c5a84c913ae785fd904#0",
      },
      {
        step: "A transfer",
        txHash: "0xe87abe5cfcc98ff3c15082850cbe25b13f7842c403fa75e2430b88eccd1424a9",
        consumed:
          "0x8b96efdd908fec29cc74bec1d64a3b8f5abd747b80b43c5a84c913ae785fd904#0",
        outPoint:
          "0xe87abe5cfcc98ff3c15082850cbe25b13f7842c403fa75e2430b88eccd1424a9#0",
      },
      {
        step: "B adopt",
        txHash: "0x3d013d337c7d390b8170cbd47d8ce6b6a1780f354d150254d2024b31ba84331c",
        outPoint:
          "0x3d013d337c7d390b8170cbd47d8ce6b6a1780f354d150254d2024b31ba84331c#0",
      },
      {
        step: "B poke -> DEAD",
        txHash: "0x9a7645cb4c080a7ac96f86ebec1803d26334c5804c9f2fe77c2946846e325172",
        consumed:
          "0x3d013d337c7d390b8170cbd47d8ce6b6a1780f354d150254d2024b31ba84331c#0",
        outPoint:
          "0x9a7645cb4c080a7ac96f86ebec1803d26334c5804c9f2fe77c2946846e325172#0",
      },
      {
        step: "B loot",
        txHash: "0x80aa008d5a442b6a44179ef30e7a8f9cb2c14db992b768893f64ac5eccb44e02",
        consumed:
          "0x9a7645cb4c080a7ac96f86ebec1803d26334c5804c9f2fe77c2946846e325172#0",
      },
      {
        step: "C adopt",
        txHash: "0x210eff41935272f014166f48c46ae75b2331c5534d986cc631a69dd9b4b261bd",
        outPoint:
          "0x210eff41935272f014166f48c46ae75b2331c5534d986cc631a69dd9b4b261bd#0",
      },
      {
        step: "C euthanize",
        txHash: "0xf6809913aaafd3a1b5123206c2698507db87c7e77490cd105949c7629348ee9e",
        consumed:
          "0x210eff41935272f014166f48c46ae75b2331c5534d986cc631a69dd9b4b261bd#0",
        outPoint:
          "0xf6809913aaafd3a1b5123206c2698507db87c7e77490cd105949c7629348ee9e#0",
      },
      {
        step: "C loot",
        txHash: "0x05b8aeb48d46a1b458b4a39197d2f7207f518743c5e3c043e015f0212ac986a9",
        consumed:
          "0xf6809913aaafd3a1b5123206c2698507db87c7e77490cd105949c7629348ee9e#0",
      },
    ],
  };
}

function loadReport(): { report: Report; source: string } {
  const arg = process.argv[2];
  const defaultFile = ROOT + "deployment/smoke-latest.json";
  const file =
    arg ??
    (existsSync(defaultFile) ? defaultFile : undefined);
  if (file) {
    return {
      report: JSON.parse(readFileSync(file, "utf8")) as Report,
      source: file,
    };
  }
  return { report: historicalReport(), source: "historical map" };
}

async function verify(report: Report) {
  assert(Array.isArray(report.steps) && report.steps.length > 0, "report has no steps");
  const txs = new Map<string, ccc.ClientTransactionResponse>();
  const outputs = new Map<string, string>();

  for (const step of report.steps) {
    const tx = await client.getTransaction(step.txHash);
    assert(tx, `${step.step}: tx ${step.txHash} missing`);
    assert(
      tx.status === "committed",
      `${step.step}: status=${tx.status}, expected committed`,
    );
    if (step.block !== undefined) {
      assert(tx.blockNumber?.toString() === step.block, `${step.step}: block mismatch`);
    }
    if (step.txIndex !== undefined && step.txIndex !== "?") {
      assert(tx.txIndex?.toString() === step.txIndex, `${step.step}: txIndex mismatch`);
    }

    if (step.outPoint) {
      const expected = parseOutpoint(step.outPoint);
      assert(
        expected.txHash === step.txHash,
        `${step.step}: declared output does not belong to tx ${step.txHash}`,
      );
      assert(
        expected.index < BigInt(tx.transaction.outputs.length),
        `${step.step}: output index ${expected.index} is out of range`,
      );
      assert(
        !outputs.has(step.outPoint),
        `${step.step}: duplicate output outpoint ${step.outPoint}`,
      );
      outputs.set(step.outPoint, step.step);
    }

    if (step.consumed) {
      const expected = parseOutpoint(step.consumed);
      assert(
        tx.transaction.inputs.some((input) => sameOutpoint(input, expected)),
        `${step.step}: tx does not consume ${step.consumed}`,
      );
    }

    txs.set(step.txHash, tx);
    console.log(
      `OK ${step.step}: ${step.txHash} block=${tx.blockNumber?.toString() ?? "?"} txIndex=${tx.txIndex?.toString() ?? "?"}`,
    );
  }

  // Additional one-output lineage check: an operation's output must be the
  // next operation's exact input when that next step declares consumed.
  for (let i = 0; i < report.steps.length - 1; i++) {
    const current = report.steps[i];
    const next = report.steps[i + 1];
    const currentOut = current.outPoint
      ? parseOutpoint(current.outPoint)
      : undefined;
    if (!currentOut || !next.consumed) continue;
    const nextTx = txs.get(next.txHash);
    assert(nextTx, `${next.step}: tx missing during lineage check`);
    assert(
      nextTx.transaction.inputs.some((input) => sameOutpoint(input, currentOut)),
      `${next.step}: does not consume previous ${current.outPoint}`,
    );
  }
}

const { report, source } = loadReport();
console.log(`source: ${source}`);
try {
  await verify(report);
  console.log(
    `PASS ${report.steps.length} committed steps${report.runId ? ` (${report.runId})` : ""}`,
  );
} catch (error) {
  console.error(`FAIL ${String(error)}`);
  process.exit(1);
}
