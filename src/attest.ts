// Signed trust attestations — the paid tier's differentiator.
//
// The paid /v1/check returns a tamper-proof, verifiable receipt: a compact
// Ed25519-signed JWT stating "Vouch assessed <subject> at <time> -> score/risk".
// An autonomous payer keeps it as PROOF it did due diligence before paying
// (audit / dispute / spending-mandate compliance). Anyone can verify it against
// Vouch's public key (GET /v1/attestation/pubkey) — it cannot be forged or
// replayed. The free /v1/score does NOT include this.

import { ed25519 } from "@noble/curves/ed25519.js";

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

/** Decode the base64 signing secret into its 32-byte Ed25519 seed. */
function seedFrom(signingKeyB64: string): Uint8Array {
  const b = b64ToBytes(signingKeyB64);
  if (b.length !== 32) {
    throw new Error(`Invalid VOUCH_SIGNING_KEY length ${b.length} (expected 32-byte seed, base64)`);
  }
  return b;
}

export interface AttestationInput {
  subject: string; // host assessed
  score: number;
  risk: string;
}

/**
 * Produce a compact Ed25519-signed JWT attestation:
 *   header.claims.signature  (alg EdDSA)
 * claims: { iss:"vouch", sub, score, risk, iat, jti }
 */
export function signAttestation(signingKeyB64: string, input: AttestationInput): string {
  const seed = seedFrom(signingKeyB64);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "EdDSA", typ: "vouch-attestation+jwt" };
  const claims = {
    iss: "vouch",
    sub: input.subject,
    score: input.score,
    risk: input.risk,
    iat: now,
    jti: crypto.randomUUID(),
  };
  const signingInput = `${strToB64Url(JSON.stringify(header))}.${strToB64Url(JSON.stringify(claims))}`;
  const sig = ed25519.sign(new TextEncoder().encode(signingInput), seed);
  return `${signingInput}.${bytesToB64Url(sig)}`;
}

/** Public JWK (OKP/Ed25519) for verifying attestations — safe to publish. */
export function attestationPublicJwk(signingKeyB64: string): {
  kty: string;
  crv: string;
  x: string;
  alg: string;
  use: string;
} {
  const pub = ed25519.getPublicKey(seedFrom(signingKeyB64));
  return { kty: "OKP", crv: "Ed25519", x: bytesToB64Url(pub), alg: "EdDSA", use: "sig" };
}

/** Verify an attestation JWT against a raw Ed25519 public key (for tests/clients). */
export function verifyAttestation(jwt: string, publicKey: Uint8Array): boolean {
  const parts = jwt.split(".");
  if (parts.length !== 3) return false;
  const [h, p, s] = parts as [string, string, string];
  const sig = b64ToBytes(s.replace(/-/g, "+").replace(/_/g, "/"));
  const msg = new TextEncoder().encode(`${h}.${p}`);
  try {
    return ed25519.verify(sig, msg, publicKey);
  } catch {
    return false;
  }
}
