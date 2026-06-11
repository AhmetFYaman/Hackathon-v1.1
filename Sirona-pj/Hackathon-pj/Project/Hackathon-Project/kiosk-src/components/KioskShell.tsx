"use client";
import React from "react";
import { useKioskStore } from "@/store/kioskStore";
import { t, LANGUAGES } from "@/lib/i18n";

type Props = {
  children: React.ReactNode;
  step?: number;    // 1-7 for progress bar
  totalSteps?: number;
};

const STEP_LABELS = ["Consent", "Intake", "Vitals", "Tutorial", "Body Map", "Pain", "Done"];

export default function KioskShell({ children, step, totalSteps = 7 }: Props) {
  const language = useKioskStore((s) => s.language);
  const dir = LANGUAGES[language].dir;

  return (
    <div
      dir={dir}
      className="flex flex-col h-screen w-screen bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950"
    >
      {/* Header — compact for 720px portrait */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-sky-500 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
          </div>
          <span className="text-lg font-bold tracking-tight text-white">MediKiosk</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 bg-white/5 px-2 py-1 rounded-lg shrink-0">
            {LANGUAGES[language].native}
          </span>
          <div className="flex items-center gap-1.5 text-xs text-slate-400 shrink-0">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            Online
          </div>
        </div>
      </header>

      {/* Step progress — thinner for portrait */}
      {step !== undefined && (
        <div className="px-4 pt-2 pb-1 shrink-0">
          <div className="flex gap-1">
            {Array.from({ length: totalSteps }).map((_, i) => (
              <div
                key={i}
                className={`h-1 flex-1 rounded-full transition-all duration-500 ${
                  i < step ? "bg-sky-500" : i === step - 1 ? "bg-sky-400" : "bg-white/10"
                }`}
              />
            ))}
          </div>
          {step && (
            <p className="text-xs text-slate-500 mt-1">
              {step}/{totalSteps} — {STEP_LABELS[step - 1]}
            </p>
          )}
        </div>
      )}

      {/* Main content — scrollable */}
      <main className="flex-1 min-h-0 overflow-y-auto screen-enter">
        {children}
      </main>

      {/* Footer */}
      <footer className="px-4 py-2 border-t border-white/10 text-center shrink-0">
        <p className="text-xs text-slate-600">
          HIPAA Compliant · On-premise · Session data not stored
        </p>
      </footer>
    </div>
  );
}
