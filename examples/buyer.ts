/**
 * Vouch buyer agent — proves the end-to-end x402 paid loop.
 *
 * What it does:
 *   1. Calls the FREE  `POST /v1/report` endpoint (no payment) for contrast.
 *   2. Calls the PAID  `POST /v1/check`  endpoint. Vouch answers 402, this
 *      client automatically pays USDC and retries — all handled by
 *      `@x402/fetch`'s `wrapFetchWithPayment`.
 *
 * Network: defaults to Base Sepolia (testnet) — safe for a LOCAL Vouch instance.
 * The LIVE service (vouch.futuronoti.workers.dev) is on Base MAINNET; to pay it
 * set `X402_NETWORK=base`, which spends REAL USDC from a Base-mainnet wallet.
 *
 * Run it (see examples/README.md for the full walkthrough):
 *
 *   PRIVATE_KEY=0xYOUR_TESTNET_KEY \
 *   VOUCH_URL=http://localhost:8787 \
 *   npx tsx examples/buyer.ts https://some-merchant.com
 *
 * SECURITY: the private key is read from the environment only — never hardcode
 * a key. Use a throwaway *testnet* key unless you intentionally set X402_NETWORK=base.
 */

import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http } from "viem";
import { base, baseSepolia } from "viem/chains";

// Node's `process` without depending on @types/node being installed.
declare const process: {
  env: Record<string, string | undefined>;
  argv: string[];
  exit(code?: number): never;
};

// Network selection (CAIP-2 form expected by x402 v2). Defaults to Base Sepolia
// testnet — the safe choice for a local dev instance. The LIVE Vouch service runs
// on Base MAINNET, so to pay it for real set X402_NETWORK=base (this spends REAL
// USDC). Must match whatever the server's 402 challenge advertises.
const NETWORKS = {
  "base-sepolia": { chain: baseSepolia, caip2: "eip155:84532", label: "Base Sepolia (testnet)" },
  base: { chain: base, caip2: "eip155:8453", label: "Base mainnet (REAL USDC)" },
} as const;
const NETWORK_NAME = (process.env.X402_NETWORK ?? "base-sepolia") as keyof typeof NETWORKS;
const NET = NETWORKS[NETWORK_NAME] ?? NETWORKS["base-sepolia"];
const NETWORK = NET.caip2;

/** Print a short, friendly setup guide and exit. */
function bail(message: string): never {
  console.error(`\n  ${message}\n`);
  console.error("  Quick start (Base Sepolia testnet):");
  console.error("    1. Create a throwaway testnet wallet and export its key.");
  console.error("    2. Fund it with testnet USDC: https://faucet.circle.com (Base Sepolia).");
  console.error("    3. Start Vouch locally:  npm run dev   (defaults to http://localhost:8787)");
  console.error("    4. Run this agent:");
  console.error("         PRIVATE_KEY=0x... npx tsx examples/buyer.ts https://some-merchant.com\n");
  process.exit(1);
}

async function main(): Promise<void> {
  // ---- 1. Read + validate configuration ----------------------------------
  const rawKey = process.env.PRIVATE_KEY;
  if (!rawKey) {
    bail("Missing PRIVATE_KEY. Set it to a Base Sepolia *testnet* private key.");
  }
  // viem wants a 0x-prefixed hex string.
  const privateKey = (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as `0x${string}`;

  const vouchUrl = (process.env.VOUCH_URL ?? "http://localhost:8787").replace(/\/$/, "");
  // The counterparty the agent is about to pay — overridable via CLI arg.
  const target = process.argv[2] ?? "https://some-merchant.com";

  // ---- 2. Build the x402 EVM signer from the private key ------------------
  // `privateKeyToAccount` can sign typed data but cannot read chain state, so
  // we pair it with a public client. `toClientEvmSigner` composes the two into
  // the `ClientEvmSigner` shape that `ExactEvmScheme` expects.
  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({ chain: NET.chain, transport: http() });
  if (NETWORK_NAME === "base") {
    console.warn("⚠  X402_NETWORK=base — this will spend REAL USDC on Base mainnet.\n");
  }

  const signer = toClientEvmSigner(
    {
      address: account.address,
      // Adapter: the simple ClientEvmSigner.signTypedData shape forwards to
      // viem's account.signTypedData (cast at this single boundary).
      signTypedData: (msg) =>
        account.signTypedData(msg as Parameters<typeof account.signTypedData>[0]),
    },
    {
      readContract: (args) => publicClient.readContract(args as never),
    },
  );

  // ---- 3. Wrap fetch so 402s are paid + retried automatically -------------
  const client = new x402Client().register(NETWORK, new ExactEvmScheme(signer));
  const payingFetch = wrapFetchWithPayment(globalThis.fetch, client);

  console.log(`Vouch buyer agent`);
  console.log(`  endpoint : ${vouchUrl}`);
  console.log(`  payer    : ${account.address}`);
  console.log(`  network  : ${NET.label} (${NETWORK})`);
  console.log(`  target   : ${target}\n`);

  // ---- 4. FREE call: submit a community report (no payment) ---------------
  console.log("→ POST /v1/report   (free, no payment)");
  try {
    const reportRes = await fetch(`${vouchUrl}/v1/report`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target, kind: "vouch" }),
    });
    if (reportRes.ok) {
      console.log("  reported:", JSON.stringify(await reportRes.json()));
    } else {
      console.log(`  report skipped (HTTP ${reportRes.status})`);
    }
  } catch (err) {
    console.log("  report skipped (could not reach Vouch):", describe(err));
  }

  // ---- 5. PAID call: the trust check (x402 pays + retries under the hood) --
  console.log(`\n→ POST /v1/check    (paid via x402 → USDC on ${NET.label})`);
  let checkRes: Response;
  try {
    checkRes = await payingFetch(`${vouchUrl}/v1/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target }),
    });
  } catch (err) {
    bail(`Payment/request failed: ${describe(err)}`);
  }

  if (!checkRes.ok) {
    const body = await checkRes.text();
    bail(`Vouch returned HTTP ${checkRes.status}: ${body.slice(0, 300)}`);
  }

  // ---- 6. Pretty-print the trust verdict ----------------------------------
  const result = (await checkRes.json()) as {
    score?: number;
    risk?: string;
    reasons?: string[];
    [k: string]: unknown;
  };

  console.log("\n  Trust verdict for", target);
  console.log("  ─────────────────────────────────────────");
  console.log(`  score : ${result.score ?? "n/a"}`);
  console.log(`  risk  : ${result.risk ?? "n/a"}`);
  if (Array.isArray(result.reasons) && result.reasons.length > 0) {
    console.log("  reasons:");
    for (const reason of result.reasons) console.log(`    • ${reason}`);
  }
  console.log("\n  Full response:");
  console.log(indent(JSON.stringify(result, null, 2)));
  console.log("\n✓ End-to-end paid loop complete.");
}

/** Safely turn an unknown thrown value into a readable string. */
function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Indent a block of text by two spaces for tidy nested output. */
function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

main().catch((err) => {
  console.error("\nUnexpected error:", describe(err));
  process.exit(1);
});
