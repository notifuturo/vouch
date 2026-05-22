# Vouch — $0 Launch Checklist

Everything to launch and start earning costs **$0 upfront**. Do the phases in
order. Each step notes the exact command/click, the cost, and what it unlocks.

Legend: 💲0 = free · 🔑 = needs your GitHub/wallet · ⏱️ = ~minutes

---

## 📍 STATUS (resume here) — updated 2026-05-22
- ✅ **LIVE ON BASE MAINNET** — https://vouch.futuronoti.workers.dev · pays to your wallet `0xe126002451d0187058cD03719bBCc0bd1CD9c5c9` · `/v1/check` returns 402 on `eip155:8453` with mainnet USDC. **Vouch can receive real USDC now.**
- ✅ Published to the official **MCP registry** (`io.github.notifuturo/vouch`) → auto-fans-out to PulseMCP/Glama over the coming days.
- ✅ awesome-x402 PRs open (#252, #414).
- 👉 **NEXT ACTION = Phase 2 below: trigger the FIRST settled payment.** This both (a) proves real mainnet settlement end-to-end and (b) gets Vouch indexed/ranked in the Coinbase Bazaar → Agentic.Market + AWS Bedrock (the no-audience discovery channel). Until this happens, you're listed but not yet *ranked* where agents shop.
- ⚠️ **#1 RELIABILITY FIX (before driving real traffic):** cold Cloudflare isolates time out on the *first* `/v1/check` (the CDP `getSupported` fetch hangs ~40s); warm isolates return `402` in ~0.2s. A real agent's first call could time out. **Fix:** cache `getSupported` in Cloudflare KV (a `CachedFacilitatorClient` wrapper) so cold isolates skip the CDP round-trip. Focused payment-path task for next session.
- 🔒 **Do now:** back up your Coinbase Wallet 12-word recovery phrase offline (Settings → Recovery Phrase). It's your money — Coinbase can't recover it.
- Optional/anytime: list on MCPay/Smithery/mcp.so (free, paste-ready in `SUBMISSIONS.md`); Agnic (`scripts/agnic-list.sh`).
- Rollback if ever needed: set `X402_NETWORK = "base-sepolia"` in `wrangler.toml` and deploy.

---

## Phase 0 — Free discovery (no wallet, no mainnet) — do today
*Makes Vouch a discoverable free tool (`vouch_score`) so agents start using it and
the reputation data compounds — before any money is involved.*

- [x] **Repo is public** — https://github.com/notifuturo/vouch ✅
- [x] **Published to the official MCP registry** ✅ `io.github.notifuturo/vouch` v0.1.0 — live & searchable. → fans out to PulseMCP, Glama. Mainnet-independent.
  ```bash
  # mcp-publisher is a binary (NOT npm). To re-publish after edits to server.json:
  gh release download v1.7.9 -R modelcontextprotocol/registry -p "mcp-publisher_linux_amd64.tar.gz" && tar xzf mcp-publisher_linux_amd64.tar.gz
  ./mcp-publisher login github     # device-flow: visit github.com/login/device, enter code (as notifuturo)
  ./mcp-publisher publish          # reads ./server.json (description must be <=100 chars)
  ```
- [ ] **awesome-x402 PRs** — already open: [Merit #252](https://github.com/Merit-Systems/awesome-x402/pull/252), [xpaysh #414](https://github.com/xpaysh/awesome-x402/pull/414). Reply to reviewers if needed. 💲0
- [ ] **List on MCPay** (accepts our paid HTTP endpoint + MCP) — mcpay.tech submit. 💲0
- [ ] **Submit to Smithery** (smithery.ai) + **mcp.so** — we now expose a real MCP endpoint. 💲0
- [ ] **One community post** — share the live demo (free `/v1/score` + `/mcp`) in the
  x402 Telegram / Coinbase Developer Platform Discord / r/x402, tagging #x402. 💲0

> After Phase 0, agents can discover + call Vouch for free. That's real traction at $0.

---

## Phase 1 — Go to mainnet (real revenue) — when ready
*You RECEIVE USDC here; you don't spend. Hosting + gas are free (facilitator-sponsored;
first 1,000 settles/month free).*

- [ ] **Create a free self-custody wallet** 💲0 🔑 ⏱️ — **Coinbase Wallet / Base App**
  (best Base+USDC fit). Copy its **Base address**. **Write the seed phrase down offline.**
  *(Do NOT reuse the testnet key from chat.)*
- [ ] **Set the payout address** — in `wrangler.toml` `[vars]` set
  `PAY_TO_ADDRESS = "0xYourNewWallet"` (or pass `--var`).
- [ ] **Flip to mainnet** 💲0
  ```bash
  scripts/go-mainnet.sh        # confirms, deploys with X402_NETWORK=base
  ```
  (To make it permanent, set `X402_NETWORK = "base"` in `wrangler.toml` and commit.)
- [ ] **Verify** the live 402 advertises mainnet:
  ```bash
  curl -s -D - -o /dev/null -X POST -H 'content-type: application/json' \
    -d '{"target":"https://stripe.com"}' https://vouch.futuronoti.workers.dev/v1/check
  # HTTP 402; payment-required header decodes to network eip155:8453 + mainnet USDC
  ```

---

## Phase 2 — Get indexed in the Bazaar (the big unlock)
*Bazaar/Agentic.Market/AWS Bedrock index after the first SETTLED mainnet payment.*

- [ ] **Trigger the first settle** — either:
  - **(a) Self-bootstrap (~$1, mostly returns to you):** money moves between *your own* wallets, so net cost ≈ $0 + a small onramp fee. Steps:
    1. **Generate a throwaway BUYER wallet** (its key never needs to leave the box):
       `node --input-type=module -e 'import {generatePrivateKey,privateKeyToAccount} from "viem/accounts";import {writeFileSync} from "node:fs";const pk=generatePrivateKey();writeFileSync("/tmp/vouch_buyer_key",pk,{mode:0o600});console.log(privateKeyToAccount(pk).address)'`
    2. **Fund that buyer address with ~$1 USDC *on Base*** from your own wallet:
       - *MetaMask:* switch network to **Base** → confirm you hold **USDC on Base + a little Base ETH for gas** (swap a bit if not) → **Send** USDC to the buyer address. (Funds only on Ethereum L1? Don't bridge a few $ — use Coinbase Wallet "Buy USDC on Base" instead.)
       - *Coinbase Wallet:* **Buy → USDC** (ensure **Base**) → **Send** ~$1 to the buyer address.
       - Note: the *funding send* needs sender gas (Base ETH, a few cents); the *Vouch payment itself is gasless* (facilitator covers it), so the buyer needs only USDC.
    3. **Run the paid call** (pays $0.01 USDC → your PAY_TO wallet):
       `PRIVATE_KEY=$(cat /tmp/vouch_buyer_key) VOUCH_URL=https://vouch.futuronoti.workers.dev npx tsx examples/buyer.ts https://stripe.com`
    4. (Optional) sweep the leftover USDC from the buyer wallet back to your main wallet.
  - **(b) Or wait for the first organic buyer** from the Phase 0 channels (no spend).
- [ ] **Confirm discovery**: https://agentic.market (search "trust"/"payment risk") and
  `GET https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?query=trust`.

---

## Phase 3 — Amplify (free)
- [ ] **Drive distinct payers + recent traffic** (Bazaar ranks on buyer-reach + recency; 6h refresh).
- [ ] **List on Agnic** (under futuronoti@gmail.com): `scripts/agnic-list.sh <id> <wallet> <fee>`. 💲0
- [ ] **Content**: the "agent about to pay a scam → Vouch blocks it" demo video; cross-post. 💲0
- [ ] **Product Hunt** launch (AI Agents / Crypto Tools). 💲0

---

## Treasury — only once you're earning
- [ ] When balances are meaningful, **sweep** from the hot receiving wallet to a vault:
  a **Ledger** (~$79, paid *from revenue*) or a free **Safe** multisig. Never leave a
  large balance on a hot key.

---

## Cost summary
| Item | Cost |
|------|------|
| Phases 0, 1, 3 (launch + earn) | **$0** |
| First-settle bootstrap (Phase 2a) | optional ~$0.05 USDC (or skip via 2b) |
| Ledger vault | optional ~$79, only after you're earning |

**Bottom line: you can launch Vouch and start receiving USDC with internet + laptop + $0.**
