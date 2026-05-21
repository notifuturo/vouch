// Dependency-free discovery layer for Vouch.
//
// AI agents and the Agnic/Coinbase registries find Vouch by reading two static,
// machine-readable descriptors:
//   - an x402 "bazaar"-style resource list  (`/.well-known/x402`)
//   - an MCP-style tool manifest             (`/mcp/tools`)
//
// All builders here are PURE: they take a {@link DiscoveryConfig} and return a
// plain JSON-serializable object. No I/O, no Hono, no SDKs — so index.ts can
// just `c.json(buildX402Descriptor(cfg))` and the logic stays unit-testable.

/** Map a human network name to its CAIP-2 chain id (mirrors payments.ts). */
const CAIP2_BY_NETWORK: Record<string, `${string}:${string}`> = {
  "base-sepolia": "eip155:84532",
  base: "eip155:8453",
};

/** USDC contract address per network (the asset agents pay in). */
const USDC_ADDRESS_BY_NETWORK: Record<string, string> = {
  "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
};

export interface DiscoveryConfig {
  /** Human network name, e.g. "base-sepolia" or "base". */
  network: string;
  /** USDC price as a decimal string, e.g. "0.001". */
  priceUsdc: string;
  /** Absolute base URL of this deployment, e.g. "https://vouch.example.com". */
  baseUrl: string;
}

/** Resolve a network name to its CAIP-2 id, or `null` if unknown. */
function caip2(network: string): `${string}:${string}` | null {
  return CAIP2_BY_NETWORK[network] ?? null;
}

/** Strip a single trailing slash so we can safely concatenate paths. */
function trimTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

/** JSON Schema describing the `/v1/check` request body. */
const CHECK_INPUT_SCHEMA = {
  type: "object",
  properties: {
    target: {
      type: "string",
      description: "Counterparty to assess: a URL, hostname, or x402 resource.",
    },
  },
  required: ["target"],
  additionalProperties: false,
} as const;

/** JSON Schema describing the `/v1/check` response body (the trust verdict). */
const CHECK_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    score: {
      type: "number",
      minimum: 0,
      maximum: 100,
      description: "Trust score, 0-100 (higher = safer).",
    },
    risk: {
      type: "string",
      enum: ["low", "medium", "high", "critical"],
      description: "Risk band derived from the score.",
    },
    reasons: {
      type: "array",
      items: { type: "string" },
      description: "Ordered, human-readable reasons explaining the score.",
    },
  },
  required: ["score", "risk", "reasons"],
} as const;

const CHECK_DESCRIPTION =
  "Assess whether a counterparty is safe to pay. Returns an explainable trust " +
  "score (0-100), a risk band, and the reasons behind the verdict.";

/**
 * Build the x402 discovery descriptor (the "bazaar" convention): a list of paid
 * resources, each with its accepted payment terms (scheme/price/network/asset)
 * and input/output schemas. This is what x402-aware agents and registries crawl
 * to learn what they can buy here and for how much.
 */
export function buildX402Descriptor(cfg: DiscoveryConfig) {
  const base = trimTrailingSlash(cfg.baseUrl);
  const network = caip2(cfg.network);
  const asset = USDC_ADDRESS_BY_NETWORK[cfg.network] ?? null;

  return {
    x402Version: 1,
    resources: [
      {
        resource: `${base}/v1/check`,
        path: "/v1/check",
        method: "POST",
        description: CHECK_DESCRIPTION,
        mimeType: "application/json",
        accepts: [
          {
            scheme: "exact",
            price: `$${cfg.priceUsdc}`,
            priceUsdc: cfg.priceUsdc,
            network,
            asset: {
              symbol: "USDC",
              address: asset,
            },
          },
        ],
        input: {
          type: "http",
          method: "POST",
          schema: CHECK_INPUT_SCHEMA,
        },
        output: {
          schema: CHECK_OUTPUT_SCHEMA,
        },
      },
    ],
  };
}

/**
 * Build an MCP-style tool manifest: a `tools` array exposing `vouch_check` as a
 * single callable tool with a JSON Schema input. This is a STATIC discoverable
 * descriptor only — it does not implement the MCP transport. The `x402` block
 * tells agents the tool is paid and on which terms.
 */
export function buildMcpToolManifest(cfg: DiscoveryConfig) {
  const base = trimTrailingSlash(cfg.baseUrl);

  return {
    tools: [
      {
        name: "vouch_check",
        description:
          `${CHECK_DESCRIPTION} Paid per call in USDC via the x402 protocol ` +
          `(no API key required).`,
        inputSchema: CHECK_INPUT_SCHEMA,
        outputSchema: CHECK_OUTPUT_SCHEMA,
        x402: {
          paid: true,
          resource: `${base}/v1/check`,
          method: "POST",
          price: `$${cfg.priceUsdc}`,
          priceUsdc: cfg.priceUsdc,
          network: caip2(cfg.network),
          asset: "USDC",
        },
      },
    ],
  };
}
