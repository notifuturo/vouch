# Vouch

[![CI](https://github.com/notifuturo/vouch/actions/workflows/ci.yml/badge.svg)](https://github.com/notifuturo/vouch/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e.svg)](./LICENSE)
[![x402](https://img.shields.io/badge/pay-x402%20·%20USDC-5eead4.svg)](https://x402.org)
[![Cloudflare Workers](https://img.shields.io/badge/runs%20on-Cloudflare%20Workers-f38020.svg)](https://workers.cloudflare.com)
[![Live](https://img.shields.io/badge/demo-vouch.futuronoti.workers.dev-2563eb.svg)](https://vouch.futuronoti.workers.dev)

**A per-call payment trust & reputation API for AI agents — monetized over [x402](https://x402.org).**

When an autonomous agent is about to pay a merchant, API, or counterparty, it
asks Vouch one question first: *is this safe to pay?* Vouch returns an
explainable trust score, and charges a fraction of a cent per call in USDC — no
accounts, no API keys, no Stripe. Billing is the x402 protocol itself.

## Why

The agentic-commerce rails (Coinbase x402, AWS, Visa, Mastercard, Agnic) are
being built by giants. The **governance layer** — *should this agent trust this
counterparty with money?* — is the named #1 blocker to autonomous spend and is
wide open. Vouch is a thin, self-serve pick-and-shovel on top of those rails.

Every call makes the product better: checks and community reports accrete into a
reputation dataset that compounds with usage — the moat a bootstrapped team can
actually build.

## How it works

```
agent ──POST /v1/check { target }──▶  x402 paywall (402 → pay USDC → retry)
                                          │
                                          ▼
                          ┌─────────── scoring engine ───────────┐
                          │ transport · domain heuristics ·       │
                          │ threat feed · reputation (D1)         │
                          └───────────────────────────────────────┘
                                          │
                            { score, risk, reasons[] }
```

Scoring is a weighted average of independent **signals**, with a safety
override: any single hard-negative signal (e.g. a threat-feed hit) caps the
overall score so one strong red flag can't be averaged away.

| Signal | Weight | Source |
|--------|--------|--------|
| `threat_feed` | 3 | [URLhaus](https://urlhaus.abuse.ch/) host list (`THREAT_FEED_URL`), cached, fails open |
| `reputation` | 2 | Vouch's own accumulating D1 data (the moat) |
| `transport` | 1.5 | HTTPS / valid host |
| `domain_heuristics` | 1 | Punycode, raw IPs, abuse-prone TLDs, etc. |

## Use it from your agent

Vouch is a real MCP server, an x402-paid HTTP API, and a tiny SDK — pick whichever
fits your stack. Nothing needs an account or API key.

### MCP (free tools, works in any MCP client)

Point your client at the Streamable-HTTP endpoint — it exposes `vouch_score` and
`vouch_report`, and ships model-facing `instructions` so the agent knows to check a
counterparty **before** it pays:

```jsonc
{
  "mcpServers": {
    "vouch": { "type": "streamable-http", "url": "https://vouch.futuronoti.workers.dev/mcp" }
  }
}
```

For clients that only speak stdio, bridge it with `npx mcp-remote https://vouch.futuronoti.workers.dev/mcp`.
Vouch is also listed in the [official MCP registry](https://registry.modelcontextprotocol.io)
as `io.github.notifuturo/vouch`.

### Free HTTP (curl)

```bash
curl -s https://vouch.futuronoti.workers.dev/v1/score \
  -H 'content-type: application/json' -d '{"target":"https://some-merchant.com"}'
# → {"target":"...","host":"some-merchant.com","score":91,"risk":"low"}
```

### Gate a payment with the SDK (one line)

```ts
import { assertTrusted } from "vouch-sdk";

await assertTrusted("https://some-merchant.com", { minScore: 75 }); // free; throws if risky
await payTheMerchant();
```

The paid `POST /v1/check` adds the explainable `reasons`, weighted `signals`, and a
signed Ed25519 **attestation** (keep it as proof of due diligence). See
[`examples/buyer.ts`](./examples/buyer.ts) for the full x402 pay-and-retry loop and
[`sdk/`](./sdk) for the client.

## Endpoints

| Method & path | Cost | Description |
|---------------|------|-------------|
| `POST /v1/check` | x402 (USDC) | Full verdict → `{ score, risk, reasons, signals, attestation }` (signed Ed25519 receipt) |
| `POST /v1/score` | free (rate-limited) | Score + risk only → `{ score, risk }`. Pay `/v1/check` for the *reasons* |
| `GET /v1/attestation/pubkey` | free | Ed25519 public key (JWK) to verify a `/v1/check` attestation |
| `POST /v1/report` | free | Submit a `flag` or `vouch` for a host |
| `GET /v1/stats` | free | Aggregate reputation totals (hosts, checks, flags, vouches) |
| `POST /mcp` | free | MCP Streamable-HTTP server (`vouch_score`, `vouch_report` tools) |
| `GET /health` | free | Liveness |
| `GET /` | free | Service info (HTML landing for browsers) |

CORS is open (`*`) and the x402 payment headers are exposed, so browser-hosted
agents can preflight and complete the pay/retry flow.

### Reading `/v1/report` (abuse model)

`POST /v1/report` is **free and unauthenticated by design** — anyone can submit a
`flag` or `vouch` for a host, so the raw `flags`/`vouches` counts are *community
signals, not ground truth*. Abuse is contained by:

- **Rate limiting** — 10 reports per 60s per client IP (Cloudflare Rate Limiting, fails closed).
- **Reporter-standing weighting** — each counted report contributes a *weighted* amount
  (not a flat +1) based on the reporting source's tenure: a brand-new or anonymous source
  counts at `0.3`, ramping to `1.0` only after ~7 days of sustained reporting. The scoring
  signal uses these weighted totals, so spinning up fresh sybil identities buys far less
  influence. A source can also move a given host's counter at most once per 24h (per-source
  de-dup); raw counts are still logged for audit.
- **Poisoning resistance in scoring** — community `reputation` is a *non-authoritative*
  signal: it can lower a score but **cannot, on its own, force a `critical` verdict**.
  Only objective signals (threat feeds, transport) can hard-cap the score. So a burst
  of anonymous flags can't unilaterally brand a legitimate counterparty as unsafe.
- **Bounded input** — `target`/`reason`/`reporter` are length-capped before storage.

Treat `/v1/stats` and report counts as a crowd-sourced prior that *informs* the paid
verdict, not as an authoritative blocklist.

## Stack ($0 to run)

TypeScript · [Hono](https://hono.dev) · Cloudflare Workers (free tier) ·
D1 (free SQLite) · `@x402/*` v2 · public facilitator at `x402.org/facilitator`.

**Live on Base mainnet** (`X402_NETWORK=base`, real USDC, `$0.01`/call). For local
development, set `X402_NETWORK=base-sepolia` and fund a throwaway wallet from the
free [Circle faucet](https://faucet.circle.com). The live network and price are
authoritatively advertised at [`/.well-known/x402`](https://vouch.futuronoti.workers.dev/.well-known/x402).

## Develop

```bash
npm install
npm run typecheck
npm test

cp .dev.vars.example .dev.vars   # set PAY_TO_ADDRESS (your testnet wallet)
wrangler d1 create vouch         # paste database_id into wrangler.toml
npm run db:init                  # apply schema locally
npm run dev                      # local Worker
```

## License

MIT — see [LICENSE](./LICENSE).
