"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import KioskShell from "@/components/KioskShell";
import { useKioskStore } from "@/store/kioskStore";
import { t } from "@/lib/i18n";

export default function ConsentPage() {
  const router = useRouter();
  const { setConsent, setName, setIntake, intake, language } = useKioskStore();

  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [cameraOk, setCameraOk] = useState(true);

  function accept() {
    setConsent(true);
    setName(first, last);
    setIntake({
      ...(intake ?? {
        chiefComplaints: [], chiefComplaintNote: "",
        ageGroup: null, sex: null, weightKg: null,
        conditions: [], allergies: [],
        cameraConsent: false,
      }),
      cameraConsent: cameraOk,
    });
    if (cameraOk) {
      // Arm the one-time 5-second recording (captured on the vitals step)
      fetch("/api/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "consent_given" }),
      }).catch(() => {});
    }
    router.push("/intake");
  }

  return (
    <KioskShell step={1}>
      <div className="flex flex-col justify-center h-full px-6 py-6 gap-4 max-w-2xl mx-auto w-full">

        {/* Title */}
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-sky-500 flex items-center justify-center shrink-0 shadow-lg shadow-sky-500/30">
            <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-white">{t(language, "welcome")}</h1>
        </div>

        <p className="text-slate-300 leading-relaxed">
          {t(language, "consent_desc")}
        </p>

        {/* Name */}
        <div className="grid grid-cols-2 gap-3">
          <input
            value={first}
            onChange={(e) => setFirst(e.target.value)}
            placeholder="First name"
            autoComplete="off"
            className="px-4 py-4 rounded-2xl bg-white/5 border border-white/10 text-white text-lg placeholder:text-slate-500 focus:outline-none focus:border-sky-500/60"
          />
          <input
            value={last}
            onChange={(e) => setLast(e.target.value)}
            placeholder="Last name"
            autoComplete="off"
            className="px-4 py-4 rounded-2xl bg-white/5 border border-white/10 text-white text-lg placeholder:text-slate-500 focus:outline-none focus:border-sky-500/60"
          />
        </div>

        {/* One-line camera consent */}
        <button
          onClick={() => setCameraOk(!cameraOk)}
          className={`flex items-center gap-3 px-4 py-4 rounded-2xl border text-left transition-all active:scale-[0.99] ${
            cameraOk
              ? "bg-sky-500/10 border-sky-500/40"
              : "bg-white/5 border-white/10"
          }`}
        >
          <span className={`w-6 h-6 rounded-md border-2 flex items-center justify-center shrink-0 ${
            cameraOk ? "bg-sky-500 border-sky-500" : "border-white/30"
          }`}>
            {cameraOk && <span className="text-white text-sm font-bold">✓</span>}
          </span>
          <span className="text-sm text-slate-300">
            Allow a one-time <span className="text-white font-semibold">5-second camera clip</span> during
            vitals — used only to read your BP monitor and estimate vitals, then deleted. Optional.
          </span>
        </button>

        {/* HIPAA badge */}
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <svg className="w-4 h-4 text-sky-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
          </svg>
          HIPAA-compliant · all processing on-premise · session data not stored after triage
        </div>

        <div className="flex flex-col gap-3 mt-2">
          <button
            onClick={accept}
            className="py-5 rounded-2xl bg-sky-500 hover:bg-sky-400 active:scale-95 transition-all text-white font-bold text-xl shadow-lg shadow-sky-500/25"
          >
            {t(language, "agree_btn")}
          </button>
          <p className="text-xs text-slate-500 text-center">
            {t(language, "consent_footer")}
          </p>
        </div>
      </div>
    </KioskShell>
  );
}
