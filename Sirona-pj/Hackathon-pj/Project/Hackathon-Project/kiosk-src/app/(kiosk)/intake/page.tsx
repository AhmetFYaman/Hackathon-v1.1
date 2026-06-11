"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import KioskShell from "@/components/KioskShell";
import { useKioskStore } from "@/store/kioskStore";
import type { IntakeData } from "@/store/kioskStore";
import { t } from "@/lib/i18n";

type AgeGroup = IntakeData["ageGroup"];
type Sex = IntakeData["sex"];

// Inline SVG icons — emoji fonts are unreliable on the Pi/secondary displays
const COMPLAINT_ICONS: Record<string, React.ReactNode> = {
  chest_pain: <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />,
  breathing: <path strokeLinecap="round" strokeLinejoin="round" d="M3 8h9a2.5 2.5 0 1 0-2.4-3.2M3 12h14a2.5 2.5 0 1 1-2.4 3.2M3 16h7" />,
  head: <path strokeLinecap="round" strokeLinejoin="round" d="M12 3a6 6 0 0 1 6 6c0 1.7-.7 3.2-1.8 4.3L17 21h-7l-.5-3H8a1 1 0 0 1-1-1v-2.5H5.5a.8.8 0 0 1-.6-1.3L6 11.5A6 6 0 0 1 12 3z" />,
  abdomen: <path strokeLinecap="round" strokeLinejoin="round" d="M8 3v3a4 4 0 0 0 8 0V3M8 21v-2a4 4 0 0 1 8 0v2M12 10v4m-3-2h6" />,
  injury: <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 9.5 5 7a2 2 0 1 1 2-2l2.5 2.5m5 9.5 2.5 2.5a2 2 0 1 0 2-2L16.5 15M9 9l6 6" />,
  fever: <path strokeLinecap="round" strokeLinejoin="round" d="M12 4a2 2 0 0 1 2 2v7.5a4 4 0 1 1-4 0V6a2 2 0 0 1 2-2zm0 11v3" />,
  allergy: <path strokeLinecap="round" strokeLinejoin="round" d="M9.5 4.5 4.5 9.5a3.5 3.5 0 0 0 5 5l5-5a3.5 3.5 0 0 0-5-5zM7 7l5 5m3 1 4 4m-2-6 2 6-6-2" />,
  mental: <path strokeLinecap="round" strokeLinejoin="round" d="M12 4a6 6 0 0 1 6 6c0 3.3-2.7 6-6 6h-1l-3 3v-3.6A6 6 0 0 1 12 4zM9 10h.01M12 10h.01M15 10h.01" />,
  nausea: <path strokeLinecap="round" strokeLinejoin="round" d="M12 3s5 6.1 5 10a5 5 0 0 1-10 0c0-3.9 5-10 5-10zM9.5 14.5a2.5 2.5 0 0 0 2.5 2.5" />,
  dizziness: <path strokeLinecap="round" strokeLinejoin="round" d="M12 12m-2 0a2 2 0 1 0 4 0 2 2 0 1 0-4 0M12 4a8 8 0 0 1 8 8m-3.5 6.5A8 8 0 0 1 4 12m2-5.5L4.5 5M18 17l1.5 1.5" />,
  back_pain: <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v18M9 6h6M9 10h6M9 14h6M9 18h6" />,
  skin: <path strokeLinecap="round" strokeLinejoin="round" d="M5 12 12 5a4.95 4.95 0 0 1 7 7l-7 7a4.95 4.95 0 0 1-7-7zM10 10h.01m4 4h.01m-4 0h.01m4-4h.01" />,
};

const COMPLAINT_GRID = [
  { id: "chest_pain",    key: "complaint_chest"     as const },
  { id: "breathing",     key: "complaint_breathing"  as const },
  { id: "head",          key: "complaint_head"       as const },
  { id: "abdomen",       key: "complaint_abdomen"    as const },
  { id: "injury",        key: "complaint_injury"     as const },
  { id: "fever",         key: "complaint_fever"      as const },
  { id: "allergy",       key: "complaint_allergy"    as const },
  { id: "mental",        key: "complaint_mental"     as const },
  { id: "nausea",        key: "complaint_nausea"     as const },
  { id: "dizziness",     key: "complaint_dizziness"  as const },
  { id: "back_pain",     key: "complaint_back"       as const },
  { id: "skin",          key: "complaint_skin"       as const },
];

const AGE_GROUPS: { value: AgeGroup; keyLabel: "age_under18" | "age_18_40" | "age_41_65" | "age_over65" }[] = [
  { value: "under18",  keyLabel: "age_under18" },
  { value: "18-40",    keyLabel: "age_18_40"   },
  { value: "41-65",    keyLabel: "age_41_65"   },
  { value: "over65",   keyLabel: "age_over65"  },
];

const SEX_OPTIONS: { value: Sex; keyLabel: "sex_male" | "sex_female" | "sex_nonbinary" | "sex_prefer_not" }[] = [
  { value: "male",        keyLabel: "sex_male"        },
  { value: "female",      keyLabel: "sex_female"      },
  { value: "nonbinary",   keyLabel: "sex_nonbinary"   },
  { value: "prefer-not",  keyLabel: "sex_prefer_not"  },
];

const CONDITIONS = [
  { id: "none",         keyLabel: "history_none"         as const },
  { id: "diabetes",     keyLabel: "history_diabetes"     as const },
  { id: "hypertension", keyLabel: "history_hypertension" as const },
  { id: "heart",        keyLabel: "history_heart"        as const },
  { id: "asthma",       keyLabel: "history_asthma"       as const },
  { id: "thinners",     keyLabel: "history_thinners"     as const },
  { id: "cancer",       keyLabel: "history_cancer"       as const },
  { id: "kidney",       keyLabel: "history_kidney"       as const },
  { id: "pregnant",     keyLabel: "history_pregnant"     as const },
];

const ALLERGIES = [
  { id: "none",       keyLabel: "allergy_none"       as const },
  { id: "penicillin", keyLabel: "allergy_penicillin" as const },
  { id: "nsaids",     keyLabel: "allergy_nsaids"     as const },
  { id: "latex",      keyLabel: "allergy_latex"      as const },
  { id: "sulfa",      keyLabel: "allergy_sulfa"      as const },
  { id: "food",       keyLabel: "allergy_food"       as const },
];

// Internal sub-steps within the intake page
const SUB_STEPS = ["complaints", "about", "history"] as const;
type SubStep = typeof SUB_STEPS[number];

export default function IntakePage() {
  const router = useRouter();
  const { setIntake, intake, language } = useKioskStore();

  const [subStep, setSubStep] = useState<SubStep>("complaints");

  // Local form state
  const [complaints, setComplaints] = useState<string[]>(intake?.chiefComplaints ?? []);
  const [ageGroup, setAgeGroup] = useState<AgeGroup>(intake?.ageGroup ?? null);
  const [sex, setSex] = useState<Sex>(intake?.sex ?? null);
  const [weight, setWeight] = useState<string>(intake?.weightKg ? String(intake.weightKg) : "");
  const [conditions, setConditions] = useState<string[]>(intake?.conditions ?? []);
  const [allergies, setAllergies] = useState<string[]>(intake?.allergies ?? []);

  const cameraConsent = intake?.cameraConsent ?? false;

  function toggleMulti<T extends string>(
    list: T[],
    setList: (v: T[]) => void,
    id: T,
    exclusiveIds: T[] = []
  ) {
    if (exclusiveIds.includes(id)) {
      setList(list.includes(id) ? [] : [id]);
    } else {
      const filtered = list.filter((x) => !exclusiveIds.includes(x));
      setList(filtered.includes(id)
        ? filtered.filter((x) => x !== id)
        : [...filtered, id]);
    }
  }

  function canAdvanceComplaints() { return complaints.length > 0; }
  function canAdvanceAbout() { return ageGroup !== null && sex !== null; }

  function goNext() {
    if (subStep === "complaints") setSubStep("about");
    else if (subStep === "about") setSubStep("history");
    else finish();
  }

  function finish() {
    const w = parseFloat(weight);
    setIntake({
      chiefComplaints: complaints,
      chiefComplaintNote: "",
      ageGroup,
      sex,
      weightKg: Number.isFinite(w) && w > 0 ? w : null,
      conditions,
      allergies,
      cameraConsent,
    });
    router.push("/vitals");
  }

  const subIdx = SUB_STEPS.indexOf(subStep);

  return (
    <KioskShell step={2}>
      {/* h-full flex-col: scrollable middle, sticky nav at bottom */}
      <div className="flex flex-col h-full px-5 py-4 gap-3">

        {/* Sub-step dots */}
        <div className="flex items-center gap-3 justify-center shrink-0">
          {SUB_STEPS.map((s, i) => (
            <div
              key={s}
              className={`transition-all duration-300 rounded-full ${
                i < subIdx ? "w-6 h-2 bg-sky-500" :
                i === subIdx ? "w-8 h-2 bg-sky-400" :
                "w-2 h-2 bg-white/20"
              }`}
            />
          ))}
          <span className="text-xs text-slate-500 ml-2">{subIdx + 1} / {SUB_STEPS.length}</span>
        </div>

        {/* Scrollable content area — takes all middle space */}
        <div className="flex-1 min-h-0 overflow-y-auto pb-2">

          {/* ── Sub-step: Complaints ── */}
          {subStep === "complaints" && (
            <div className="flex flex-col gap-3">
              <div>
                <h1 className="text-xl font-bold text-white">{t(language, "intake_title")}</h1>
                <p className="text-slate-400 text-sm mt-0.5">{t(language, "complaint_title")}</p>
              </div>
              {/* Fixed-height grid cells — 3 rows × 4 cols fits without giant tiles */}
              <div className="grid grid-cols-4 gap-2">
                {COMPLAINT_GRID.map(({ id, key }) => {
                  const active = complaints.includes(id);
                  return (
                    <button
                      key={id}
                      onClick={() => toggleMulti(complaints, setComplaints, id)}
                      className={`flex flex-col items-center justify-center gap-1.5 rounded-2xl border transition-all duration-200 active:scale-95 h-[90px] ${
                        active
                          ? "bg-sky-500/20 border-sky-400/60 shadow-sm shadow-sky-500/20"
                          : "bg-white/5 border-white/10 hover:bg-white/10"
                      }`}
                    >
                      <svg
                        className={`w-8 h-8 ${active ? "text-sky-300" : "text-slate-400"}`}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}
                      >
                        {COMPLAINT_ICONS[id]}
                      </svg>
                      <span className={`text-xs font-medium text-center leading-tight px-1 ${active ? "text-sky-300" : "text-slate-300"}`}>
                        {t(language, key)}
                      </span>
                    </button>
                  );
                })}
              </div>
              {complaints.length > 0 && (
                <p className="text-sky-400 text-sm text-center pt-1">{complaints.length} selected</p>
              )}
            </div>
          )}

          {/* ── Sub-step: About ── */}
          {subStep === "about" && (
            <div className="flex flex-col gap-5 max-w-xl mx-auto w-full pt-4">
              <h1 className="text-2xl font-bold text-white text-center">{t(language, "about_title")}</h1>

              {/* Age group */}
              <div>
                <p className="text-slate-400 text-sm mb-2">{t(language, "age_question")}</p>
                <div className="grid grid-cols-2 gap-2">
                  {AGE_GROUPS.map(({ value, keyLabel }) => (
                    <button
                      key={value}
                      onClick={() => setAgeGroup(value)}
                      className={`py-5 rounded-2xl border text-base font-semibold transition-all active:scale-95 ${
                        ageGroup === value
                          ? "bg-sky-500/20 border-sky-400/60 text-sky-300"
                          : "bg-white/5 border-white/10 text-slate-300 hover:bg-white/10"
                      }`}
                    >
                      {t(language, keyLabel)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Sex */}
              <div>
                <p className="text-slate-400 text-sm mb-2">{t(language, "sex_question")}</p>
                <div className="grid grid-cols-2 gap-2">
                  {SEX_OPTIONS.map(({ value, keyLabel }) => (
                    <button
                      key={value}
                      onClick={() => setSex(value)}
                      className={`py-5 rounded-2xl border text-base font-semibold transition-all active:scale-95 ${
                        sex === value
                          ? "bg-sky-500/20 border-sky-400/60 text-sky-300"
                          : "bg-white/5 border-white/10 text-slate-300 hover:bg-white/10"
                      }`}
                    >
                      {t(language, keyLabel)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Weight (optional) */}
              <div>
                <p className="text-slate-400 text-sm mb-2">Weight (optional)</p>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    inputMode="decimal"
                    min={1}
                    max={400}
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
                    placeholder="e.g. 70"
                    className="flex-1 px-4 py-4 rounded-2xl bg-white/5 border border-white/10 text-white text-lg placeholder:text-slate-500 focus:outline-none focus:border-sky-500/60"
                  />
                  <span className="text-slate-400 text-base">kg</span>
                </div>
              </div>
            </div>
          )}

          {/* ── Sub-step: Medical History ── */}
          {subStep === "history" && (
            <div className="flex flex-col gap-4">
              <h1 className="text-xl font-bold text-white">{t(language, "intake_title")}</h1>

              {/* Conditions */}
              <div>
                <p className="text-slate-400 text-sm mb-2">{t(language, "history_title")}</p>
                <div className="grid grid-cols-2 gap-2">
                  {CONDITIONS.map(({ id, keyLabel }) => {
                    const active = conditions.includes(id);
                    return (
                      <button
                        key={id}
                        onClick={() =>
                          toggleMulti(conditions, setConditions, id, id === "none" ? [] : ["none"])
                        }
                        className={`flex items-center gap-2 px-4 py-3.5 rounded-xl border text-sm font-medium transition-all active:scale-95 text-left ${
                          active
                            ? "bg-sky-500/20 border-sky-400/60 text-sky-300"
                            : "bg-white/5 border-white/10 text-slate-300 hover:bg-white/10"
                        }`}
                      >
                        <span className={`w-4 h-4 rounded shrink-0 border flex items-center justify-center ${
                          active ? "bg-sky-500 border-sky-400" : "border-white/30"
                        }`}>
                          {active && <span className="text-white text-xs">✓</span>}
                        </span>
                        {t(language, keyLabel)}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Allergies */}
              <div>
                <p className="text-slate-400 text-sm mb-2">{t(language, "allergy_title")}</p>
                <div className="grid grid-cols-2 gap-2">
                  {ALLERGIES.map(({ id, keyLabel }) => {
                    const active = allergies.includes(id);
                    return (
                      <button
                        key={id}
                        onClick={() =>
                          toggleMulti(allergies, setAllergies, id, id === "none" ? [] : ["none"])
                        }
                        className={`flex items-center gap-2 px-4 py-3.5 rounded-xl border text-sm font-medium transition-all active:scale-95 text-left ${
                          active
                            ? "bg-amber-500/20 border-amber-400/60 text-amber-300"
                            : "bg-white/5 border-white/10 text-slate-300 hover:bg-white/10"
                        }`}
                      >
                        <span className={`w-4 h-4 rounded shrink-0 border flex items-center justify-center ${
                          active ? "bg-amber-500 border-amber-400" : "border-white/30"
                        }`}>
                          {active && <span className="text-white text-xs">✓</span>}
                        </span>
                        {t(language, keyLabel)}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Navigation — always visible at bottom */}
        <div className="flex gap-3 pt-1 shrink-0">
          {subStep !== "complaints" && (
            <button
              onClick={() => setSubStep(SUB_STEPS[subIdx - 1])}
              className="px-6 py-4 rounded-2xl bg-white/10 hover:bg-white/20 text-slate-300 font-semibold text-lg transition-all active:scale-95"
            >
              {t(language, "back")}
            </button>
          )}
          <button
            onClick={goNext}
            disabled={
              (subStep === "complaints" && !canAdvanceComplaints()) ||
              (subStep === "about" && !canAdvanceAbout())
            }
            className="flex-1 py-4 rounded-2xl bg-sky-500 hover:bg-sky-400 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition-all text-white font-bold text-xl"
          >
            {subStep === "history" ? "Continue to Vitals →" : t(language, "continue")}
          </button>
        </div>
      </div>
    </KioskShell>
  );
}
