# Vouch — Distribution Playbook

Live: **https://vouch.futuronoti.workers.dev** · Repo: *(make public before submitting links)*

How the x402 economy actually does discovery (from research):
- The canonical discovery layer is the **Bazaar** — a *facilitator-side index* populated
  by **live settled payments**, not by crawling a `.well-known` file.
- **Coinbase Agentic.Market** (https://agentic.market) auto-indexes services from real
  payment activity — no submission form, but it ranks by calls/unique-payers/volume.
- Therefore **testnet traffic is largely invisible** to these. The growth unlock is
  mainnet + settling via a bazaar-aware facilitator (see §4 — a real-money decision).

Ranked by effort-vs-payoff for a $0 / testnet stage:

---

## 1. awesome-x402 PRs — quickest win (needs: GitHub account + PR)

Two active curated lists. Fork → add one line → open PR.

**Repo A — https://github.com/Merit-Systems/awesome-x402** (section: *Ecosystem* or *Example Apps*)
**Repo B — https://github.com/xpaysh/awesome-x402** (section: *Production Implementations* or *AI Agent Integration*; see its CONTRIBUTING.md)

Ready-to-paste entry:

```
[Vouch](https://vouch.futuronoti.workers.dev) - Counterparty trust/risk scoring for x402 payments. Returns an explainable 0-100 score, risk band, and reasons. $0.001 USDC via x402, POST /v1/check. ([/.well-known/x402](https://vouch.futuronoti.workers.dev/.well-known/x402)) ([MCP tools](https://vouch.futuronoti.workers.dev/mcp/tools))
```

---

## 2. Agnic registry — self-serve dashboard (needs: Agnic account + payout wallet)

Agnic does **not** crawl us; listing is manual at the dashboard.

1. Create account at **https://app.agnic.ai** using **futuronoti@gmail.com** (the
   project's single canonical identity — same as Cloudflare/GitHub/CDP). Do *not*
   use a different email here; keeping one identity avoids the fragmentation pain.
   Email sign-in auto-provisions a wallet.
2. Connect/note a **USDC payout wallet** address.
3. Go to **https://app.agnic.ai/monetize** → "Register your API".
4. Submit:
   - **Name:** Vouch
   - **Endpoint:** `https://vouch.futuronoti.workers.dev/v1/check`
   - **Description:** x402-monetized payment-trust score for a counterparty — explainable 0-100 risk score.
   - **Price:** per-call (start ~$0.001–$0.01 USDC)
   - **Category / IO schema:** as the form requests (input `{ target: string }` → output `{ score, risk, reasons }`)
5. Capture your assigned **`X-Merchant-Id`** and set **`X-Merchant-Fee-Percent`** (your margin).
   Then set these as Worker vars and redeploy — the code already emits the three
   `X-Merchant-*` headers when present:
   ```
   wrangler secret put AGNIC_MERCHANT_ID      # or add to [vars]
   # AGNIC_MERCHANT_WALLET = <payout wallet>
   # AGNIC_FEE_PERCENT = <your margin>
   ```
6. Verify Vouch appears in Service Discovery (https://app.agnic.ai/discover).

**Copy-paste values for the registration form:**
```
Name:        Vouch
Endpoint:    https://vouch.futuronoti.workers.dev/v1/check
Method:      POST
Price:       0.001 USDC per call   (raise later as you like)
Category:    Trust / Verification / Security
Description: x402-monetized payment-trust API. Given a counterparty (URL/host),
             returns an explainable 0-100 trust score, a risk band, and reasons —
             so an agent can decide whether it's safe to pay.
Input:       { "target": "https://some-merchant.com" }
Output:      { "score": 87, "risk": "low", "reasons": ["..."] }
Discovery:   https://vouch.futuronoti.workers.dev/.well-known/x402
```

**Then activate the merchant headers in one step** (no code/redeploy fuss):
```
scripts/agnic-list.sh <MERCHANT_ID> <PAYOUT_WALLET_0x...> <FEE_PERCENT>
```

Notes: Agnic takes a **flat 5% commission**; KYC/payout cadence are behind the dashboard
login — confirm there or via the contact form at https://www.agnic.ai/contact
(topic "Global Partnership").

---

## 3. Spec compliance (done in code — no human needed)

- `GET /.well-known/x402` aligned to the **canonical v2 resource/`accepts` schema**
  (`x402Version: 2`, `maxAmountRequired` in USDC base units, `outputSchema` with the
  `target` body schema + an output example). Courtesy/correctness signal for crawlers.
- `/mcp/tools` static manifest published for MCP-aware agents.

---

## 4. The growth unlock — Base mainnet (DECISION REQUIRED: real money)

To land in the **Bazaar + Agentic.Market** (where agents actually shop) we must settle
**real payments** through a bazaar-aware facilitator on **Base mainnet**:

- Switch `X402_NETWORK` → `base` (`eip155:8453`); USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`;
  `extra.name` → `"USD Coin"` (mainnet EIP-712 name — testnet uses `"USDC"`).
- Settle via the **Coinbase CDP / bazaar-aware facilitator** (needs CDP API keys) instead of
  the testnet reference facilitator; capture the `EXTENSION-RESPONSES` header on first
  settle to confirm cataloging.
- Implication: this conflicts with the strict-$0 stance (gas + a funded wallet + real USDC).
  **This is a founder decision, not an autonomous change.** Everything else above works at $0.
- **Bonus — also fixes a reliability issue:** on testnet, `POST /v1/check` intermittently
  hangs (~35s) on a *cold* Cloudflare isolate because the x402 middleware must call the
  public testnet facilitator's `/supported` to build the 402, and `x402.org/facilitator`
  is flaky (warm isolates return 402 in ~1s; `/health` is always fast). A reliable
  bazaar-aware facilitator (CDP) removes this. Not fixable at our layer (disabling the
  startup sync makes the 402 build fail with 500 — the supported list is genuinely required).

---

## 5. Secondary / future

- **PayAI facilitator** directory (`facilitator.payai.network/discovery/resources`) — settle via PayAI to appear.
- **Official MCP Registry** (https://registry.modelcontextprotocol.io) — requires a *real* MCP
  server (streamable-HTTP transport), which Vouch doesn't expose yet (we ship a static manifest).
  Future work: stand up an actual MCP transport endpoint, then publish via the `mcp-publisher` CLI.

---

## Human checklist (the parts an agent can't do)

- [ ] Make the GitHub repo public.
- [ ] Open awesome-x402 PRs (both repos) with the entry in §1.
- [ ] Create Agnic account + payout wallet; register Vouch (§2); set `AGNIC_*` vars; redeploy.
- [ ] Fund a Base Sepolia buyer wallet (Circle faucet) and run `examples/buyer.ts` against the
      live URL to prove an end-to-end paid call.
- [ ] Decide on the mainnet move (§4) when ready to handle real money.
