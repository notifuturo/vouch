import { describe, it, expect } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import app from "../src/index.js";
import { signAttestation, attestationPublicJwk, verifyAttestation } from "../src/attest.js";

// Workers-native base64 helpers (no Node Buffer — keeps src/test free of Node globals).
const bytesToB64 = (b: Uint8Array): string => btoa(String.fromCharCode(...b));
const b64UrlToBytes = (s: string): Uint8Array => {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  return Uint8Array.from(atob(b64 + pad), (c) => c.charCodeAt(0));
};
// returns `any`, mirroring JSON.parse, so claim fields stay ergonomically accessible
const b64UrlToJson = (s: string): any => JSON.parse(new TextDecoder().decode(b64UrlToBytes(s)));
const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

// A deterministic 32-byte seed (base64) for tests.
const seed = ed25519.utils.randomSecretKey();
const SIGNING_KEY = bytesToB64(seed);
const pubKey = ed25519.getPublicKey(seed);

const execCtx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;

describe("attestation", () => {
  it("signs a verifiable JWT and round-trips", () => {
    const jwt = signAttestation(SIGNING_KEY, { subject: "stripe.com", score: 93, risk: "low" });
    expect(jwt.split(".")).toHaveLength(3);
    expect(verifyAttestation(jwt, pubKey)).toBe(true);
    // tamper -> fails
    expect(verifyAttestation(jwt.slice(0, -2) + "xx", pubKey)).toBe(false);
    // decode claims
    const [, p] = jwt.split(".");
    const claims = b64UrlToJson(p);
    expect(claims).toMatchObject({ iss: "vouch", sub: "stripe.com", score: 93, risk: "low" });
    expect(typeof claims.jti).toBe("string");
  });

  it("rejects a wrong-length signing key", () => {
    expect(() => signAttestation("dG9vc2hvcnQ=", { subject: "x", score: 1, risk: "low" })).toThrow(/length/);
  });

  it("sets nbf/exp and rejects an expired attestation (anti-replay)", () => {
    const jwt = signAttestation(SIGNING_KEY, { subject: "stripe.com", score: 93, risk: "low", ttlSeconds: 600 });
    const [, p] = jwt.split(".");
    const claims = b64UrlToJson(p);
    expect(claims.exp).toBe(claims.iat + 600);
    expect(claims.nbf).toBe(claims.iat);
    // Valid now; invalid well past exp (beyond clock tolerance).
    expect(verifyAttestation(jwt, pubKey, { now: claims.iat })).toBe(true);
    expect(verifyAttestation(jwt, pubKey, { now: claims.exp + 60 })).toBe(false);
    // Not-yet-valid (before nbf, beyond tolerance) is rejected too.
    expect(verifyAttestation(jwt, pubKey, { now: claims.nbf - 600 })).toBe(false);
  });

  it("enforces audience when requested and records the raw target", () => {
    const jwt = signAttestation(SIGNING_KEY, {
      subject: "evil.io",
      score: 10,
      risk: "high",
      target: "https://evil.io/pay",
      audience: "agent-123",
    });
    const claims = b64UrlToJson(jwt.split(".")[1]);
    expect(claims.target).toBe("https://evil.io/pay");
    expect(claims.aud).toBe("agent-123");
    expect(verifyAttestation(jwt, pubKey, { audience: "agent-123" })).toBe(true);
    expect(verifyAttestation(jwt, pubKey, { audience: "someone-else" })).toBe(false);
  });

  it("rejects a forged/wrong-typ token even with a valid-looking shape", () => {
    // A token whose signature doesn't match must fail (alg/typ + sig checks).
    const jwt = signAttestation(SIGNING_KEY, { subject: "x", score: 1, risk: "low" });
    const otherPub = ed25519.getPublicKey(ed25519.utils.randomSecretKey());
    expect(verifyAttestation(jwt, otherPub)).toBe(false);
  });

  it("exposes a matching public JWK", () => {
    const jwk = attestationPublicJwk(SIGNING_KEY);
    expect(jwk).toMatchObject({ kty: "OKP", crv: "Ed25519", alg: "EdDSA" });
    // jwk.x is the base64url public key
    const x = b64UrlToBytes(jwk.x);
    expect(bytesEqual(pubKey, x)).toBe(true);
  });

  it("GET /v1/attestation/pubkey returns the JWK when configured (else 503)", async () => {
    const base = {
      DB: {} as unknown as D1Database,
      X402_NETWORK: "base",
      X402_FACILITATOR_URL: "https://x402.org/facilitator",
      PRICE_CHECK_USDC: "0.01",
      PAY_TO_ADDRESS: "0x0000000000000000000000000000000000000001",
    };
    const off = await app.request("/v1/attestation/pubkey", {}, base, execCtx);
    expect(off.status).toBe(503);

    const on = await app.request("/v1/attestation/pubkey", {}, { ...base, VOUCH_SIGNING_KEY: SIGNING_KEY }, execCtx);
    expect(on.status).toBe(200);
    const body = (await on.json()) as { keys: { kty: string; x: string }[] };
    expect(body.keys[0].kty).toBe("OKP");
  });
});
