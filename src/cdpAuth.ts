// Workers-native Coinbase CDP API auth (Ed25519 JWT), signed with WebCrypto.
//
// Why this exists: @coinbase/cdp-sdk signs the CDP auth JWT via `jose`, which on
// Cloudflare Workers (nodejs_compat) takes the Node `node:crypto` path and
// produces an invalid Ed25519 signature → CDP returns 401. WebCrypto's Ed25519
// works natively in Workers, so we replicate the exact CDP JWT here.

import { ed25519 } from "@noble/curves/ed25519.js";
import type { FacilitatorConfig } from "@x402/core/server";

const CDP_BASE = "https://api.cdp.coinbase.com";
const CDP_HOST = "api.cdp.coinbase.com";
const X402_ROUTE = "/platform/v2/x402";
// Mirrors @coinbase/x402's Correlation-Context header.
const CORRELATION =
  "sdk_version=1.29.0,sdk_language=typescript,source=x402,source_version=2.1.0";

function bytesToB64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function strToB64Url(s: string): string {
  return bytesToB64Url(new TextEncoder().encode(s));
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function nonceHex(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** Extract the 32-byte Ed25519 seed from a CDP secret (base64 of seed||pubkey). */
function ed25519Seed(apiKeySecret: string): Uint8Array {
  const decoded = b64ToBytes(apiKeySecret);
  if (decoded.length !== 64) {
    throw new Error(`Invalid Ed25519 key length: ${decoded.length} (expected 64)`);
  }
  return decoded.subarray(0, 32);
}

/**
 * Build a CDP EdDSA JWT scoped to a single `METHOD host+path` request, signed
 * with pure-JS Ed25519 (`@noble/curves`) — deterministic and identical across
 * Node and the Workers runtime (unlike jose/WebCrypto here).
 */
function signJwt(apiKeyId: string, seed: Uint8Array, method: string, path: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "EdDSA", kid: apiKeyId, typ: "JWT", nonce: nonceHex() };
  const claims = {
    sub: apiKeyId,
    iss: "cdp",
    uris: [`${method} ${CDP_HOST}${path}`],
    iat: now,
    nbf: now,
    exp: now + 120,
  };
  const signingInput = `${strToB64Url(JSON.stringify(header))}.${strToB64Url(JSON.stringify(claims))}`;
  const sig = ed25519.sign(new TextEncoder().encode(signingInput), seed);
  return `${signingInput}.${bytesToB64Url(sig)}`;
}

/**
 * Build a {@link FacilitatorConfig} for the Coinbase CDP x402 facilitator that
 * authenticates with WebCrypto-signed Ed25519 JWTs (Workers-compatible).
 */
export function createCdpFacilitatorConfig(
  apiKeyId: string,
  apiKeySecret: string,
): FacilitatorConfig {
  return {
    url: `${CDP_BASE}${X402_ROUTE}`,
    createAuthHeaders: async () => {
      const seed = ed25519Seed(apiKeySecret);
      const bearer = (method: string, op: string) =>
        `Bearer ${signJwt(apiKeyId, seed, method, `${X402_ROUTE}/${op}`)}`;
      return {
        verify: { "Correlation-Context": CORRELATION, Authorization: bearer("POST", "verify") },
        settle: { "Correlation-Context": CORRELATION, Authorization: bearer("POST", "settle") },
        supported: { "Correlation-Context": CORRELATION, Authorization: bearer("GET", "supported") },
      };
    },
  };
}
