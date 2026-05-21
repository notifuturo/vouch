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

## Endpoints

| Method & path | Cost | Description |
|---------------|------|-------------|
| `POST /v1/check` | x402 (USDC) | Assess a counterparty → `{ score, risk, reasons }` |
| `POST /v1/report` | free | Submit a `flag` or `vouch` for a host |
| `GET /v1/stats` | free | Aggregate reputation totals (hosts, checks, flags, vouches) |
| `GET /health` | free | Liveness |
| `GET /` | free | Service info |

## Stack ($0 to run)

TypeScript · [Hono](https://hono.dev) · Cloudflare Workers (free tier) ·
D1 (free SQLite) · `@x402/*` v2 · public facilitator at `x402.org/facilitator`.

Testnet first (Base Sepolia + free Circle faucet USDC); flip `X402_NETWORK` to
`base` for mainnet.

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
