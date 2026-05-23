# Vouch — Architecture Diagrams

A complete set of Mermaid diagrams for Vouch, the per-call payment-trust API for
AI agents. These render on GitHub automatically, or paste any block into
[mermaid.live](https://mermaid.live) to view/export as SVG/PNG.

- [1. System architecture](#1-system-architecture)
- [2. Sequence — x402 pay/retry handshake](#2-sequence--x402-payretry-handshake)
- [3. Request middleware pipeline](#3-request-middleware-pipeline)
- [4. Scoring engine](#4-scoring-engine)
- [5. Data model (D1)](#5-data-model-d1)
- [6. CDP facilitator auth (Ed25519 JWT)](#6-cdp-facilitator-auth-ed25519-jwt)
- [7. Deployment & identity topology](#7-deployment--identity-topology)
- [8. Distribution & growth path](#8-distribution--growth-path)
- [9. /v1/check request lifecycle](#9-v1check-request-lifecycle)
- [10. Full tech stack](#10-full-tech-stack)

---

## 1. System architecture

```mermaid
flowchart TB
    BA["AI Buyer Agent<br/>x402 client + viem signer"]

    subgraph CF["Cloudflare Worker (Hono) — vouch.futuronoti.workers.dev"]
      direction TB
      CORS["CORS + merchant headers (outermost)"]
      GATE["x402 Payment Gate<br/>gates POST /v1/check"]
      CHECK["POST /v1/check (PAID)"]
      REPORT["POST /v1/report (free)"]
      STATS["GET /v1/stats"]
      DISC["GET /.well-known/x402<br/>GET /mcp/tools"]
      LAND["GET / landing page"]
      subgraph SCORE["Scoring engine"]
        SIG["Signals: transport, domain,<br/>threat_feed, reputation"]
        AGG["Aggregate to 0-100<br/>+ risk band + reasons"]
      end
      CDPAUTH["CDP auth (noble Ed25519 JWT)"]
      RL["Rate limiter 10/60s per IP"]
    end

    DB[("D1: reputation + settlements<br/>checks, flags/vouches (+ weighted), settled payments")]
    CDP["Coinbase CDP Facilitator<br/>api.cdp.coinbase.com"]
    CHAIN["Base mainnet — USDC (EIP-3009)"]
    FEED["URLhaus threat feed"]

    BA -->|"1. POST /v1/check (unpaid)"| CORS
    CORS --> GATE
    GATE -->|"2. 402 + payment requirements"| BA
    BA -->|"3. retry with signed X-PAYMENT"| CORS
    GATE -->|"verify + settle"| CDPAUTH --> CDP
    CDP -->|"move USDC"| CHAIN
    GATE -->|"4. paid: run handler"| CHECK
    CHECK --> SIG --> AGG
    SIG -->|"threat lookup"| FEED
    SIG -->|"reputation read"| DB
    CHECK -->|"record check"| DB
    AGG -->|"5. score, risk, reasons"| BA

    BA -->|"free"| REPORT --> RL
    REPORT -->|"flag / vouch"| DB
    STATS -->|"aggregate read"| DB
    CDP -.->|"indexes settled payments"| DISC
```

---

## 2. Sequence — x402 pay/retry handshake

```mermaid
sequenceDiagram
    autonumber
    participant A as Buyer Agent
    participant W as Vouch Worker
    participant F as CDP Facilitator
    participant C as Base mainnet
    participant D as D1

    A->>W: POST /v1/check { target } (no payment)
    W->>F: getSupported() [CDP JWT auth]
    F-->>W: supported kinds
    W-->>A: 402 Payment Required + payment-required header
    Note over A: sign EIP-3009 authorization (viem)
    A->>W: POST /v1/check + X-PAYMENT
    W->>F: verify(payment)
    F-->>W: valid
    W->>D: read reputation(host)
    W->>W: score signals -> verdict
    W->>F: settle(payment)
    F->>C: broadcast USDC transferWithAuthorization
    C-->>F: tx confirmed
    F-->>W: settled
    W->>D: record check (waitUntil, async)
    W-->>A: 200 { score, risk, reasons }
```

---

## 3. Request middleware pipeline

The CORS/headers middleware is **outermost** so it decorates every response —
including the gate's short-circuited `402` — and answers `OPTIONS` preflight
directly. (We use manual headers, not `hono/cors`, which hangs when wrapping the
x402-gated POST.)

```mermaid
flowchart TB
    REQ([Incoming request]) --> M1{"method == OPTIONS?"}
    M1 -->|yes| PRE["204 + Allow-Origin/Methods/Headers"]
    M1 -->|no| GATE["x402 gate<br/>(matches POST /v1/check)"]
    GATE -->|"unpaid"| R402["402 + payment-required"]
    GATE -->|"paid, or non-gated route"| ROUTE["route handler"]
    R402 --> DEC["set ACAO + Expose-Headers<br/>+ merchant headers (if configured)"]
    ROUTE --> DEC
    DEC --> RESP([Response])
    PRE --> RESP
```

---

## 4. Scoring engine

Weighted average of independent signals, with a safety override: only an
**authoritative** signal (threat feed / transport) scoring ~0 can hard-cap the
total — crowd reputation cannot, which resists report-poisoning.

```mermaid
flowchart TB
    T["target string"] --> P["parseTarget -> host, secure"]
    P --> S1["transport (w 1.5)<br/>HTTPS + valid host"]
    P --> S2["domain_heuristics (w 1)<br/>punycode, raw IP, abuse TLD"]
    P --> S3["threat_feed (w 3)<br/>denylist lookup"]
    P --> S4["reputation (w 2)<br/>prior flags/vouches"]
    S3 -. lookup .-> FEED["URLhaus (cached, fail-open)"]
    S4 -. read .-> DB[("D1 reputation")]
    S1 --> AGG["weighted average -> 0-100"]
    S2 --> AGG
    S3 --> AGG
    S4 --> AGG
    AGG --> CAP{"AUTHORITATIVE signal<br/>score <= 0.05?"}
    CAP -->|yes| HARD["cap score <= 15"]
    CAP -->|no| KEEP["keep weighted score"]
    HARD --> BAND
    KEEP --> BAND
    BAND["risk band<br/>>=75 low | >=50 medium | >=25 high | else critical"] --> OUT["{ score, risk, reasons[] }"]
```

---

## 5. Data model (D1)

```mermaid
erDiagram
    REPUTATION {
        text host PK
        int  checks
        int  flags
        int  vouches
        real flag_weight "reporter-standing-weighted"
        real vouch_weight "reporter-standing-weighted"
        text first_seen
        text last_seen
    }
    REPORTS {
        int  id PK
        text host
        text kind "flag | vouch"
        text reason
        text reporter
        text created_at
    }
    SETTLEMENTS {
        text payment_id PK "sha256 of x402 payment header"
        text host
        text settled_at
    }
    REPUTATION ||--o{ REPORTS : "aggregates"
```

---

## 6. CDP facilitator auth (Ed25519 JWT)

Workers-native auth: jose/WebCrypto sign invalid Ed25519 under `nodejs_compat`,
so we sign the CDP JWT with pure-JS `@noble/curves` (byte-identical to standard).

```mermaid
flowchart LR
    SEC["CDP_API_KEY_SECRET<br/>(base64, 64 bytes)"] --> SEED["seed = bytes[0:32]"]
    ID["CDP_API_KEY_ID (UUID)"] --> HDR
    SEED --> SIGN
    HDR["header { alg EdDSA, kid, typ, nonce }"] --> INPUT
    CLAIMS["claims { sub, iss cdp,<br/>uris, iat, nbf, exp+120 }"] --> INPUT
    INPUT["b64url(header).b64url(claims)"] --> SIGN["noble ed25519.sign"]
    SIGN --> JWT["JWT = input.b64url(sig)"]
    JWT --> REQ["Authorization: Bearer JWT<br/>+ Correlation-Context"]
    REQ --> CDP["CDP /supported · /verify · /settle"]
```

---

## 7. Deployment & identity topology

```mermaid
flowchart TB
    subgraph ID["Identity (all futuronoti@gmail.com)"]
      GH["GitHub: notifuturo/vouch (public)"]
      CFACC["Cloudflare account: futuronoti"]
    end

    GH -->|"push -> CI (typecheck + Vitest suite)"| CI["GitHub Actions"]
    GH -->|"wrangler deploy"| WK["Worker: vouch.futuronoti.workers.dev"]

    subgraph BIND["Worker bindings"]
      D1B[("D1: vouch")]
      RLB["Rate Limiter: REPORT_LIMITER"]
      VARS["vars: X402_NETWORK=base,<br/>PRICE, PAY_TO, THREAT_FEED_URL"]
      SECRETS["secrets: CDP_API_KEY_ID,<br/>CDP_API_KEY_SECRET, VOUCH_SIGNING_KEY"]
    end

    WK --- D1B
    WK --- RLB
    WK --- VARS
    WK --- SECRETS
    WK -->|"settle"| CDP["CDP Facilitator -> Base mainnet"]
```

---

## 8. Distribution & growth path

```mermaid
flowchart TB
    V["Vouch (LIVE, Base mainnet)"]

    V --> AW["awesome-x402 PRs<br/>Merit-Systems #252 · xpaysh #414"]
    V --> AG["Agnic registry<br/>app.agnic.ai/monetize (manual)"]
    V --> MN["Base mainnet + CDP settlement (active)"]
    MN -. first settle indexes .-> BZ["Bazaar / Agentic.Market<br/>auto-indexed from settled payments"]

    AW -->|"discovery + clicks"| AGENTS["AI agents discover & pay"]
    AG -->|"MCP discovery, 5% fee"| AGENTS
    BZ -->|"the real shopping surface"| AGENTS
    AGENTS -->|"per-call USDC"| REV["Revenue + compounding reputation data"]
```

---

## 9. /v1/check request lifecycle

```mermaid
stateDiagram-v2
    [*] --> Received
    Received --> Validated: target valid + parses to host
    Received --> Rejected400: invalid or garbage target
    Validated --> PaymentRequired: no X-PAYMENT
    PaymentRequired --> [*]: 402 challenge with CORS
    Validated --> Verifying: X-PAYMENT present
    Verifying --> Scored: CDP verify ok
    Verifying --> Rejected: verify fails
    Scored --> Settled: CDP settle, USDC moves
    Settled --> Responded: 200 score risk reasons
    Rejected400 --> [*]
    Rejected --> [*]
    Responded --> [*]
```

---

## 10. Full tech stack

Runtime, code modules, dependencies, protocols, external services, and dev/build —
everything, in one view.

```mermaid
flowchart TB
    subgraph CLIENTS["AI agents (clients)"]
      AG1["x402 buyer agent<br/>@x402/fetch + viem signer"]
      AG2["MCP clients<br/>Claude / Cline / frameworks"]
    end

    subgraph EDGE["Cloudflare Workers — edge runtime"]
      direction TB
      subgraph APP["Hono app · TypeScript · src/index.ts"]
        MW["middleware:<br/>CORS + merchant hdrs · x402 gate"]
        ROUTES["routes: /v1/check (paid) · /v1/score (free) ·<br/>/v1/report · /mcp · /.well-known/x402 ·<br/>/mcp/tools · /v1/attestation/pubkey · /v1/stats · /health · /"]
      end
      subgraph LOGIC["core modules (src/)"]
        SCORE["scoring/: assess · engine · signals<br/>(transport, domain, threat_feed, reputation)"]
        PAY["payments.ts: x402 gate + Bazaar extension"]
        CDPA["cdpAuth.ts: CDP JWT (Ed25519)"]
        ATT["attest.ts: signed attestation (Ed25519)"]
        MCPS["mcp.ts: JSON-RPC tools"]
        DISC["discovery.ts: descriptors + schemas"]
        DB["db/: repo · denylist · schema.sql"]
        RL["ratelimit.ts · landing.ts · types.ts"]
      end
      subgraph BIND["Worker bindings"]
        D1[("D1 SQLite:<br/>reputation, reports, settlements")]
        RLB["Rate limiters:<br/>REPORT, SCORE"]
        SEC["Secrets: CDP_API_KEY_ID/SECRET,<br/>VOUCH_SIGNING_KEY"]
        VARS["Vars: X402_NETWORK=base,<br/>PRICE, PAY_TO, THREAT_FEED_URL"]
      end
    end

    subgraph DEPS["npm dependencies"]
      DX["@x402/core · /hono · /evm · /extensions · /fetch"]
      DN["@noble/curves (ed25519)"]
      DH["hono"]
      DV["viem"]
    end

    subgraph STD["protocols & standards"]
      P1["x402 (HTTP 402)"]
      P2["MCP — Streamable HTTP, JSON-RPC 2.0"]
      P3["EIP-3009 transferWithAuthorization"]
      P4["Ed25519 / EdDSA JWT"]
      P5["USDC · CAIP-2 networks"]
    end

    subgraph EXT["external services"]
      CDP["Coinbase CDP facilitator"]
      CHAIN["Base mainnet (eip155:8453) · USDC"]
      FEED["URLhaus threat feed"]
      REG["MCP registry → PulseMCP / Glama"]
      BZR["x402 Bazaar → Agentic.Market<br/>+ AWS Bedrock AgentCore"]
    end

    subgraph DEV["dev · build · CI · dist"]
      TS["TypeScript (strict)"]
      VIT["Vitest test suite"]
      WR["Wrangler (deploy)"]
      WT["@cloudflare/workers-types"]
      GH["GitHub notifuturo/vouch + Actions CI"]
      PUB["mcp-publisher"]
      SDK["vouch-sdk (zero-dep npm pkg)"]
      RUFLO["dev env: ruflo / agentic-flow"]
    end

    AG1 -->|"402 → pay → retry"| MW
    AG2 -->|"JSON-RPC"| ROUTES
    MW --> ROUTES
    ROUTES --> SCORE & PAY & ATT & MCPS & DISC
    SCORE --> DB
    MCPS --> SCORE
    PAY --> CDPA --> CDP --> CHAIN
    SCORE --> FEED
    DB --- D1
    RL --- RLB
    CDPA & ATT --- SEC
    PAY --- VARS

    APP --- DH
    PAY --- DX
    CDPA & ATT --- DN
    AG1 --- DV

    PAY -. implements .-> P1 & P3 & P5
    MCPS -. implements .-> P2
    CDPA & ATT -. use .-> P4

    WR -->|deploy| EDGE
    GH --> VIT & WR & PUB
    PUB --> REG
    CHAIN -. first settle indexes .-> BZR
    SDK -. wraps .-> ROUTES
```

**Stack at a glance:** TypeScript (strict) · Hono · Cloudflare Workers (D1, Rate
Limiting, Secrets/Vars) · deps `@x402/core` `/hono` `/evm` `/extensions` `/fetch`,
`@noble/curves`, `hono`, `viem` · standards x402, MCP, EIP-3009, Ed25519/EdDSA,
USDC, CAIP-2 · external CDP facilitator → Base mainnet, URLhaus, MCP registry
(→ PulseMCP/Glama), x402 Bazaar → Agentic.Market + AWS Bedrock · dev/build Vitest,
Wrangler, GitHub Actions CI, `mcp-publisher`, `vouch-sdk`.
