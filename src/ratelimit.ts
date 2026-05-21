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

/** Return the bound limiter, or a permissive fallback when none is configured. */
export function reportLimiter(binding: Limiter | undefined): Limiter {
  return binding ?? ALLOW_ALL;
}

/** Per-client key for rate limiting; Cloudflare sets CF-Connecting-IP. */
export function clientKey(ip: string | undefined): string {
  return ip && ip.length > 0 ? ip : "anon";
}
