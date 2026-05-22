// Dependency-free discovery layer for Vouch.
//
// AI agents and the Agnic/Coinbase/Bazaar registries find Vouch by reading two
// static, machine-readable descriptors:
//   - the canonical x402 v2 resource list  (`/.well-known/x402`)
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

/**
 * Per-network USDC payment asset details: the ERC-20 contract address agents
 * pay in, plus its EIP-712 domain name/version (needed by x402 `extra` so the
 * facilitator can build the EIP-3009 transferWithAuthorization signature).
 */
interface UsdcAsset {
  /** USDC ERC-20 contract address. */
  address: string;
  /** EIP-712 domain `name` field for this USDC deployment. */
  name: string;
  /** EIP-712 domain `version` field. */
  version: string;
}

const USDC_BY_NETWORK: Record<string, UsdcAsset> = {
  "base-sepolia": {
    address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    name: "USDC",
    version: "2",
  },
  base: {
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    name: "USD Coin",
    version: "2",
  },
};

/** USDC has 6 decimal places on every supported network. */
const USDC_DECIMALS = 6;

export interface DiscoveryConfig {
  /** Human network name, e.g. "base-sepolia" or "base". */
  network: string;
  /** USDC price as a decimal string, e.g. "0.001". */
  priceUsdc: string;
  /** Absolute base URL of this deployment, e.g. "https://vouch.example.com". */
  baseUrl: string;
  /** Address that receives x402 payments (advertised so agents know where funds go). */
  payTo?: string;
}

/** Resolve a network name to its CAIP-2 id, or `null` if unknown. */
function caip2(network: string): `${string}:${string}` | null {
  return CAIP2_BY_NETWORK[network] ?? null;
}

/** Strip a single trailing slash so we can safely concatenate paths. */
function trimTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

/**
 * Convert a decimal USDC amount string (e.g. "0.001") to its integer base-unit
 * representation (6 decimals) as a string, e.g. "1000". Done with pure integer
 * string manipulation so there is NO floating-point rounding error:
 *   "0.001"    -> "1000"
 *   "1"        -> "1000000"
 *   "0.000001" -> "1"
 *   "2.5"      -> "2500000"
 *
 * Leading zeros are stripped; "0" maps to "0". The fractional part is padded to
 * 6 digits, or truncated (toward zero) if more precise than USDC supports.
 */
export function usdcBaseUnits(decimalStr: string): string {
  const trimmed = decimalStr.trim();
  const [whole = "0", frac = ""] = trimmed.split(".");

  // Pad the fractional part to exactly USDC_DECIMALS, truncating excess digits.
  const fracPadded = frac.slice(0, USDC_DECIMALS).padEnd(USDC_DECIMALS, "0");

  // Concatenate whole + fractional digits, then strip leading zeros.
  const combined = `${whole}${fracPadded}`.replace(/^0+/, "");
  return combined === "" ? "0" : combined;
}

/**
 * JSON Schema describing the `/v1/check` request body. Used both in the x402
 * `outputSchema.input.body` and as the MCP tool `inputSchema`.
 */
export const CHECK_INPUT_SCHEMA = {
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
export const CHECK_OUTPUT_SCHEMA = {
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

/** A concrete, representative `/v1/check` response for registry previews. */
export const CHECK_OUTPUT_EXAMPLE = {
  score: 87,
  risk: "low",
  reasons: ["Host uses HTTPS", "Not on known threat feeds"],
} as const;

export const CHECK_DESCRIPTION =
  "Counterparty trust & risk check for AI agent payments: given a URL or host, " +
  "returns a 0-100 trust score, a risk band, and the reasons — so an agent can " +
  "decide whether it's safe to pay before sending money. Flags scams, phishing, " +
  "and known-malicious endpoints using threat feeds, domain risk heuristics, and " +
  "a community reputation graph.";

/**
 * Build the canonical x402 v2 / Bazaar discovery descriptor: a list of paid
 * resources, each carrying its accepted payment terms (scheme/network/asset/
 * amount in base units) plus the input/output `outputSchema`. This is what
 * x402-aware agents and the Bazaar/Agnic/Coinbase registries crawl to learn
 * what they can buy here and for how much.
 */
export function buildX402Descriptor(cfg: DiscoveryConfig) {
  const base = trimTrailingSlash(cfg.baseUrl);
  const resource = `${base}/v1/check`;
  const network = caip2(cfg.network);
  const usdc = USDC_BY_NETWORK[cfg.network] ?? null;

  return {
    x402Version: 2,
    resources: [
      {
        resource,
        type: "http",
        x402Version: 2,
        lastUpdated: new Date().toISOString(),
        metadata: {},
        accepts: [
          {
            scheme: "exact",
            network,
            maxAmountRequired: usdcBaseUnits(cfg.priceUsdc),
            asset: usdc?.address ?? null,
            payTo: cfg.payTo ?? "",
            maxTimeoutSeconds: 300,
            resource,
            description: CHECK_DESCRIPTION,
            mimeType: "application/json",
            extra: usdc
              ? { name: usdc.name, version: usdc.version }
              : null,
            outputSchema: {
              input: {
                type: "http",
                method: "POST",
                bodyType: "json",
                body: CHECK_INPUT_SCHEMA,
              },
              output: {
                type: "json",
                format: "application/json",
                schema: CHECK_OUTPUT_SCHEMA,
                example: CHECK_OUTPUT_EXAMPLE,
              },
            },
          },
        ],
      },
    ],
  };
}

/**
 * Build an MCP-style tool manifest: a `tools` array exposing `vouch_check` as a
 * single callable tool with a JSON Schema input. This is a STATIC discoverable
 * descriptor only — it does not implement the MCP transport. The `x402` block
 * tells agents the tool is paid and on which (canonical v2) terms.
 */
export function buildMcpToolManifest(cfg: DiscoveryConfig) {
  const base = trimTrailingSlash(cfg.baseUrl);
  const resource = `${base}/v1/check`;
  const network = caip2(cfg.network);
  const usdc = USDC_BY_NETWORK[cfg.network] ?? null;

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
          x402Version: 2,
          resource,
          method: "POST",
          scheme: "exact",
          priceUsdc: cfg.priceUsdc,
          maxAmountRequired: usdcBaseUnits(cfg.priceUsdc),
          network,
          asset: usdc?.address ?? null,
          payTo: cfg.payTo ?? "",
        },
      },
    ],
  };
}
