import { describe, it, expect } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import app from "../src/index.js";
import { signAttestation, attestationPublicJwk, verifyAttestation } from "../src/attest.js";

// A deterministic 32-byte seed (base64) for tests.
const seed = ed25519.utils.randomSecretKey();
const SIGNING_KEY = Buffer.from(seed).toString("base64");
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
    const claims = JSON.parse(Buffer.from(p, "base64url").toString());
    expect(claims).toMatchObject({ iss: "vouch", sub: "stripe.com", score: 93, risk: "low" });
    expect(typeof claims.jti).toBe("string");
  });

  it("rejects a wrong-length signing key", () => {
    expect(() => signAttestation("dG9vc2hvcnQ=", { subject: "x", score: 1, risk: "low" })).toThrow(/length/);
  });

  it("exposes a matching public JWK", () => {
    const jwk = attestationPublicJwk(SIGNING_KEY);
    expect(jwk).toMatchObject({ kty: "OKP", crv: "Ed25519", alg: "EdDSA" });
    // jwk.x is the base64url public key
    const x = Buffer.from(jwk.x.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    expect(Buffer.from(pubKey).equals(x)).toBe(true);
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
