// Core domain types for Vouch's trust scoring.

/** Risk bands derived from the 0-100 trust score. */
export type RiskBand = "low" | "medium" | "high" | "critical";

/**
 * A single piece of evidence about a target.
 * `score` is normalized 0..1 where 1 = fully trustworthy, 0 = maximally risky.
 * `weight` is the relative importance of this signal (>= 0).
 */
export interface Signal {
  id: string;
  weight: number;
  score: number;
  /** Human/agent-readable explanation of what this signal observed. */
  detail: string;
}

/** A normalized target to assess (e.g. a merchant domain or x402 resource). */
export interface Target {
  /** The raw input the caller provided. */
  raw: string;
  /** Lowercased hostname extracted from the input, if any. */
  host: string | null;
  /** Whether the input used a secure (https) scheme. */
  secure: boolean;
}

/** The result returned to a paying caller. */
export interface TrustResult {
  target: string;
  host: string | null;
  /** 0-100, higher = safer. */
  score: number;
  risk: RiskBand;
  /** Ordered reasons (most impactful first) explaining the score. */
  reasons: string[];
  signals: Signal[];
  /** ISO timestamp of assessment. */
  checkedAt: string;
}

/** Persisted reputation aggregates for a host (the compounding moat). */
export interface ReputationRecord {
  host: string;
  /** Times this host has been checked. */
  checks: number;
  /** Community/agent reports flagging this host as bad. */
  flags: number;
  /** Confirmed-good attestations. */
  vouches: number;
  firstSeen: string;
  lastSeen: string;
}
