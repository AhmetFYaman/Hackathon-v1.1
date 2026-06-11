// HL7 v2.5 ORU^R01 message builder for MediKiosk triage sessions
// Produces a pipe-delimited HL7 message conforming to HL7 v2.5 standard.
// Final output is intended for the Jetson to write to disk and forward to HIS.

import type { VitalsData, BodyRegion, ESILevel } from "@/store/kioskStore";
import type { IntakeData } from "@/store/kioskStore";

const HL7_DATE = (d: Date) =>
  d.toISOString().replace(/[-:T]/g, "").slice(0, 14);

const esc = (v: string | null | undefined) =>
  (v ?? "").replace(/\|/g, "\\F\\").replace(/\^/g, "\\S\\");

function sexCode(sex: IntakeData["sex"]): string {
  if (sex === "male") return "M";
  if (sex === "female") return "F";
  if (sex === "nonbinary") return "O";
  return "U";
}

function ageGroupToDOB(group: IntakeData["ageGroup"]): string {
  const now = new Date();
  let birthYear = now.getFullYear();
  if (group === "under18") birthYear -= 10;
  else if (group === "18-40") birthYear -= 28;
  else if (group === "41-65") birthYear -= 52;
  else if (group === "over65") birthYear -= 72;
  return `${birthYear}0101`;
}

export type HL7Input = {
  sessionId: string;
  timestamp: Date;
  sendingFacility?: string;
  receivingFacility?: string;
  intake: IntakeData;
  vitals: VitalsData;
  regions: BodyRegion[];
  esiLevel: ESILevel;
  esiRationale: string;
  // AI-inferred (may be null if camera was declined or AI unavailable)
  estimatedAge?: number | null;
  estimatedHeightCm?: number | null;
  estimatedWeightKg?: number | null;
};

export function buildHL7(input: HL7Input): string {
  const ts = HL7_DATE(input.timestamp);
  const msgId = `MK-${input.sessionId.slice(0, 8).toUpperCase()}-${Date.now()}`;
  const sf = esc(input.sendingFacility ?? "MEDIKIOSK");
  const rf = esc(input.receivingFacility ?? "HOSPITAL-HIS");

  const maxPain = input.regions.length
    ? Math.max(...input.regions.map((r) => r.painLevel))
    : 0;

  const chiefComplaints = input.intake.chiefComplaints.length
    ? input.intake.chiefComplaints.join(", ")
    : "Not specified";

  const conditionsStr = input.intake.conditions.length
    ? input.intake.conditions.join(", ")
    : "None reported";

  const allergiesStr = input.intake.allergies.length
    ? input.intake.allergies.join(", ")
    : "NKDA";

  const painRegionsStr = input.regions
    .map((r) => `${r.label}(${r.painLevel}/10)`)
    .join(", ");

  // MSH - Message Header
  const msh = [
    "MSH",
    "^~\\&",
    sf,
    "ER01",
    rf,
    "HIS",
    ts,
    "",
    "ORU^R01^ORU_R01",
    msgId,
    "P",
    "2.5",
    "",
    "",
    "",
    "",
    "AL",
    "AL",
    "",
    "",
    "",
    "NE",
  ].join("|");

  // PID - Patient Identification (anonymous kiosk session)
  const dob = ageGroupToDOB(input.intake.ageGroup);
  const pid = [
    "PID",
    "1",
    "",
    `KIOSK-${input.sessionId.slice(0, 12).toUpperCase()}^^^MEDIKIOSK^PI`,
    "",
    "UNKNOWN^PATIENT^^",
    "",
    dob,
    sexCode(input.intake.sex),
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "N",
  ].join("|");

  // PV1 - Patient Visit (Emergency)
  const pv1 = [
    "PV1",
    "1",
    "E",
    "ER01^EMERGENCY^ER",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    ts,
  ].join("|");

  // AL1 - Allergy segments
  const al1Segments = input.intake.allergies
    .filter((a) => a !== "none")
    .map((allergy, i) =>
      `AL1|${i + 1}||DA^${esc(allergy)}^L||UNKNOWN`
    );

  // OBR - Observation Request (triage)
  const obr = [
    "OBR",
    "1",
    "",
    `${msgId}-OBR`,
    "TRIAGE^Emergency Triage^LOCAL",
    "",
    "",
    ts,
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    `${sf}^${sf}`,
    "",
    "",
    "",
    "F",
  ].join("|");

  // OBX segments - Observations
  const obxRows: string[][] = [];
  let obxSeq = 1;

  // Heart rate
  if (input.vitals.heartRate !== null) {
    obxRows.push([
      "OBX", `${obxSeq++}`, "NM",
      "8867-4^Heart rate^LN", "",
      `${input.vitals.heartRate}`, "/min", "60-100",
      input.vitals.heartRate > 100 || input.vitals.heartRate < 60 ? "A" : "N",
      "", "", "F", "", "", ts,
    ]);
  }

  // SpO2
  if (input.vitals.spO2 !== null) {
    obxRows.push([
      "OBX", `${obxSeq++}`, "NM",
      "59408-5^Oxygen saturation in Arterial blood by Pulse oximetry^LN", "",
      `${input.vitals.spO2}`, "%", "95-100",
      input.vitals.spO2 < 95 ? "L" : "N",
      "", "", "F", "", "", ts,
    ]);
  }

  // Temperature (convert °F to °C for HL7 standard)
  if (input.vitals.temperature !== null) {
    const tempC = parseFloat(((input.vitals.temperature - 32) * 5 / 9).toFixed(1));
    obxRows.push([
      "OBX", `${obxSeq++}`, "NM",
      "8310-5^Body temperature^LN", "",
      `${tempC}`, "Cel", "36.1-37.5",
      tempC > 38 || tempC < 36 ? "A" : "N",
      "", "", "F", "", "", ts,
    ]);
  }

  // Blood pressure (if available)
  if (input.vitals.bloodPressureSystolic !== null && input.vitals.bloodPressureDiastolic !== null) {
    obxRows.push([
      "OBX", `${obxSeq++}`, "NM",
      "55284-4^Blood pressure^LN", "",
      `${input.vitals.bloodPressureSystolic}^${input.vitals.bloodPressureDiastolic}`, "mm[Hg]", "90-140/60-90",
      "N", "", "", "F", "", "", ts,
    ]);
  }

  // Chief complaint
  obxRows.push([
    "OBX", `${obxSeq++}`, "ST",
    "11449-6^Reason for visit Narrative^LN", "",
    esc(chiefComplaints), "", "", "", "", "", "F", "", "", ts,
  ]);

  // Pain score
  obxRows.push([
    "OBX", `${obxSeq++}`, "NM",
    "72514-3^Pain severity - 0-10 verbal numeric rating^LN", "",
    `${maxPain}`, "{score}", "0-10",
    maxPain >= 7 ? "H" : maxPain >= 4 ? "N" : "L",
    "", "", "F", "", "", ts,
  ]);

  // Pain locations
  if (painRegionsStr) {
    obxRows.push([
      "OBX", `${obxSeq++}`, "ST",
      "38208-5^Pain location^LN", "",
      esc(painRegionsStr), "", "", "", "", "", "F", "", "", ts,
    ]);
  }

  // Medical conditions
  obxRows.push([
    "OBX", `${obxSeq++}`, "ST",
    "8653-6^Medical history^LN", "",
    esc(conditionsStr), "", "", "", "", "", "F", "", "", ts,
  ]);

  // Allergies (summary)
  obxRows.push([
    "OBX", `${obxSeq++}`, "ST",
    "52473-6^Allergy and Adverse drug reaction^LN", "",
    esc(allergiesStr), "", "", "", "", "", "F", "", "", ts,
  ]);

  // ESI Level
  const esiLabels: Record<ESILevel, string> = {
    1: "Resuscitation",
    2: "Emergent",
    3: "Urgent",
    4: "Less Urgent",
    5: "Non-Urgent",
  };
  obxRows.push([
    "OBX", `${obxSeq++}`, "CE",
    "ESI^Emergency Severity Index^LOCAL", "",
    `${input.esiLevel}^${esiLabels[input.esiLevel]}^LOCAL`,
    "", "1-5", input.esiLevel <= 2 ? "H" : "N",
    "", "", "F", "", "", ts,
  ]);

  // ESI rationale
  obxRows.push([
    "OBX", `${obxSeq++}`, "ST",
    "ESI-RAT^ESI Rationale^LOCAL", "",
    esc(input.esiRationale), "", "", "", "", "", "F", "", "", ts,
  ]);

  // AI-inferred age (if available)
  if (input.estimatedAge != null) {
    obxRows.push([
      "OBX", `${obxSeq++}`, "NM",
      "29553-5^Age estimated^LOCAL", "",
      `${input.estimatedAge}`, "a", "", "", "", "", "F", "", "", ts,
    ]);
  }

  // AI-inferred height (if available)
  if (input.estimatedHeightCm != null) {
    obxRows.push([
      "OBX", `${obxSeq++}`, "NM",
      "8302-2^Body height^LN", "",
      `${input.estimatedHeightCm}`, "cm", "", "", "", "", "F", "", "", ts,
    ]);
  }

  // AI-inferred weight (if available)
  if (input.estimatedWeightKg != null) {
    obxRows.push([
      "OBX", `${obxSeq++}`, "NM",
      "29463-7^Body weight^LN", "",
      `${input.estimatedWeightKg}`, "kg", "", "", "", "", "F", "", "", ts,
    ]);
  }

  // ZTR - Custom Triage segment (non-standard, hospital-specific extension)
  const ztr = [
    "ZTR",
    "1",
    `${input.esiLevel}`,
    esc(esiLabels[input.esiLevel]),
    esc(input.esiRationale.slice(0, 80)),
    `${maxPain}`,
    input.vitals.heartRate?.toString() ?? "",
    input.vitals.spO2?.toString() ?? "",
    input.vitals.temperature?.toString() ?? "",
    `${input.vitals.bloodPressureSystolic ?? ""}/${input.vitals.bloodPressureDiastolic ?? ""}`,
    input.intake.ageGroup,
    sexCode(input.intake.sex),
    esc(conditionsStr.slice(0, 60)),
    esc(allergiesStr.slice(0, 60)),
    input.intake.cameraConsent ? "Y" : "N",
  ].join("|");

  const segments = [
    msh,
    pid,
    pv1,
    ...al1Segments,
    obr,
    ...obxRows.map((r) => r.join("|")),
    ztr,
  ];

  return segments.join("\r\n");
}
