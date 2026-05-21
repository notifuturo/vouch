import type { ReputationRecord, TrustResult } from "../types.js";
import { buildResult } from "./engine.js";
import { parseTarget } from "./target.js";
import { transportSignal } from "./signals/transport.js";
import { domainHeuristicsSignal } from "./signals/domainHeuristics.js";
import { threatFeedSignal, type DenylistLookup } from "./signals/threatFeed.js";
import { reputationSignal } from "./signals/reputation.js";

export interface AssessDeps {
  isDenied: DenylistLookup;
  getReputation: (host: string) => Promise<ReputationRecord | null>;
}

/**
 * Assess a raw target string end-to-end: parse, gather every signal, and
 * fold them into an explainable {@link TrustResult}.
 */
export async function assess(raw: string, deps: AssessDeps): Promise<TrustResult> {
  const target = parseTarget(raw);

  const [threat, reputationRecord] = await Promise.all([
    threatFeedSignal(target, deps.isDenied),
    target.host ? deps.getReputation(target.host) : Promise.resolve(null),
  ]);

  const signals = [
    transportSignal(target),
    domainHeuristicsSignal(target),
    threat,
    reputationSignal(reputationRecord),
  ];

  return buildResult(target, signals);
}
