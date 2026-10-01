export interface RiskSignal {
  name: string;
  weight: number;
  /** Normalized 0..1, where 1 is maximally risky for this signal. */
  value: number;
}

export interface RiskAssessment {
  score: number; // 0..1, higher = riskier
  action: "allow" | "challenge" | "block";
  signals: RiskSignal[];
}

export interface RiskThresholds {
  challenge: number; // score >= this => escalate to a harder challenge
  block: number; // score >= this => block outright
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/**
 * A deliberately simple, transparent weighted-sum risk scorer. This is
 * a heuristic signal for deciding how much friction to apply -- NOT
 * proof of human identity, and not a substitute for the challenge
 * itself. Feed it only signals you already have a legitimate reason to
 * collect (request rate, failure history, token reuse); avoid
 * invasive fingerprinting. See docs/limitations.md and
 * docs/threat-model.md.
 */
export function assessRisk(signals: RiskSignal[], thresholds: RiskThresholds): RiskAssessment {
  const totalWeight = signals.reduce((sum, s) => sum + s.weight, 0) || 1;
  const score = signals.reduce((sum, s) => sum + s.weight * clamp01(s.value), 0) / totalWeight;

  const action: RiskAssessment["action"] =
    score >= thresholds.block ? "block" : score >= thresholds.challenge ? "challenge" : "allow";

  return { score, action, signals };
}
