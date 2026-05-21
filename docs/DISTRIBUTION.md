# Vouch — Distribution & GTM Strategy

Synthesized from market research (May 2026). Vouch = a per-call payment-trust/risk
API for AI agents (`POST /v1/check`, x402, $0.001 USDC, live on Cloudflare Workers,
settles via Coinbase CDP, currently Base Sepolia testnet).

---

## The one insight that drives everything

**The Coinbase x402 Bazaar is the master distribution lever.** Set it up once and
it fans out to *every* giant:

```
              ┌─> Coinbase Agentic.Market (human front-end)
x402 Bazaar ──┼─> AWS Bedrock AgentCore (ships the Bazaar MCP server, 10k+ endpoints,
(CDP discovery)│    to its agents — no AWS-specific work needed)
              ├─> Onyx Bazaar / public x402 directories
              └─> agents querying GET /v2/x402/discovery/search directly
```

Cloudflare runs **no** directory (infra only). So there is no "list on AWS" or
"list on Cloudflare" — there is **"be in the Bazaar,"** which reaches all of them.

---

## Two build gaps block the top channels (our static files aren't enough)

| Gap | Unlocks | Work |
|-----|---------|------|
| **Real MCP Streamable-HTTP endpoint** (not our static `/mcp/tools` file) | Official MCP Registry → auto-fans-out to PulseMCP, Glama, Smithery | ~1 day on Workers |
| **Bazaar discovery extension** (`declareDiscoveryExtension()` on `/v1/check`) + settle ≥1 payment via CDP | x402 Bazaar → Agentic.Market + AWS Bedrock + Onyx | ~0.5 day (we already settle via CDP) |
| **Base mainnet** | *Ranking + real revenue* (testnet indexes but generates zero buyer-reach signal, so it won't rank or earn) | founder decision (real money) |

Bazaar ranking signals (6-hour refresh): **distinct payers > raw volume**, recency,
and metadata/schema quality. Levers in our control: keyword-rich description,
complete JSON schemas + examples, and seeding traffic from *multiple* wallets.

---

## Competitive reality — we are NOT first

| Competitor | What | Note |
|-----------|------|------|
| **DJD Agent Score** | Near-identical 0-100 trust score | **Free basic tier**, $0.10 for breakdown — sets the price anchor |
| **t54 Labs** (x402-secure / Trustline) | Risk engine + gateway | **$5M seed (Ripple)**, going open-source + pushing "AgenticRiskStandard" |
| **AnChain.AI** | OFAC/FATF/sanctions screening MCP | Sub-200ms compliance angle |
| **Wallet-intelligence APIs / ERC-8004 / AgentZone** | Wallet risk, on-chain reputation registries | Adjacent |

**Differentiation wedges for Vouch:** (1) explainable **reasons** in every response
(decision-useful, not a bare number), (2) a hard **latency SLA**, (3) **EVM + Solana**
counterparty coverage, (4) a **5-minute drop-in middleware SDK**, (5) a **free
basic tier** to counter DJD's free score, monetizing depth/reasons.

---

## Ranked distribution playbook

### Tier 0 — Build prerequisites (do first; mostly $0/testnet)
1. **Real MCP Streamable-HTTP endpoint** on the Worker (replaces static `/mcp/tools`).
2. **Bazaar discovery extension** on `POST /v1/check` (schemas + examples + `paymentPayload.resource`).
3. **(Founder call) Base mainnet** — the ranking/revenue unlock.

### Tier 1 — Free, automatic, highest ROI (after Tier 0)
- **x402 Bazaar** → auto-inherits **Coinbase Agentic.Market + AWS Bedrock AgentCore + Onyx**. One lever, all giants. No fee, no submission.
- **Official MCP Registry** (`mcp-publisher`, self-serve, no review) → auto-fans-out to **PulseMCP, Glama**.
- **MCPay** (mcpay.tech) — paid-tool registry that accepts **plain HTTP** endpoints; lowest-friction, works even before the MCP endpoint is built.

### Tier 2 — Cheap manual coverage (hours each)
- **awesome-x402** (Merit-Systems #252, xpaysh #414) — ✅ already PR'd.
- **x402scan** (Merit-Systems ecosystem explorer) — indexed once we have on-chain activity.
- **Smithery**, **mcp.so**, **mcpservers.org**, **Cline MCP marketplace** — submit once the MCP endpoint exists.
- Public GitHub repo present → **Glama** crawls it (✅ notifuturo/vouch).

### Tier 3 — Partnerships & enterprise
- **Skyfire / KYAPay** (#1 partner) — they do agent *identity* (KYA), we do *risk* — complementary. KYAPay is open-source; build an adapter + pitch as the risk layer on top.
- **Crossmint** (#2) — agent wallets/cards; Vouch as a pre-pay check. Integration/co-marketing.
- **AP2 (Google)** positioning — AP2 = authorization-trust; Vouch = counterparty-trust complement. Standards alignment, not a build.
- **Stripe x402** — watch + integrate opportunistically (their ACP/card side is closed to us).
- **AWS Marketplace listing** — *only* if chasing enterprise procurement (heavy: seller registration, tax/bank/KYC, human review; different billing than x402). Skip otherwise.
- **Skip directly:** Visa Intelligent Commerce, Mastercard Agent Pay, Nekuda, PayOS, Payman — reach via partners later, not directly.

### Tier 4 — Demand-side GTM
**Beachhead persona:** **x402 *sellers*** (anyone running a paid endpoint who wants to
reject low-trust payers before spending compute). Immediate need, trivial integration,
and they're *enumerable* (listed on Bazaar/x402scan).

- **P1 — drop-in SDK:** a Hono/Express middleware (`requireMinScore(70)`-style) + free basic tier. Lead docs with copy-paste. This is the adoption wedge DJD/t54 win on.
- **P2 — content/demos:** the "agent about to pay a scam wallet → Vouch blocks it" demo video; technical deep-dives ("x402 attack vectors and how to gate them"); cross-post to the channels below; **Product Hunt** launch (AI Agents / Crypto Tools).
- **P3 — partnerships & events:** Skyfire integration + co-announce; sponsor a "best use of trust/risk" **hackathon bounty** (Kite×Coinbase, DoraHacks SF); pitch newsletters; show up at **Consensus Miami** (agentic-commerce track).

**Where the builders are:** Telegram x402 group (600+), Coinbase Developer Platform
Discord, r/x402; X: Erik Reppel (x402 founder), @merit_systems, CDP/x402 Foundation;
newsletters: *Agentic Commerce Frontier*, Rich Turrin's *Cashless*; GitHub: coinbase/x402,
Merit-Systems, skyfire-xyz/kyapay, t54-labs.

**What does NOT work here:** generic paid ads, broad SEO (category too new), direct
card-network integration. Win by being *natively agent-discoverable* (Bazaar/MCP),
*trivially droppable* (SDK), and *visible to a concentrated community* (Telegram/Discord/X/hackathons).

---

## Three strategic decisions — RESOLVED

1. **Differentiation vs DJD Agent Score** → ✅ **Lead with explainable *reasons*** (already our output) + a drop-in SDK + speed. The paid `/v1/check` returns `reasons + signals`; that's the wedge.
2. **Free tier?** → ✅ **Shipped.** `POST /v1/score` returns `{score, risk}` for free (rate-limited 60/60s); the explainable `reasons/signals` are the paid upgrade (`/v1/check`). Every free call still records and feeds the reputation moat.
3. **Standards posture** → ✅ **Stay open** (MIT, open x402/MCP); defer a KYAPay adapter to an actual Skyfire partnership conversation rather than building speculatively.

---

## Recommended next engineering (all $0 / testnet-buildable, positions us for mainnet)

1. **Real MCP Streamable-HTTP endpoint** on the Worker (consider Vercel's `x402-mcp` `paidTool` primitive or MCPay for a standard, client-compatible 402 handshake).
2. **Bazaar discovery extension** on `/v1/check`.
3. **Drop-in middleware SDK** (the GTM adoption wedge) + a **free basic tier**.

These three make Vouch listable on every Tier-1 surface and adoptable in 5 minutes —
then the **mainnet flip** turns discovery into ranked, paying traffic.
