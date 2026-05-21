# vouch-sdk

Tiny, zero-dependency client + payment guard for [Vouch](https://vouch.futuronoti.workers.dev) —
**check a counterparty's trust before your AI agent pays it.**

```bash
npm install vouch-sdk
```

## Gate an outbound payment (one line)

```ts
import { assertTrusted } from "vouch-sdk";

// Throws VouchBlockedError if the merchant scores below 75 (free, no payment).
await assertTrusted("https://some-merchant.com", { minScore: 75 });
await payTheMerchant();
```

## Client

```ts
import { VouchClient } from "vouch-sdk";

const vouch = new VouchClient(); // defaults to the public Vouch deployment

// FREE: score + risk band
const { score, risk } = await vouch.score("https://some-merchant.com");

// Boolean convenience
if (await vouch.isSafe("https://some-merchant.com", 70)) { /* pay */ }

// PAID (x402): full explainable reasons. Pass an x402-capable fetch.
import { wrapFetchWithPayment } from "@x402/fetch";
const payFetch = wrapFetchWithPayment(fetch, x402Client);
const verdict = await vouch.check("https://some-merchant.com", payFetch);
console.log(verdict.score, verdict.risk, verdict.reasons);
```

## API

- `new VouchClient({ baseUrl?, fetch? })`
- `.score(target)` → `{ target, host, score, risk }` (free)
- `.check(target, payFetch?)` → adds `reasons`, `signals` (paid via x402)
- `.isSafe(target, minScore = 70)` → `boolean`
- `assertTrusted(target, { minScore?, client?, baseUrl? })` → `ScoreResult` or throws `VouchBlockedError`

Free tier is rate-limited; use the paid `/v1/check` (via `check()`) for higher volume
and the explainable reasons. MIT.
