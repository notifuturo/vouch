// Thin abstraction over the Cloudflare Workers Rate Limiting binding.
// Structurally matches the runtime `RateLimit` binding, but is our own type so
// the code compiles and tests run without the binding present.

export interface Limiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** Always-allow limiter — used locally / in tests when no binding is bound. */
const ALLOW_ALL: Limiter = {
  async limit() {
    return { success: true };
  },
};

/** Always-deny limiter — for fail-closed abuse-controlled routes when the
 *  binding is missing (a misconfiguration we'd rather block than silently allow). */
const DENY_ALL: Limiter = {
  async limit() {
    return { success: false };
  },
};

/**
 * Return the bound limiter, or a fallback when none is configured. By default
 * the fallback is permissive (so the free read tier still works locally / in
 * tests). For abuse-controlled WRITE routes (`/v1/report`) pass
 * `{ failClosed: true }` so a missing binding in production denies rather than
 * silently disabling all throttling.
 */
export function resolveLimiter(
  binding: Limiter | undefined,
  opts: { failClosed?: boolean } = {},
): Limiter {
  if (binding) return binding;
  if (opts.failClosed) {
    console.warn("[ratelimit] limiter binding missing on an abuse-controlled route — failing CLOSED");
    return DENY_ALL;
  }
  return ALLOW_ALL;
}

/** Per-client key for rate limiting; Cloudflare sets CF-Connecting-IP. */
export function clientKey(ip: string | undefined): string {
  return ip && ip.length > 0 ? ip : "anon";
}

/**
 * Stable, non-reversible per-source key for report DE-DUPLICATION (so a single
 * source can't inflate a host's reputation counters by repeating a report). A
 * fast non-cryptographic hash — it intentionally avoids storing raw client IPs;
 * it is NOT a security boundary, only a grouping key.
 */
export function sourceKey(ip: string | undefined): string {
  const s = ip && ip.length > 0 ? ip : "anon";
  let h = 0x811c9dc5; // FNV-1a 32-bit
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
