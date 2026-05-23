# Vouch — Mainnet Cutover Runbook

> ✅ **DONE — the flip already happened (2026-05-22).** Vouch is LIVE on Base mainnet:
> `X402_NETWORK=base` (`eip155:8453`), `PAY_TO_ADDRESS=0xe126002451d0187058cD03719bBCc0bd1CD9c5c9`,
> price `$0.01` USDC. `/v1/check` returns a 402 advertising mainnet USDC. The runbook
> below is kept as the historical procedure (and the rollback path is still valid).

Going to **Base mainnet** is the single biggest distribution lever: it turns
Vouch's discovery into *ranked, paying* traffic and auto-lands it in the Coinbase
x402 Bazaar → Agentic.Market + AWS Bedrock AgentCore (see `DISTRIBUTION.md`).

## What's already done (code is mainnet-ready)
- `X402_NETWORK=base` maps to `eip155:8453`; mainnet USDC (`0x833589fC…2913`) and its
  EIP-712 name (`USD Coin`) are wired in `discovery.ts`.
- **Bazaar discovery auto-activates on mainnet only**: `payments.ts` enables
  `withBazaar(facilitator)` + the route discovery extension when the network is
  `eip155:8453`. On testnet that code path is inert (verified), so the live gate is
  untouched until you flip.
- CDP facilitator auth (the reliable settlement path) is already in place.

## Cost reality (read before flipping)
- **Buyers** pay real USDC per call (your price, `PRICE_CHECK_USDC`).
- **Settlement gas** on Base is fractions of a cent and is paid in the x402 flow,
  not by you holding ETH (EIP-3009 is gasless for the payer; the facilitator broadcasts).
- **You need a Base-mainnet wallet you control** as `PAY_TO_ADDRESS` to *receive* USDC.
  This is now set to the founder's self-custody wallet `0xe126…c5c9` (done at cutover).

## The flip (when you decide)
1. **Set `PAY_TO_ADDRESS`** to a Base-mainnet wallet you control (edit `wrangler.toml`
   `[vars]`, or pass `--var PAY_TO_ADDRESS:0x...`).
2. **Run the guarded script:**
   ```bash
   scripts/go-mainnet.sh        # confirms, then deploys with X402_NETWORK=base
   ```
   To make mainnet the permanent default, set `X402_NETWORK = "base"` in `wrangler.toml`
   and commit.
3. **Verify the 402 advertises mainnet:**
   ```bash
   curl -s -D - -o /dev/null -X POST -H 'content-type: application/json' \
     -d '{"target":"https://stripe.com"}' https://vouch.futuronoti.workers.dev/v1/check
   # HTTP 402; decode the payment-required header -> network eip155:8453, mainnet USDC
   ```
4. **Settle one real payment** (run `examples/buyer.ts` from a mainnet-funded wallet).
   This triggers the CDP facilitator to **catalog Vouch in the Bazaar** (async, ~minutes).
5. **Confirm discovery:**
   - https://agentic.market (search "trust" / "payment risk")
   - `GET https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?query=...`
   - Capture the `EXTENSION-RESPONSES` header on the first settle to confirm cataloging.

## After mainnet
- **Drive distinct payers + recent traffic** (Bazaar ranks on buyer-reach + recency, 6h refresh).
- Publish to the **official MCP registry** (`mcp-publisher`, see LAUNCH.md) — mainnet-independent but worth doing alongside.
- Optional: list on **Agnic** (`scripts/agnic-list.sh`), **Smithery**, **MCPay**.

## Rollback
Re-deploy with `X402_NETWORK=base-sepolia` (or revert `wrangler.toml`) to return to
free testnet. The Bazaar wiring goes inert again automatically.
