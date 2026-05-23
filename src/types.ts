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
  /** Community/agent reports flagging this host as bad (raw count, for audit/stats). */
  flags: number;
  /** Confirmed-good attestations (raw count, for audit/stats). */
  vouches: number;
  /**
   * Reporter-standing-weighted flag total. Each counted flag contributes a
   * fraction in (0,1] based on the reporting source's tenure, so a swarm of
   * fresh/anonymous identities can't move a host's verdict as cheaply as
   * established reporters (reputation-poisoning resistance). Optional: legacy
   * records and the in-memory path may omit it, in which case the scoring
   * signal falls back to the raw `flags` count.
   */
  flagWeight?: number;
  /** Reporter-standing-weighted vouch total (see {@link flagWeight}). */
  vouchWeight?: number;
  firstSeen: string;
  lastSeen: string;
}
