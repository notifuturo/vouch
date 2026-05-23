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

/** Strictly decode base64url; throws on any non-alphabet character. */
function b64UrlToBytes(b64url: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(b64url)) throw new Error("invalid base64url");
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  return b64ToBytes(b64 + pad);
}

/** Decode the base64 signing secret into its 32-byte Ed25519 seed. */
function seedFrom(signingKeyB64: string): Uint8Array {
  const b = b64ToBytes(signingKeyB64);
  if (b.length !== 32) {
    throw new Error(`Invalid VOUCH_SIGNING_KEY length ${b.length} (expected 32-byte seed, base64)`);
  }
  return b;
}

/** Default attestation validity window. Short, because a trust verdict is only
 *  meaningful "now" — a host's reputation can degrade after issuance, so an
 *  attestation must not be presentable as current due-diligence proof forever. */
const ATTESTATION_TTL_S = 600; // 10 minutes
const TYP = "vouch-attestation+jwt";
const ISS = "vouch";
const DEFAULT_CLOCK_SKEW_S = 30;

export interface AttestationInput {
  subject: string; // normalized host assessed
  score: number;
  risk: string;
  /** Raw caller input (recorded alongside the normalized `sub` for audit). */
  target?: string;
  /** Optional audience to bind the attestation to a specific relying party. */
  audience?: string;
  /** Override the default validity window (seconds). */
  ttlSeconds?: number;
}

/**
 * Produce a compact Ed25519-signed JWT attestation:
 *   header.claims.signature  (alg EdDSA)
 * claims: { iss, sub, score, risk, iat, nbf, exp, jti, [target], [aud] }
 *
 * The `exp`/`nbf` window makes the attestation valid only for a bounded period
 * (anti-replay), and `aud` (when set) binds it to a relying party.
 */
export function signAttestation(signingKeyB64: string, input: AttestationInput): string {
  const seed = seedFrom(signingKeyB64);
  const now = Math.floor(Date.now() / 1000);
  const ttl = input.ttlSeconds ?? ATTESTATION_TTL_S;
  const header = { alg: "EdDSA", typ: TYP };
  const claims: Record<string, unknown> = {
    iss: ISS,
    sub: input.subject,
    score: input.score,
    risk: input.risk,
    iat: now,
    nbf: now,
    exp: now + ttl,
    jti: crypto.randomUUID(),
  };
  if (input.target !== undefined) claims.target = input.target;
  if (input.audience !== undefined) claims.aud = input.audience;
  const signingInput = `${strToB64Url(JSON.stringify(header))}.${strToB64Url(JSON.stringify(claims))}`;
  const sig = ed25519.sign(new TextEncoder().encode(signingInput), seed);
  return `${signingInput}.${bytesToB64Url(sig)}`;
}

type PublicJwk = { kty: string; crv: string; x: string; alg: string; use: string };
let jwkCache: { key: string; jwk: PublicJwk } | null = null;

/** Public JWK (OKP/Ed25519) for verifying attestations — safe to publish.
 *  Cached per isolate so the secret seed isn't run through scalar-mult on
 *  every (public, unauthenticated) pubkey request. */
export function attestationPublicJwk(signingKeyB64: string): PublicJwk {
  if (jwkCache && jwkCache.key === signingKeyB64) return jwkCache.jwk;
  const pub = ed25519.getPublicKey(seedFrom(signingKeyB64));
  const jwk: PublicJwk = { kty: "OKP", crv: "Ed25519", x: bytesToB64Url(pub), alg: "EdDSA", use: "sig" };
  jwkCache = { key: signingKeyB64, jwk };
  return jwk;
}

export interface VerifyOptions {
  /** Current time (unix seconds); defaults to now. Injectable for tests. */
  now?: number;
  /** If set, the attestation's `aud` must equal this. */
  audience?: string;
  /** Allowed clock skew in seconds (default 30). */
  clockToleranceS?: number;
}

/**
 * Verify an attestation JWT against a raw Ed25519 public key (reference verifier
 * for tests/clients). Checks the signature AND the claims: header `alg`/`typ`,
 * `iss`, the `exp`/`nbf` validity window, and `aud` when requested. Returns
 * false (never throws) on any failure — including malformed/expired tokens.
 */
export function verifyAttestation(
  jwt: string,
  publicKey: Uint8Array,
  opts: VerifyOptions = {},
): boolean {
  const parts = jwt.split(".");
  if (parts.length !== 3) return false;
  const [h, p, s] = parts as [string, string, string];

  let sig: Uint8Array;
  try {
    sig = b64UrlToBytes(s);
  } catch {
    return false;
  }
  if (sig.length !== 64) return false;

  const msg = new TextEncoder().encode(`${h}.${p}`);
  try {
    if (!ed25519.verify(sig, msg, publicKey)) return false;
  } catch {
    return false;
  }

  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  try {
    header = JSON.parse(new TextDecoder().decode(b64UrlToBytes(h)));
    claims = JSON.parse(new TextDecoder().decode(b64UrlToBytes(p)));
  } catch {
    return false;
  }

  if (header.alg !== "EdDSA" || header.typ !== TYP) return false;
  if (claims.iss !== ISS) return false;

  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const skew = opts.clockToleranceS ?? DEFAULT_CLOCK_SKEW_S;
  if (typeof claims.exp !== "number" || now > claims.exp + skew) return false; // missing/expired
  if (typeof claims.nbf === "number" && now + skew < claims.nbf) return false; // not yet valid
  if (opts.audience !== undefined && claims.aud !== opts.audience) return false;

  return true;
}
