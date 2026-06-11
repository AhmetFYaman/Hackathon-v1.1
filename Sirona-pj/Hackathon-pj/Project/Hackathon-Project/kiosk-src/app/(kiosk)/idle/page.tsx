"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LANGUAGES, type LangCode, translations } from "@/lib/i18n";
import { useKioskStore } from "@/store/kioskStore";

const LANG_CODES = Object.keys(LANGUAGES) as LangCode[];

// Cycle through "Touch to begin" in each language for the marquee
const TOUCH_MSGS = LANG_CODES.map((code) => ({
  code,
  msg: translations[code].idle_touch,
  native: LANGUAGES[code].native,
}));

export default function IdlePage() {
  const router = useRouter();
  const { setLanguage, resetSession } = useKioskStore();
  const [marqueeIdx, setMarqueeIdx] = useState(0);
  const [fade, setFade] = useState(true);

  // Reset session state whenever idle screen is shown
  useEffect(() => {
    resetSession();
  }, []);

  // Cycle the marquee message every 2.5 seconds
  useEffect(() => {
    const iv = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        setMarqueeIdx((i) => (i + 1) % TOUCH_MSGS.length);
        setFade(true);
      }, 300);
    }, 2500);
    return () => clearInterval(iv);
  }, []);

  function selectLanguage(code: LangCode) {
    setLanguage(code);
    router.push("/consent");
  }

  const current = TOUCH_MSGS[marqueeIdx];

  return (
    <div
      className="flex flex-col h-screen w-screen bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 select-none"
      onClick={() => selectLanguage("en")}
    >
      {/* Top branding — compact for portrait */}
      <div className="flex flex-col items-center pt-10 pb-3 gap-3 shrink-0">
        <div className="w-14 h-14 rounded-2xl bg-sky-500 flex items-center justify-center shadow-lg shadow-sky-500/30">
          <svg className="w-9 h-9 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
        </div>
        <div className="text-center">
          <h1 className="text-4xl font-black text-white tracking-tight">MediKiosk</h1>
          <p className="text-slate-400 text-sm mt-0.5">Smart Emergency Triage · Fast · Private</p>
        </div>
      </div>

      {/* Scrolling language marquee — flex-1 so language grid stays at bottom */}
      <div className="flex-1 flex flex-col items-center justify-center gap-5 px-6">
        <div
          className="text-center transition-opacity duration-300"
          style={{ opacity: fade ? 1 : 0 }}
        >
          <p
            className="text-4xl font-bold text-white leading-tight"
            dir={LANGUAGES[current.code].dir}
          >
            {current.msg}
          </p>
          <p className="text-sky-400 text-lg mt-1.5">{current.native}</p>
        </div>

        {/* Pulse ring */}
        <div className="relative w-16 h-16 flex items-center justify-center">
          <div className="absolute inset-0 rounded-full border-2 border-sky-500/30 animate-ping" />
          <div className="absolute inset-2 rounded-full border border-sky-500/50 animate-pulse" />
          <div className="w-9 h-9 rounded-full bg-sky-500/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.042 21.672L13.684 16.6m0 0l-2.51 2.225.569-9.47 5.227 7.917-3.286-.672zm-7.518-.267A8.25 8.25 0 1120.25 10.5M8.288 14.212A5.25 5.25 0 1117.25 10.5" />
            </svg>
          </div>
        </div>

        <p className="text-slate-400 text-sm font-medium">
          — Select your language / Seleccione su idioma —
        </p>
      </div>

      {/* Language grid — 5×2, stop propagation */}
      <div
        className="px-4 pb-6 shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="grid grid-cols-5 gap-2">
          {LANG_CODES.map((code) => (
            <button
              key={code}
              onClick={() => selectLanguage(code)}
              className="flex flex-col items-center gap-0.5 px-1 py-3 rounded-2xl bg-white/8 border border-white/10 hover:bg-sky-500/20 hover:border-sky-500/50 active:scale-95 transition-all min-h-[68px] justify-center"
            >
              <span
                className="text-white font-semibold text-sm leading-tight text-center"
                dir={LANGUAGES[code].dir}
              >
                {LANGUAGES[code].native}
              </span>
              <span className="text-slate-500 text-[10px]">{LANGUAGES[code].name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-white/10 text-center shrink-0">
        <p className="text-xs text-slate-600">
          HIPAA Compliant · On-premise only · Session data not stored
        </p>
      </div>
    </div>
  );
}
