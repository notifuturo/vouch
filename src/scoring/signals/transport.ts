import type { Signal, Target } from "../../types.js";

/**
 * Transport-level signal: does the target use HTTPS and resolve to a host?
 * Cheap, deterministic, no network.
 */
export function transportSignal(target: Target): Signal {
  if (!target.host) {
    return {
      id: "transport",
      weight: 1.5,
      score: 0,
      detail: "Input did not resolve to a valid host.",
    };
  }
  if (!target.secure) {
    return {
      id: "transport",
      weight: 1.5,
      score: 0.3,
      detail: "Target is not served over HTTPS (or scheme was omitted).",
    };
  }
  return {
    id: "transport",
    weight: 1.5,
    score: 1,
    detail: "Target uses HTTPS.",
  };
}
