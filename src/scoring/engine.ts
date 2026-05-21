import type { RiskBand, Signal, TrustResult, Target } from "../types.js";

/** Map a 0-100 score to a coarse risk band. */
export function toRiskBand(score: number): RiskBand {
  if (score >= 75) return "low";
  if (score >= 50) return "medium";
  if (score >= 25) return "high";
  return "critical";
}

/**
 * Combine weighted signals into a 0-100 trust score.
 *
 * The aggregate is a weighted average of each signal's normalized score, with
 * one safety override: any signal scoring <= 0.05 (a hard negative, e.g. a
 * threat-feed hit) caps the overall score so a single strong red flag cannot
 * be averaged away by benign signals.
 */
export function aggregate(signals: Signal[]): number {
  const usable = signals.filter((s) => s.weight > 0);
  if (usable.length === 0) return 50; // no evidence -> neutral

  const totalWeight = usable.reduce((sum, s) => sum + s.weight, 0);
  const weighted = usable.reduce((sum, s) => sum + clamp01(s.score) * s.weight, 0);
  let score = (weighted / totalWeight) * 100;

  const hardNegative = usable.find((s) => s.score <= 0.05);
  if (hardNegative) score = Math.min(score, 15);

  return Math.round(clamp(score, 0, 100));
}

/** Build the final result, ordering reasons by impact (lowest score first). */
export function buildResult(target: Target, signals: Signal[]): TrustResult {
  const score = aggregate(signals);
  const reasons = [...signals]
    .sort((a, b) => a.score * a.weight - b.score * b.weight)
    .map((s) => s.detail);

  return {
    target: target.raw,
    host: target.host,
    score,
    risk: toRiskBand(score),
    reasons,
    signals,
    checkedAt: new Date().toISOString(),
  };
}

function clamp01(n: number): number {
  return clamp(n, 0, 1);
}

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
