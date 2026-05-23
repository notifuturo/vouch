import type { Target } from "../types.js";

/** Strip trailing dot(s): the FQDN form `evil.com.` is the same host as `evil.com`. */
function stripTrailingDots(host: string): string {
  return host.replace(/\.+$/, "");
}

/**
 * Canonicalize a BARE host string the same way the WHATWG URL parser normalizes
 * the host of an https URL (lowercasing, IDNA/punycode folding, IP-literal
 * normalization — decimal/hex/octal IPv4 → dotted quad, IPv6 → compressed),
 * plus trailing-dot stripping. Returns null if the input doesn't resolve to a
 * clean host (carries userinfo/port/path/query/fragment, or is unparseable).
 *
 * This is applied to BOTH threat-feed ingestion and the host extracted from
 * caller input, so denylist matching can't be evaded by representation
 * differences (IP encodings, trailing dot, IDN/punycode, case): the two sides
 * always produce the identical canonical form.
 */
export function canonicalHost(hostLike: string): string | null {
  const s = (hostLike ?? "").trim();
  if (!s) return null;
  try {
    const u = new URL(`https://${s}`);
    if (u.username || u.password || u.pathname !== "/" || u.search || u.hash) return null;
    return stripTrailingDots(u.hostname.toLowerCase()) || null;
  } catch {
    return null;
  }
}

/**
 * Normalize arbitrary caller input into a {@link Target}.
 * Accepts full URLs ("https://shop.example.com/pay"), bare hosts
 * ("shop.example.com"), or x402 resource strings. Never throws.
 *
 * Security: rejects userinfo (`user@host` lets the displayed string and the
 * actually-assessed host diverge — score laundering / targeted poisoning) and
 * any non-http(s) scheme (we don't issue authoritative verdicts/attestations
 * for ftp:, ws:, gopher:, etc.). The extracted host is canonicalized so it
 * matches the denylist regardless of representation.
 */
export function parseTarget(raw: string): Target {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") {
    return { raw, host: null, secure: false };
  }

  // Try to parse as a URL; if it lacks a scheme, retry with https:// so we
  // can still extract the host (but record that the input was schemeless).
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  try {
    const url = new URL(hasScheme ? trimmed : `https://${trimmed}`);
    // Ambiguous authority — the visible string and the real host can diverge.
    if (url.username || url.password) {
      return { raw, host: null, secure: false };
    }
    // Only http(s) resources get an authoritative verdict.
    if (hasScheme && url.protocol !== "http:" && url.protocol !== "https:") {
      return { raw, host: null, secure: false };
    }
    return {
      raw,
      host: stripTrailingDots(url.hostname.toLowerCase()) || null,
      secure: hasScheme ? url.protocol === "https:" : false,
    };
  } catch {
    return { raw, host: null, secure: false };
  }
}
