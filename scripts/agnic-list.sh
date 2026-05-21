#!/usr/bin/env bash
# One-step Agnic merchant activation.
#
# After registering Vouch at https://app.agnic.ai/monetize you receive a
# merchant id (and you choose a USDC payout wallet + margin). This script wires
# those into the live Worker so the X-Merchant-* headers Agnic looks for are
# emitted — no code change, no wrangler.toml edit.
#
# Usage:
#   scripts/agnic-list.sh <MERCHANT_ID> <PAYOUT_WALLET_0x...> <FEE_PERCENT>
# Example:
#   scripts/agnic-list.sh mrc_abc123 0xYourPayoutWallet 2.5
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: $0 <MERCHANT_ID> <PAYOUT_WALLET_0x...> <FEE_PERCENT>" >&2
  exit 1
fi

MERCHANT_ID="$1"
WALLET="$2"
FEE="$3"

if ! printf '%s' "$WALLET" | grep -qiE '^0x[0-9a-f]{40}$'; then
  echo "error: PAYOUT_WALLET must be a 0x-prefixed 40-hex address" >&2
  exit 1
fi

cd "$(dirname "$0")/.."

echo "Deploying Vouch with Agnic merchant headers:"
echo "  X-Merchant-Id          = $MERCHANT_ID"
echo "  X-Merchant-Wallet      = $WALLET"
echo "  X-Merchant-Fee-Percent = $FEE"
echo

# --var overrides set plaintext vars for this deploy (these are public
# identifiers, not secrets). The endpoint emits the headers only when set.
npx wrangler deploy \
  --var "AGNIC_MERCHANT_ID:$MERCHANT_ID" \
  --var "AGNIC_MERCHANT_WALLET:$WALLET" \
  --var "AGNIC_FEE_PERCENT:$FEE"

echo
echo "Done. Verify the headers are live:"
echo "  curl -sI https://vouch.futuronoti.workers.dev/health | grep -i x-merchant"
