import type { Signal, Target } from "../../types.js";

/**
 * Looks up a host against a denylist of known-malicious domains. In production
 * this set is hydrated from free threat feeds (URLhaus, OpenPhish) on a
 * schedule and cached; here we accept the lookup as an injected dependency so
 * the signal is testable and the data source is swappable.
 */
export type DenylistLookup = (host: string) => boolean | Promise<boolean>;

export async function threatFeedSignal(
  target: Target,
  isDenied: DenylistLookup,
): Promise<Signal> {
  if (!target.host) {
    return {
      id: "threat_feed",
      weight: 3,
      score: 0.5,
      detail: "No host to check against threat feeds.",
    };
  }

  const denied = await isDenied(target.host);
  return denied
    ? {
        id: "threat_feed",
        weight: 3,
        score: 0,
        detail: `Host appears on a known-malicious threat feed.`,
      }
    : {
        id: "threat_feed",
        weight: 3,
        score: 1,
        detail: "Host not found on known-malicious threat feeds.",
      };
}
