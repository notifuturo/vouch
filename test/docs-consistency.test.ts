import { describe, it, expect } from "vitest";
import wranglerToml from "../wrangler.toml?raw";
import submissions from "../docs/SUBMISSIONS.md?raw";
import readme from "../README.md?raw";

// Anti-staleness guard. The 2026-05-22 mainnet flip left public docs claiming
// "Base Sepolia (testnet)" and the wrong price for a day. This pins the public
// copy to the DEPLOYED config (wrangler.toml = source of truth): if someone
// changes the network/price and forgets to update the docs, this test fails.

const network = /X402_NETWORK\s*=\s*"([^"]+)"/.exec(wranglerToml)?.[1];
const price = /PRICE_CHECK_USDC\s*=\s*"([^"]+)"/.exec(wranglerToml)?.[1];
const publicCopy = { "SUBMISSIONS.md": submissions, "README.md": readme };

describe("docs stay consistent with deployed config", () => {
  it("wrangler.toml declares X402_NETWORK and PRICE_CHECK_USDC", () => {
    expect(network).toBeTruthy();
    expect(price).toBeTruthy();
  });

  it("public copy advertises the deployed price", () => {
    for (const [name, doc] of Object.entries(publicCopy)) {
      expect(doc, `${name} should mention the live price $${price}`).toContain(`$${price}`);
    }
  });

  it("public copy does not contradict the deployed network", () => {
    const onMainnet = network === "base";
    // Current-status claims for the WRONG network, plus the superseded price.
    const stale: RegExp[] = onMainnet
      ? [/currently Base Sepolia/i, /live[, ] *on Base Sepolia/i, /\$0\.001\b/]
      : [/LIVE on Base mainnet/i];
    for (const [name, doc] of Object.entries(publicCopy)) {
      for (const bad of stale) {
        expect(doc, `${name} contains a stale claim: ${bad}`).not.toMatch(bad);
      }
    }
  });
});
