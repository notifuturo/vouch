# Vouch — Ready-to-Paste Submissions & Launch Posts

Copy-paste content for the remaining $0 distribution steps. Honest about status:
**LIVE on Base mainnet** (accepts real USDC), open-source (MIT), real MCP server.

> **Status (2026-06-23): first real mainnet settlement is DONE.** A live paid
> `/v1/check` settled 0.01 USDC on Base (eip155:8453) and returned a signed
> attestation — so the paid path, the CDP settle, and on-chain discovery are all
> proven, not theoretical. Every claim below is verified against the live service.

**Canonical facts (reuse everywhere):**
- Name: **Vouch**
- One-liner: *Trust/risk score for AI agents before they pay a counterparty.*
- Live: https://vouch.futuronoti.workers.dev
- MCP server (Streamable HTTP): https://vouch.futuronoti.workers.dev/mcp  ·  registry: `io.github.notifuturo/vouch`
- Repo: https://github.com/notifuturo/vouch (MIT)
- Free: `vouch_score` MCP tool · `POST /v1/score` → `{score, risk}`
- Paid (x402, **$0.01 USDC on Base mainnet**): `POST /v1/check` → `{score, risk, reasons, signals}` **+ a signed Ed25519 attestation** the agent can keep as verifiable proof it checked before paying
- Verify attestations: `GET /v1/attestation/pubkey` (Ed25519 JWK; `x=iFNi9BZ5vVHTvZgX0cq4xKsbNGyZnr3o1i6Dkv7utyE`)
- Discovery: https://vouch.futuronoti.workers.dev/.well-known/x402
- Trust signals: free threat feeds (URLhaus), domain heuristics, transport, and a
  community reputation graph with **reporter-standing weighting** (fresh/anonymous
  reporters carry fractional weight → sybil poisoning is costly)
- Tags: `x402` `ai-agents` `agent-payments` `trust` `fraud` `mcp`

**Live proof points (safe to cite — all from the deployed service):**
- `POST /v1/score {"target":"https://example.com"}` → `{"score":91,"risk":"low"}`
- Paid `/v1/check` returns the same plus ordered `reasons`, weighted `signals`, and an
  `attestation` JWT (alg EdDSA) verifiable against the pubkey above.
- `GET /.well-known/x402` → 200; `POST /mcp` (JSON-RPC `tools/list`) lists `vouch_score` + `vouch_report`.

---

## 1. MCPay (mcpay.tech) — paid-tool registry (accepts MCP + plain HTTP)
Submit at mcpay.tech (registry submission / GitHub). Map these fields:
```
Name:          Vouch
Description:   Trust/risk score for AI agents before they pay. Free score via MCP; paid x402 for explainable reasons + a signed attestation.
MCP server:    https://vouch.futuronoti.workers.dev/mcp   (Streamable HTTP)
Paid resource: POST https://vouch.futuronoti.workers.dev/v1/check  — $0.01 USDC, x402 (Base mainnet, eip155:8453)
Free tools:    vouch_score, vouch_report
Repo:          https://github.com/notifuturo/vouch
Input:         { "target": "https://some-merchant.com" }
Output:        { "score": 0-100, "risk": "low|medium|high|critical", "reasons": [...], "attestation": "<signed JWT>" }
Tags:          trust, risk, fraud, x402, ai-agents, mcp
```

## 2. Smithery (smithery.ai) — MCP server directory
Add a **remote** server (we expose Streamable HTTP, which Smithery requires):
```
Server URL:   https://vouch.futuronoti.workers.dev/mcp
Name:         Vouch
Description:  Trust/risk score for AI agents before they pay. Free vouch_score + vouch_report tools; paid x402 /v1/check for full reasons + a signed attestation.
Repo:         https://github.com/notifuturo/vouch
```
Steps: smithery.ai → "Add Server" / Deploy → provide the remote URL (needs a free
Smithery account/API key). It can also auto-ingest from the official MCP registry.

## 3. mcp.so — lightweight directory
Use the **Submit** button (or open a GitHub issue). Same name/description/URL/repo.

## 4. x402scan (x402scan.com / Merit-Systems) — auto-indexes on on-chain activity
**No manual submit — and the trigger condition is now MET.** The first mainnet
payment settled on-chain on **2026-06-23** (0.01 USDC → payout `0xe126…c5c9`,
payer `0x79fF…0a2E`), which is exactly what x402scan keys off. **Action: just
monitor** — search "Vouch" / the payTo address `0xe126002451d0187058cD03719bBCc0bd1CD9c5c9`
on x402scan.com over the next hours/days and confirm the listing populates. No copy needed.

## 5. Agnic (app.agnic.ai/monetize) — agent monetization listing
Create/sign in under **futuronoti@gmail.com**, list Vouch as a monetized agent API,
then set the returned vars as Worker secrets/vars and redeploy:
```
AGNIC_MERCHANT_ID=<from Agnic>
AGNIC_MERCHANT_WALLET=<your USDC payout wallet>
AGNIC_FEE_PERCENT=<your margin, e.g. 0>
```
(The app already emits `X-Merchant-*` headers when these are set — see src/index.ts.)
```
Name:          Vouch
Category:      Trust / fraud / risk
Description:   Per-call payment-trust API for AI agents. Returns a 0-100 trust score, risk band, explainable reasons, and a signed attestation before an agent pays a counterparty.
Endpoint:      POST https://vouch.futuronoti.workers.dev/v1/check  ($0.01 USDC, x402, Base mainnet)
Free tier:     POST /v1/score  ·  MCP: https://vouch.futuronoti.workers.dev/mcp
Repo:          https://github.com/notifuturo/vouch
```

---

## Community launch posts

### X / Twitter (≤280)
```
Built Vouch: a trust/risk score for AI agents *before* they pay a counterparty.

• Free vouch_score MCP tool
• Paid x402 endpoint → full reasons + a signed attestation you can keep as proof

Live on Base mainnet (first payment just settled), open-source, in the MCP registry.
https://vouch.futuronoti.workers.dev
#x402 #agenticcommerce
```

### Telegram (x402 builders) / Coinbase Developer Platform Discord
```
Hey all — built **Vouch**, a payment-trust API for AI agents on x402.

Given a counterparty (URL/host), it returns a 0-100 trust score + risk band so an
agent can decide whether it's safe to pay — before spending money/compute.

• Free: `vouch_score` MCP tool + `POST /v1/score` → { score, risk }
• Paid (x402, $0.01 USDC on Base mainnet): `POST /v1/check` → full explainable
  reasons + signals + a signed Ed25519 attestation (verifiable proof it checked)
• Real MCP server (Streamable HTTP) at /mcp, listed in the official MCP registry
• Open-source (MIT). Live on Base mainnet — first real payment just settled on-chain.

Live: https://vouch.futuronoti.workers.dev
Repo: https://github.com/notifuturo/vouch

Would genuinely love feedback from x402 folks — especially on the trust signals
(threat feeds, domain heuristics, a community reputation graph with sybil-resistant
reporter weighting). What signals would make you trust an agent payment-gate?
```

### r/x402
**Title:** `Vouch — a free/paid trust score for x402 agent payments (open-source, MCP server)`
```
I built Vouch: before an AI agent pays a counterparty, it can call Vouch to get a
0-100 trust score + risk band + the reasons.

- Free vouch_score (MCP tool + POST /v1/score)
- Paid POST /v1/check via x402 ($0.01 USDC, Base mainnet) for the explainable
  reasons + signals + a signed Ed25519 attestation (proof of due diligence)
- Real MCP Streamable-HTTP server, in the official MCP registry (io.github.notifuturo/vouch)
- Signals: free threat feeds (URLhaus), domain heuristics, and a community reputation
  graph with reporter-standing weighting (sybil/poisoning resistance)
- Open-source (MIT), on Cloudflare Workers. Live on Base mainnet — first payment settled.

Live: https://vouch.futuronoti.workers.dev · Repo: https://github.com/notifuturo/vouch

Feedback welcome — what would make this trustworthy enough to gate a real payment?
```

> Tone is builder-to-builder and honest (asking for feedback) — not salesy.
> Edit freely to your voice before posting under `notifuturo`.
