import { create } from "zustand";
import type { LangCode } from "@/lib/i18n";

export type BodyRegion = {
  id: string;
  label: string;
  x: number;
  y: number;
  painLevel: number; // 0-10
};

export type VitalsData = {
  heartRate: number | null;
  spO2: number | null;
  temperature: number | null;
  bloodPressureSystolic: number | null;
  bloodPressureDiastolic: number | null;
  status: "idle" | "measuring" | "done";
};

export type IntakeData = {
  chiefComplaints: string[];
  chiefComplaintNote: string;
  ageGroup: "under18" | "18-40" | "41-65" | "over65" | null;
  sex: "male" | "female" | "nonbinary" | "prefer-not" | null;
  weightKg: number | null;
  conditions: string[];   // e.g. ["diabetes", "hypertension"]
  allergies: string[];    // e.g. ["penicillin", "latex"]
  cameraConsent: boolean;
};

export type ESILevel = 1 | 2 | 3 | 4 | 5;

export type JetsonResult = {
  esiLevel: ESILevel;
  esiRationale: string;
  estimatedAge: number | null;
  estimatedHeightCm: number | null;
  estimatedWeightKg: number | null;
  hl7Path: string | null;
  source: "jetson" | "local";
  // rPPG-derived vitals from the 5-second video
  bpSystolicVideo?: number | null;
  bpDiastolicVideo?: number | null;
  bpConfidenceVideo?: number | null;
  bpFromVideo?: boolean;
  respiratoryRateVideo?: number | null;
  heartRateVideo?: number | null;
  // LLM clinical reasoning
  redFlags?: string[];
  recommendedAction?: string | null;
  // ESI source breakdown (for transparency)
  esiSources?: {
    rules: number;
    rfModel: number;
    rfConfidence: number;
    llm: number | null;
    llmAvailable: boolean;
  };
};

type KioskState = {
  sessionId: string;
  language: LangCode;
  consentGiven: boolean;
  firstName: string;
  lastName: string;
  intake: IntakeData | null;
  vitals: VitalsData;
  selectedRegions: BodyRegion[];
  esiLevel: ESILevel | null;
  esiRationale: string;
  queuePosition: number | null;
  jetsonResult: JetsonResult | null;
  videoRecordingTriggered: boolean;

  setLanguage: (lang: LangCode) => void;
  setConsent: (v: boolean) => void;
  setName: (first: string, last: string) => void;
  setIntake: (data: IntakeData) => void;
  setVitals: (v: Partial<VitalsData>) => void;
  addRegion: (region: BodyRegion) => void;
  removeRegion: (id: string) => void;
  updateRegionPain: (id: string, level: number) => void;
  setResult: (esi: ESILevel, queue: number, rationale?: string) => void;
  setJetsonResult: (r: JetsonResult) => void;
  setVideoRecordingTriggered: (v: boolean) => void;
  resetSession: () => void;
};

const freshVitals = (): VitalsData => ({
  heartRate: null,
  spO2: null,
  temperature: null,
  bloodPressureSystolic: null,
  bloodPressureDiastolic: null,
  status: "idle",
});

const freshIntake = (): IntakeData => ({
  chiefComplaints: [],
  chiefComplaintNote: "",
  ageGroup: null,
  sex: null,
  weightKg: null,
  conditions: [],
  allergies: [],
  cameraConsent: false,
});

function makeSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for HTTP contexts (Pi browses via plain HTTP)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export const useKioskStore = create<KioskState>((set) => ({
  sessionId: makeSessionId(),
  language: "en",
  consentGiven: false,
  firstName: "",
  lastName: "",
  intake: null,
  vitals: freshVitals(),
  selectedRegions: [],
  esiLevel: null,
  esiRationale: "",
  queuePosition: null,
  jetsonResult: null,
  videoRecordingTriggered: false,

  setLanguage: (lang) => set({ language: lang }),
  setConsent: (v) => set({ consentGiven: v }),
  setName: (first, last) => set({ firstName: first.trim(), lastName: last.trim() }),
  setIntake: (data) => set({ intake: data }),
  setVitals: (v) => set((s) => ({ vitals: { ...s.vitals, ...v } })),
  addRegion: (region) =>
    set((s) => ({
      selectedRegions: s.selectedRegions.find((r) => r.id === region.id)
        ? s.selectedRegions
        : [...s.selectedRegions, region],
    })),
  removeRegion: (id) =>
    set((s) => ({ selectedRegions: s.selectedRegions.filter((r) => r.id !== id) })),
  updateRegionPain: (id, level) =>
    set((s) => ({
      selectedRegions: s.selectedRegions.map((r) =>
        r.id === id ? { ...r, painLevel: level } : r
      ),
    })),
  setResult: (esi, queue, rationale = "") =>
    set({ esiLevel: esi, queuePosition: queue, esiRationale: rationale }),
  setJetsonResult: (r) =>
    set({ jetsonResult: r, esiLevel: r.esiLevel, esiRationale: r.esiRationale }),
  setVideoRecordingTriggered: (v) => set({ videoRecordingTriggered: v }),
  resetSession: () =>
    set((s) => ({
      sessionId: makeSessionId(),
      language: s.language, // preserve language between sessions
      consentGiven: false,
      firstName: "",
      lastName: "",
      intake: null,
      vitals: freshVitals(),
      selectedRegions: [],
      esiLevel: null,
      esiRationale: "",
      queuePosition: null,
      jetsonResult: null,
      videoRecordingTriggered: false,
    })),
}));
