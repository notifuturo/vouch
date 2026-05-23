// App-level settlement idempotency.
//
// The x402 facilitator (Coinbase CDP) already enforces one-time use on-chain:
// the "exact" EVM scheme settles an EIP-3009 authorization whose nonce can only
// be spent once, so a replayed payment proof fails to settle and never reaches
// our handler. This ledger is defense-in-depth on top of that: it records each
// settled payment under a stable per-payment id so Vouch's own side effects
// (the reputation check counter) are applied EXACTLY ONCE per payment, even if
// the same proof is presented twice (facilitator quirk, client retry, etc.).
// It also doubles as a settlement audit trail for revenue reconciliation.

/** Records settled payments and reports whether one is new vs. a replay. */
export interface SettlementStore {
  /**
   * Atomically record a payment id. Returns `true` if it was newly recorded
   * (first time this payment settled here) and `false` if it was already
   * present (a replay/retry — the caller should skip one-time side effects).
   */
  markIfNew(paymentId: string, host?: string | null): Promise<boolean>;
}

/** Cloudflare D1-backed store. Idempotency hinges on the PRIMARY KEY: a second
 *  INSERT for the same payment id is ignored and reports zero changed rows. */
export class D1SettlementStore implements SettlementStore {
  constructor(private readonly db: D1Database) {}

  async markIfNew(paymentId: string, host: string | null = null): Promise<boolean> {
    const res = await this.db
      .prepare(
        "INSERT OR IGNORE INTO settlements (payment_id, host, settled_at) VALUES (?, ?, ?)",
      )
      .bind(paymentId, host, new Date().toISOString())
      .run();
    return (res.meta?.changes ?? 0) === 1;
  }
}

/** In-memory store for tests and local reasoning. */
export class InMemorySettlementStore implements SettlementStore {
  private readonly seen = new Set<string>();

  async markIfNew(paymentId: string): Promise<boolean> {
    if (this.seen.has(paymentId)) return false;
    this.seen.add(paymentId);
    return true;
  }
}

/** x402 request headers that carry the (per-payment-unique) payment payload,
 *  in precedence order: v1 `x-payment`, then the v2 signature/payment headers. */
const PAYMENT_HEADERS = ["x-payment", "payment-signature", "payment"] as const;

/**
 * Derive a stable idempotency id from the incoming x402 payment header. The
 * header embeds the payment authorization (which carries a one-time nonce), so
 * two distinct legitimate payments never collide and a replay reuses the exact
 * bytes. Returns null when no payment header is present (e.g. an ungated call).
 */
export async function paymentIdFromHeaders(
  header: (name: string) => string | undefined,
): Promise<string | null> {
  let raw: string | undefined;
  for (const name of PAYMENT_HEADERS) {
    raw = header(name);
    if (raw) break;
  }
  if (!raw) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
