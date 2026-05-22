# Vouch — Ready-to-Paste Submissions & Launch Posts

Copy-paste content for the remaining $0 distribution steps. Honest about status:
**live on Base Sepolia (testnet)**, open-source (MIT), real MCP server.

**Canonical facts (reuse everywhere):**
- Name: **Vouch**
- One-liner: *Trust/risk score for AI agents before they pay a counterparty.*
- Live: https://vouch.futuronoti.workers.dev
- MCP server (Streamable HTTP): https://vouch.futuronoti.workers.dev/mcp  ·  registry: `io.github.notifuturo/vouch`
- Repo: https://github.com/notifuturo/vouch (MIT)
- Free: `vouch_score` MCP tool · `POST /v1/score` → `{score, risk}`
- Paid (x402, $0.01 USDC): `POST /v1/check` → `{score, risk, reasons, signals}`
- Discovery: https://vouch.futuronoti.workers.dev/.well-known/x402
- Tags: `x402` `ai-agents` `agent-payments` `trust` `fraud` `mcp`

---

## 1. MCPay (mcpay.tech) — paid-tool registry (accepts MCP + plain HTTP)
Submit at mcpay.tech (registry submission / GitHub). Map these fields:
```
Name:         Vouch
Description:  Trust/risk score for AI agents before they pay. Free score via MCP; paid x402 for explainable reasons.
MCP server:   https://vouch.futuronoti.workers.dev/mcp   (Streamable HTTP)
Paid resource: POST https://vouch.futuronoti.workers.dev/v1/check  — $0.01 USDC, x402 (Base Sepolia)
Free tools:   vouch_score, vouch_report
Repo:         https://github.com/notifuturo/vouch
Input:        { "target": "https://some-merchant.com" }
Output:       { "score": 0-100, "risk": "low|medium|high|critical", "reasons": [...] }
Tags:         trust, risk, fraud, x402, ai-agents, mcp
```

## 2. Smithery (smithery.ai) — MCP server directory
Add a **remote** server (we expose Streamable HTTP, which Smithery requires):
```
Server URL:   https://vouch.futuronoti.workers.dev/mcp
Name:         Vouch
Description:  Trust/risk score for AI agents before they pay. Free vouch_score + vouch_report tools; paid x402 /v1/check for full reasons.
Repo:         https://github.com/notifuturo/vouch
```
Steps: smithery.ai → "Add Server" / Deploy → provide the remote URL (needs a free
Smithery account/API key). It can also auto-ingest from the official MCP registry.

## 3. mcp.so — lightweight directory
Use the **Submit** button (or open a GitHub issue). Same name/description/URL/repo.

## 4. x402scan (x402scan.com / Merit-Systems) — auto-indexes on on-chain activity
No manual submit needed; appears once Vouch settles on-chain (mainnet). Track it there post-launch.

---

## Community launch posts

### X / Twitter (≤280)
```
Built Vouch: a trust/risk score for AI agents *before* they pay a counterparty.

• Free vouch_score MCP tool
• Paid x402 endpoint for the full explainable reasons

Live (Base Sepolia), open-source, in the MCP registry.
https://vouch.futuronoti.workers.dev
#x402 #agenticcommerce
```

### Telegram (x402 builders) / Coinbase Developer Platform Discord
```
Hey all — built **Vouch**, a payment-trust API for AI agents on x402.

Given a counterparty (URL/host), it returns a 0-100 trust score + risk band so an
agent can decide whether it's safe to pay — before spending money/compute.

• Free: `vouch_score` MCP tool + `POST /v1/score` → { score, risk }
• Paid (x402, $0.01 USDC): `POST /v1/check` → full explainable reasons + signals
• Real MCP server (Streamable HTTP) at /mcp, listed in the official MCP registry
• Open-source (MIT). Live on Base Sepolia (testnet) for now.

Live: https://vouch.futuronoti.workers.dev
Repo: https://github.com/notifuturo/vouch

Would genuinely love feedback from x402 folks — especially on the trust signals
(threat feeds, domain heuristics, a community reputation graph). What signals would
make you trust an agent payment-gate?
```

### r/x402
**Title:** `Vouch — a free/paid trust score for x402 agent payments (open-source, MCP server)`
```
I built Vouch: before an AI agent pays a counterparty, it can call Vouch to get a
0-100 trust score + risk band + the reasons.

- Free vouch_score (MCP tool + POST /v1/score)
- Paid POST /v1/check via x402 ($0.01 USDC) for the explainable reasons + signals
- Real MCP Streamable-HTTP server, in the official MCP registry (io.github.notifuturo/vouch)
- Signals: free threat feeds (URLhaus), domain heuristics, and a community reputation
  graph (with poisoning resistance)
- Open-source (MIT), on Cloudflare Workers. Base Sepolia testnet for now.

Live: https://vouch.futuronoti.workers.dev · Repo: https://github.com/notifuturo/vouch

Feedback welcome — what would make this trustworthy enough to gate a real payment?
```

> Tone is builder-to-builder and honest (testnet, asking for feedback) — not salesy.
> Edit freely to your voice before posting under `notifuturo`.
