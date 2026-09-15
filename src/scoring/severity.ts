export type RiskBand = "low" | "moderate" | "high" | "critical";

export function bandForScore(score: number): RiskBand {
  if (score >= 70) return "critical";
  if (score >= 40) return "high";
  if (score >= 20) return "moderate";
  return "low";
}
