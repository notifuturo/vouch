import type { Signal, Target } from "../../types.js";

const SUSPICIOUS_TLDS = new Set([
  "zip", "mov", "top", "xyz", "click", "country", "kim", "work", "gq", "cf",
  "ml", "ga", "tk",
]);

/**
 * Structural heuristics on the hostname. No network, no paid WHOIS — purely
 * the kinds of patterns that correlate with throwaway/phishing domains.
 * Returns a single aggregated signal so weighting stays simple.
 */
export function domainHeuristicsSignal(target: Target): Signal {
  const host = target.host;
  if (!host) {
    return {
      id: "domain_heuristics",
      weight: 1,
      score: 0.5,
      detail: "No host to analyze.",
    };
  }

  const flags: string[] = [];
  let score = 1;

  // Punycode / IDN homograph risk.
  if (host.includes("xn--")) {
    score -= 0.4;
    flags.push("uses punycode (possible homograph spoofing)");
  }

  // Raw IP address instead of a domain name.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    score -= 0.35;
    flags.push("is a raw IP address");
  }

  // Excessive hyphens or digits — common in generated phishing domains.
  const hyphens = (host.match(/-/g) ?? []).length;
  if (hyphens >= 3) {
    score -= 0.2;
    flags.push(`has ${hyphens} hyphens`);
  }
  const digitRatio = (host.replace(/[^0-9]/g, "").length) / host.length;
  if (digitRatio > 0.3) {
    score -= 0.2;
    flags.push("is digit-heavy");
  }

  // Very long hostnames.
  if (host.length > 40) {
    score -= 0.15;
    flags.push("is unusually long");
  }

  // Cheap / abuse-prone TLDs.
  const tld = host.split(".").pop() ?? "";
  if (SUSPICIOUS_TLDS.has(tld)) {
    score -= 0.25;
    flags.push(`uses a high-abuse TLD (.${tld})`);
  }

  const detail =
    flags.length === 0
      ? "Hostname structure looks unremarkable."
      : `Hostname ${flags.join(", ")}.`;

  return {
    id: "domain_heuristics",
    weight: 1,
    score: Math.max(0, score),
    detail,
  };
}
