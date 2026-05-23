import type { Signal, Target } from "../../types.js";

const SUSPICIOUS_TLDS = new Set([
  "zip", "mov", "top", "xyz", "click", "country", "kim", "work", "gq", "cf",
  "ml", "ga", "tk",
]);

/** True for private / loopback / link-local / CGNAT / metadata IP literals,
 *  which are never plausible public payment endpoints. */
function isPrivateOrSpecialIp(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 0 || a === 10 || a === 127) return true; // this-host / private / loopback
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 169 && b === 254) return true; // link-local + 169.254.169.254 metadata
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  if (h === "::1" || h === "::") return true; // loopback / unspecified
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // ULA fc00::/7
  if (/^fe[89ab]/.test(h)) return true; // link-local fe80::/10
  return false;
}

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

  // Raw IP address (any encoding) instead of a domain name. parseTarget has
  // already canonicalized to dotted-quad IPv4 or bracketed IPv6.
  const isIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  const isIpv6 = host.startsWith("[") || (host.includes(":") && /^[0-9a-f:.\[\]]+$/.test(host));
  if (isIpv4 || isIpv6) {
    score -= 0.35;
    flags.push("is a raw IP address");
    // Private / loopback / link-local / metadata addresses are not plausible
    // public payment endpoints — floor them hard so no clean verdict is issued.
    if (isPrivateOrSpecialIp(host)) {
      score -= 0.6;
      flags.push("is a private/loopback/link-local address");
    }
  }

  // Excessive hyphens or digits — common in generated phishing domains.
  const hyphens = (host.match(/-/g) ?? []).length;
  if (hyphens >= 3) {
    score -= 0.2;
    flags.push(`has ${hyphens} hyphens`);
  }
  // Digit ratio over the alphanumeric characters only (dots/brackets excluded),
  // so the heuristic measures the label content rather than the separators.
  const alnum = host.replace(/[^a-z0-9]/gi, "").length;
  const digitRatio = alnum > 0 ? host.replace(/[^0-9]/g, "").length / alnum : 0;
  if (!isIpv4 && !isIpv6 && digitRatio > 0.3) {
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
