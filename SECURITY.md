# Security Policy

Vouch is a live payment-trust API for AI agents that handles real funds (x402 /
USDC on Base mainnet). We take security seriously and welcome responsible
disclosure.

## Reporting a vulnerability

**Please do not open a public issue or PR for security problems.**

- Preferred: open a private [GitHub Security Advisory](https://github.com/notifuturo/vouch/security/advisories/new).
- Or email the maintainer (see the GitHub profile of `notifuturo`).

Please include: a description, affected endpoint/component, reproduction steps,
and impact. A minimal proof-of-concept helps. **Do not** send real payments,
exfiltrate data, run denial-of-service tests, or poison the reputation dataset
as part of testing.

We aim to acknowledge within 72 hours and to keep you updated on remediation.

## Scope

In scope: the Vouch Worker (`src/`), its API (`https://vouch.futuronoti.workers.dev`),
the published `vouch-sdk`, and the MCP server.

Out of scope: third-party dependencies (report upstream), the public threat feed,
volumetric DoS, and findings that require a compromised operator account/device.

## Good to know

- The API is fully public and credential-free; the paid path is gated by x402
  payment, not by secrets in requests.
- Payment verification/settlement is delegated to the Coinbase CDP facilitator.
- Attestations are Ed25519-signed JWTs with a short validity window; verify them
  against `GET /v1/attestation/pubkey`.
