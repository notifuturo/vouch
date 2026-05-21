# Vouch buyer agent (x402 example)

A tiny, runnable agent that calls Vouch's **paid** `/v1/check` endpoint and pays
for it automatically over [x402](https://x402.org) — proving the full
*ask → 402 → pay USDC → retry → verdict* loop. It also makes a **free**
`/v1/report` call for contrast.

This is what an autonomous agent does before paying a counterparty: it asks
Vouch *"is this safe to pay?"* and gets back a trust score.

## How it works

```
buyer.ts ──POST /v1/report──▶ Vouch          (free, no payment)
buyer.ts ──POST /v1/check ──▶ Vouch  ──402──▶ pay USDC ──retry──▶ { score, risk, reasons }
                              (wrapFetchWithPayment handles the 402 → pay → retry)
```

The x402 plumbing is three lines:

```ts
const client = new x402Client().register("eip155:84532", new ExactEvmScheme(signer));
const payingFetch = wrapFetchWithPayment(globalThis.fetch, client);
const res = await payingFetch(`${VOUCH_URL}/v1/check`, { method: "POST", ... });
```

## Prerequisites (Base Sepolia testnet)

1. **A throwaway testnet wallet.** Create one and export its private key. Only
   ever use a testnet key here — never a key with real funds.
2. **Testnet USDC.** Fund the wallet from the Circle faucet (select **Base
   Sepolia**): https://faucet.circle.com
   You'll also want a little Base Sepolia ETH for any on-chain step:
   https://www.alchemy.com/faucets/base-sepolia
3. **A running Vouch instance.** From the repo root:
   ```bash
   cp .dev.vars.example .dev.vars   # set PAY_TO_ADDRESS to your testnet wallet
   npm run dev                      # serves on http://localhost:8787
   ```

Dependencies (`@x402/fetch`, `@x402/evm`, `viem`) are already installed in this
repo — no `npm install` needed.

## Run it

```bash
PRIVATE_KEY=0xYOUR_BASE_SEPOLIA_TESTNET_KEY \
VOUCH_URL=http://localhost:8787 \
npx tsx examples/buyer.ts https://some-merchant.com
```

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `PRIVATE_KEY` | yes | — | Base Sepolia **testnet** key (`0x`-prefixed; `0x` added if omitted). |
| `VOUCH_URL` | no | `http://localhost:8787` | Your Vouch endpoint (wrangler dev, or a deployed Worker). |
| CLI arg `[target]` | no | `https://some-merchant.com` | The counterparty to assess. |

## Expected output

```
Vouch buyer agent
  endpoint : http://localhost:8787
  payer    : 0xabc...123
  network  : Base Sepolia (eip155:84532)
  target   : https://some-merchant.com

→ POST /v1/report   (free, no payment)
  reported: {"ok":true}

→ POST /v1/check    (paid via x402 → USDC on Base Sepolia)

  Trust verdict for https://some-merchant.com
  ─────────────────────────────────────────
  score : 82
  risk  : low
  reasons:
    • valid HTTPS transport
    • no threat-feed hits

  Full response:
  { "score": 82, "risk": "low", "reasons": [ ... ] }

✓ End-to-end paid loop complete.
```

## Troubleshooting

- **"Missing PRIVATE_KEY"** — set the env var to a testnet key (see Prerequisites).
- **`could not reach Vouch`** — start `npm run dev`, or point `VOUCH_URL` at your
  deployed Worker.
- **Payment fails / insufficient funds** — fund the payer wallet with Base
  Sepolia testnet USDC from the Circle faucet.
- **402 keeps repeating** — confirm Vouch is configured for the same network
  (`X402_NETWORK` → Base Sepolia) and that `PAY_TO_ADDRESS` is set.

## Going to mainnet

Flip Vouch's `X402_NETWORK` to `base`, change `NETWORK` in `buyer.ts` to
`eip155:8453`, and fund the payer wallet with real USDC on Base. Everything else
stays the same.
