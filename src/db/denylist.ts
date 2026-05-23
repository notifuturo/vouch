import type { DenylistLookup } from "../scoring/signals/threatFeed.js";
import { canonicalHost } from "../scoring/target.js";

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
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        // Support both bare-host feeds AND hosts-file format ("0.0.0.0 host" /
        // "127.0.0.1<TAB>host", e.g. URLhaus): the host is the last token. We
        // then canonicalize it identically to caller input so lookups match.
        const token = trimmed.split(/\s+/).pop() ?? "";
        const host = canonicalHost(token);
        if (host) next.add(host);
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
    // Canonicalize the lookup the same way as ingestion (defensive — callers
    // already pass parseTarget output, which is canonical).
    const canon = canonicalHost(host);
    return canon ? (hosts?.has(canon) ?? false) : false;
  };
}
