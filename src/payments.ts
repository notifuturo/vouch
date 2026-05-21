import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import type { MiddlewareHandler } from "hono";

/** Map a human network name to its CAIP-2 chain id. */
const NETWORKS: Record<string, `${string}:${string}`> = {
  "base-sepolia": "eip155:84532",
  base: "eip155:8453",
};

export interface PaymentConfig {
  network: string;
  facilitatorUrl: string;
  payTo: string;
  /** USDC price as a decimal string, e.g. "0.001". */
  priceUsdc: string;
}

/**
 * Build the x402 payment middleware that gates `POST /v1/check`. Routes not
 * listed here pass through free (health, reporting, info).
 */
export function createPaymentGate(cfg: PaymentConfig): MiddlewareHandler {
  const caip2 = NETWORKS[cfg.network];
  if (!caip2) {
    throw new Error(`Unsupported X402_NETWORK "${cfg.network}" (use base-sepolia or base)`);
  }

  const facilitator = new HTTPFacilitatorClient({ url: cfg.facilitatorUrl });
  const server = new x402ResourceServer(facilitator).register(caip2, new ExactEvmScheme());

  return paymentMiddleware(
    {
      "POST /v1/check": {
        accepts: [
          {
            scheme: "exact",
            price: `$${cfg.priceUsdc}`,
            network: caip2,
            payTo: cfg.payTo,
          },
        ],
        description: "Vouch payment trust check — risk score for a counterparty.",
        mimeType: "application/json",
      },
    },
    server,
  );
}
