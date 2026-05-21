import type { Target } from "../types.js";

/**
 * Normalize arbitrary caller input into a {@link Target}.
 * Accepts full URLs ("https://shop.example.com/pay"), bare hosts
 * ("shop.example.com"), or x402 resource strings. Never throws.
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
    return {
      raw,
      host: url.hostname.toLowerCase() || null,
      secure: hasScheme ? url.protocol === "https:" : false,
    };
  } catch {
    return { raw, host: null, secure: false };
  }
}
