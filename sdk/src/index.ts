/**
 * vouch-sdk — tiny client + payment guard for Vouch.
 *
 * Check a counterparty's trust BEFORE your AI agent pays it. Zero runtime
 * dependencies (uses the global `fetch`). Works in Node 18+, browsers, Workers,
 * and Deno/Bun.
 *
 * Quick start (buyer-side gating):
 *
 *   import { assertTrusted } from "vouch-sdk";
 *   await assertTrusted("https://some-merchant.com", { minScore: 75 }); // throws if risky
 *   await payTheMerchant();
 */

export type RiskBand = "low" | "medium" | "high" | "critical";

/** Free-tier result (`POST /v1/score`). */
export interface ScoreResult {
  target: string;
  host: string | null;
  score: number;
  risk: RiskBand;
}

/** Paid result (`POST /v1/check`) — adds the explainable reasons + signals. */
export interface CheckResult extends ScoreResult {
  reasons: string[];
  signals: { id: string; weight: number; score: number; detail: string }[];
  checkedAt: string;
}

export interface VouchClientOptions {
  /** Vouch base URL. Defaults to the public deployment. */
  baseUrl?: string;
  /** Custom fetch (e.g. a test stub). Defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

const DEFAULT_BASE = "https://vouch.futuronoti.workers.dev";

/** Thrown by {@link assertTrusted} when a target scores below the threshold. */
export class VouchBlockedError extends Error {
  constructor(
    readonly result: ScoreResult,
    readonly minScore: number,
  ) {
    super(
      `Vouch blocked "${result.target}": score ${result.score} < ${minScore} (${result.risk} risk)`,
    );
    this.name = "VouchBlockedError";
  }
}

export class VouchClient {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: VouchClientOptions = {}) {
    this.base = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
    this.fetchImpl = opts.fetch ?? fetch;
  }

  /** FREE: score + risk band only. */
  async score(target: string): Promise<ScoreResult> {
    return this.post<ScoreResult>("/v1/score", { target }, this.fetchImpl);
  }

  /**
   * PAID: full verdict including explainable `reasons`. Pass an x402-capable
   * fetch (e.g. `wrapFetchWithPayment(fetch, client)` from `@x402/fetch`) so the
   * 402 -> pay -> retry handshake is handled automatically.
   */
  async check(target: string, payFetch?: typeof fetch): Promise<CheckResult> {
    return this.post<CheckResult>("/v1/check", { target }, payFetch ?? this.fetchImpl);
  }

  /** Convenience: is the target's free score >= `minScore` (default 70)? */
  async isSafe(target: string, minScore = 70): Promise<boolean> {
    return (await this.score(target)).score >= minScore;
  }

  private async post<T>(path: string, body: unknown, f: typeof fetch): Promise<T> {
    const res = await f(`${this.base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Vouch ${path} failed: HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  }
}

export interface AssertTrustedOptions {
  /** Minimum acceptable score (0-100). Default 70. */
  minScore?: number;
  /** Reuse an existing client. */
  client?: VouchClient;
  /** Or just point at a base URL. */
  baseUrl?: string;
}

/**
 * Guard an outbound payment: resolves with the {@link ScoreResult} if the
 * target is trusted, or throws {@link VouchBlockedError} if its score is below
 * `minScore`. Uses the FREE tier (no payment needed to gate).
 */
export async function assertTrusted(
  target: string,
  opts: AssertTrustedOptions = {},
): Promise<ScoreResult> {
  const client = opts.client ?? new VouchClient(opts.baseUrl ? { baseUrl: opts.baseUrl } : {});
  const minScore = opts.minScore ?? 70;
  const result = await client.score(target);
  if (result.score < minScore) {
    throw new VouchBlockedError(result, minScore);
  }
  return result;
}
