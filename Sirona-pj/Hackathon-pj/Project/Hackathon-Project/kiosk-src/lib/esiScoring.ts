import type { VitalsData, BodyRegion, ESILevel } from "@/store/kioskStore";
export type { ESILevel };

// ESI (Emergency Severity Index) scoring logic
// Mirrors clinical ESI v4 triage criteria — final assignment is always confirmed by a nurse.

type ScoringInput = {
  vitals: VitalsData;
  regions: BodyRegion[];
};

function vitalRisk(vitals: VitalsData): number {
  let risk = 0;
  if (vitals.heartRate !== null) {
    if (vitals.heartRate > 150 || vitals.heartRate < 40) risk += 3;
    else if (vitals.heartRate > 100 || vitals.heartRate < 60) risk += 1;
  }
  if (vitals.spO2 !== null) {
    if (vitals.spO2 < 90) risk += 3;
    else if (vitals.spO2 < 94) risk += 2;
  }
  if (vitals.temperature !== null) {
    if (vitals.temperature > 104 || vitals.temperature < 95) risk += 2;
    else if (vitals.temperature > 101 || vitals.temperature < 97) risk += 1;
  }
  return risk;
}

function painRisk(regions: BodyRegion[]): number {
  if (regions.length === 0) return 0;
  const maxPain = Math.max(...regions.map((r) => r.painLevel));
  // Critical regions get extra weight. Self-reported pain is capped at 5 so a
  // 10/10 rating alone cannot reach ESI 1-2 without abnormal vitals.
  const criticalIds = ["chest-left", "chest-right", "head-front", "abdomen"];
  const hasCriticalRegion = regions.some((r) => criticalIds.includes(r.id));
  return Math.min(5, Math.round(maxPain / 2)) + (hasCriticalRegion ? 2 : 0);
}

export function computeESI(input: ScoringInput): { level: ESILevel; rationale: string } {
  const vRisk = vitalRisk(input.vitals);
  const pRisk = painRisk(input.regions);
  const total = vRisk + pRisk;

  // Simplified ESI mapping — nurse always confirms
  if (total >= 12) return { level: 1, rationale: "Immediate life threat suspected — unstable vitals or extreme pain in critical area." };
  if (total >= 8)  return { level: 2, rationale: "High-risk condition — vitals or pain indicate urgent assessment needed within 15 minutes." };
  if (total >= 5)  return { level: 3, rationale: "Multiple resources likely needed — stable vitals, moderate to significant pain." };
  if (total >= 2)  return { level: 4, rationale: "One resource anticipated — mild symptoms with normal vitals." };
  return { level: 5, rationale: "Minor complaint — vitals within normal limits, minimal pain." };
}

export const ESI_LABELS: Record<ESILevel, { label: string; color: string; wait: string }> = {
  1: { label: "Resuscitation",       color: "#ef4444", wait: "Immediate" },
  2: { label: "Emergent",            color: "#f97316", wait: "< 15 min" },
  3: { label: "Urgent",             color: "#facc15", wait: "< 30 min" },
  4: { label: "Less Urgent",        color: "#22c55e", wait: "< 60 min" },
  5: { label: "Non-Urgent",         color: "#06b6d4", wait: "< 120 min" },
};
