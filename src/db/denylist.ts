import type { DenylistLookup } from "../scoring/signals/threatFeed.js";

/**
 * Lazily-hydrated, in-memory denylist sourced from a free threat feed (a plain
 * newline-delimited host list, e.g. URLhaus). Cached per isolate with a TTL.
 *
 * Design choice: it FAILS OPEN — on any fetch/parse error the lookup returns
 * `false` (not denied). A trust API must never block a legitimate payment just
 * because an upstream feed is briefly unavailable; the threat signal simply
 * abstains and other signals carry the score.
 */
export function createDenylist(feedUrl: string | undefined, ttlMs = 6 * 60 * 60 * 1000): DenylistLookup {
  let hosts: Set<string> | null = null;
  let fetchedAt = 0;
  let inflight: Promise<void> | null = null;

  async function hydrate(): Promise<void> {
    if (!feedUrl) {
      hosts = new Set();
      fetchedAt = Date.now();
      return;
    }
    try {
      const res = await fetch(feedUrl);
      if (!res.ok) throw new Error(`feed status ${res.status}`);
      const text = await res.text();
      const next = new Set<string>();
      for (const line of text.split("\n")) {
        const host = line.trim().toLowerCase();
        if (host && !host.startsWith("#")) next.add(host);
      }
      hosts = next;
      fetchedAt = Date.now();
    } catch {
      // Fail open: keep any prior set, else an empty one.
      hosts ??= new Set();
      fetchedAt = Date.now();
    }
  }

  return async function isDenied(host: string): Promise<boolean> {
    const stale = Date.now() - fetchedAt > ttlMs;
    if (hosts === null || stale) {
      inflight ??= hydrate().finally(() => {
        inflight = null;
      });
      await inflight;
    }
    return hosts?.has(host) ?? false;
  };
}
