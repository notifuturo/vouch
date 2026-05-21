#!/usr/bin/env bash
# Flip Vouch to Base MAINNET (eip155:8453) — REAL USDC settlement.
#
# This is a founder decision: it moves Vouch off free testnet onto real-money
# rails. Read docs/MAINNET.md first. CDP secrets must already be set, and
# PAY_TO_ADDRESS must be a wallet you control on Base mainnet.
#
# This does a per-deploy override (--var). To make mainnet the *permanent*
# default, also set X402_NETWORK = "base" in wrangler.toml and commit it.
set -euo pipefail

cat <<'WARN'
⚠️  About to deploy Vouch on BASE MAINNET (real USDC).
    - Buyers will pay real USDC; settlement happens on-chain via the CDP facilitator.
    - PAY_TO_ADDRESS (0x84877c232FB62CBf2028A97828507428cf82dC1a) must be a wallet
      you control on Base mainnet — change it first if not.
    - Bazaar discovery auto-activates on mainnet (indexes after the first settle).
WARN
read -r -p "Type 'MAINNET' to proceed: " confirm
[ "$confirm" = "MAINNET" ] || { echo "Aborted."; exit 1; }

cd "$(dirname "$0")/.."
npx wrangler deploy --var "X402_NETWORK:base"

cat <<'NEXT'

Deployed on Base mainnet (per-deploy override). Verify:
  curl -s -D - -o /dev/null -X POST -H 'content-type: application/json' \
    -d '{"target":"https://stripe.com"}' https://vouch.futuronoti.workers.dev/v1/check
  # expect HTTP 402; payment-required header should show network eip155:8453 + mainnet USDC

Then settle ONE real payment (examples/buyer.ts with a mainnet-funded wallet) to
trigger Bazaar indexing, and check:
  - https://agentic.market
  - GET https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?query=trust

To make mainnet permanent, set X402_NETWORK = "base" in wrangler.toml and commit.
NEXT
