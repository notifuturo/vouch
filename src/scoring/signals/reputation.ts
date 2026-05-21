import type { ReputationRecord, Signal } from "../../types.js";

/**
 * Reputation signal derived from Vouch's own accumulating data — the part of
 * the product that compounds with usage. Unknown hosts are neutral; community
 * flags pull the score down sharply, vouches nudge it up.
 */
export function reputationSignal(record: ReputationRecord | null): Signal {
  if (!record || (record.checks === 0 && record.flags === 0 && record.vouches === 0)) {
    return {
      id: "reputation",
      weight: 2,
      score: 0.5,
      detail: "No prior reputation data for this host.",
    };
  }

  const { flags, vouches, checks } = record;

  // Flags dominate: each flag is a strong negative, saturating quickly.
  const flagPenalty = Math.min(1, flags / 3);
  // Vouches provide mild positive evidence.
  const vouchBonus = Math.min(0.3, vouches / 20);

  const score = Math.max(0, Math.min(1, 0.6 - flagPenalty + vouchBonus));

  const detail =
    flags > 0
      ? `Reported ${flags} time(s) across ${checks} check(s).`
      : `Seen in ${checks} prior check(s) with ${vouches} vouch(es) and no reports.`;

  return { id: "reputation", weight: 2, score, detail };
}
