"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import KioskShell from "@/components/KioskShell";
import { useKioskStore } from "@/store/kioskStore";
import { ESI_LABELS, type ESILevel } from "@/lib/esiScoring";
import { t } from "@/lib/i18n";

export default function ResultPage() {
  const router = useRouter();
  const { esiLevel, queuePosition, resetSession, jetsonResult, language } = useKioskStore();

  const ESI_DESCRIPTIONS: Record<ESILevel, string> = {
    1: t(language, "result_esi1"),
    2: t(language, "result_esi2"),
    3: t(language, "result_esi3"),
    4: t(language, "result_esi4"),
    5: t(language, "result_esi5"),
  };
  const [countdown, setCountdown] = useState(30);

  useEffect(() => {
    if (!esiLevel) { router.replace("/idle"); return; }
    const iv = setInterval(() => setCountdown((c) => c - 1), 1000);
    return () => clearInterval(iv);
  }, [esiLevel]);

  useEffect(() => {
    if (countdown <= 0) {
      resetSession();
      router.replace("/idle");
    }
  }, [countdown]);

  if (!esiLevel) return null;

  const info = ESI_LABELS[esiLevel];

  return (
    <KioskShell step={7}>
      <div className="flex flex-col items-center gap-5 px-5 py-6 min-h-full justify-center">
        {/* ESI badge â€” compact for portrait */}
        <div
          className="w-28 h-28 rounded-3xl flex flex-col items-center justify-center border-2 shrink-0"
          style={{
            background: `${info.color}20`,
            borderColor: info.color,
            boxShadow: `0 0 40px ${info.color}40`,
          }}
        >
          <span className="text-4xl font-black" style={{ color: info.color }}>
            ESI {esiLevel}
          </span>
          <span className="text-sm mt-0.5" style={{ color: info.color }}>
            {info.label}
          </span>
        </div>

        <div className="text-center max-w-sm">
          <h1 className="text-xl font-bold text-white mb-2">{t(language, "result_title")}</h1>
          <p className="text-slate-300 leading-relaxed">
            {ESI_DESCRIPTIONS[esiLevel]}
          </p>
        </div>

        {/* Queue position */}
        {queuePosition && (
          <div className="flex items-center gap-4 bg-white/5 border border-white/10 rounded-2xl px-6 py-4 w-full max-w-xs">
            <div className="text-center flex-1">
              <p className="text-xs text-slate-400 uppercase tracking-widest">{t(language, "result_queue")}</p>
              <p className="text-3xl font-black text-white"># {queuePosition}</p>
            </div>
            <div className="w-px h-10 bg-white/10" />
            <div className="text-center flex-1">
              <p className="text-xs text-slate-400 uppercase tracking-widest">{t(language, "result_wait")}</p>
              <p className="text-xl font-bold text-white">{info.wait}</p>
            </div>
          </div>
        )}

        {/* AI inferences from Jetson video + LLM analysis */}
        {jetsonResult && jetsonResult.source === "jetson" && (
          <div className="w-full max-w-md space-y-3">

            {/* rPPG-estimated BP or age */}
            {(jetsonResult.bpSystolicVideo || jetsonResult.estimatedAge) && (
              <div className="flex gap-3 flex-wrap justify-center">
                {jetsonResult.bpSystolicVideo && jetsonResult.bpDiastolicVideo && (
                  <div className="bg-sky-500/10 border border-sky-500/20 rounded-xl px-4 py-2 text-center">
                    <p className="text-xs text-sky-400">
                      {jetsonResult.bpFromVideo ? "BP (video est.)" : "Blood Pressure"}
                    </p>
                    <p className="text-white font-bold">
                      {jetsonResult.bpSystolicVideo}/{jetsonResult.bpDiastolicVideo}
                      {jetsonResult.bpFromVideo && (
                        <span className="text-sky-400 text-xs ml-1">mmHg~</span>
                      )}
                    </p>
                    {jetsonResult.bpConfidenceVideo != null && jetsonResult.bpConfidenceVideo > 0 && (
                      <p className="text-xs text-slate-500">
                        conf {Math.round(jetsonResult.bpConfidenceVideo * 100)}%
                      </p>
                    )}
                  </div>
                )}
                {jetsonResult.respiratoryRateVideo && (
                  <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-center">
                    <p className="text-xs text-slate-500">Resp. Rate (video)</p>
                    <p className="text-white font-bold">{jetsonResult.respiratoryRateVideo} /min</p>
                  </div>
                )}
                {jetsonResult.estimatedAge && (
                  <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-center">
                    <p className="text-xs text-slate-500">AI Age Est.</p>
                    <p className="text-white font-bold">~{jetsonResult.estimatedAge} yrs</p>
                  </div>
                )}
                {jetsonResult.hl7Path && (
                  <div className="bg-green-500/10 border border-green-500/20 rounded-xl px-4 py-2 text-center">
                    <p className="text-xs text-green-400">HL7 Record</p>
                    <p className="text-green-300 font-bold text-xs">Generated âœ“</p>
                  </div>
                )}
              </div>
            )}

            {/* LLM red flags */}
            {jetsonResult.redFlags && jetsonResult.redFlags.length > 0 && (
              <div className="bg-red-500/10 border border-red-500/25 rounded-xl px-4 py-3">
                <p className="text-xs text-red-400 font-semibold uppercase tracking-wider mb-1">
                  Clinical Flags
                </p>
                <ul className="space-y-0.5">
                  {jetsonResult.redFlags.map((f, i) => (
                    <li key={i} className="text-sm text-red-200 flex gap-2">
                      <span className="text-red-400">!</span>{f}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* ESI source transparency */}
            {jetsonResult.esiSources && (
              <div className="flex gap-2 justify-center text-xs text-slate-600">
                <span>Rules: ESI {jetsonResult.esiSources.rules}</span>
                <span>Â·</span>
                <span>RF Model: ESI {jetsonResult.esiSources.rfModel}</span>
                {jetsonResult.esiSources.llmAvailable && jetsonResult.esiSources.llm && (
                  <>
                    <span>Â·</span>
                    <span>LLM: ESI {jetsonResult.esiSources.llm}</span>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Nurse review notice */}
        <div className="flex items-center gap-3 bg-amber-500/10 border border-amber-500/20 rounded-xl px-5 py-3 max-w-md">
          <span className="text-amber-400 text-xl">âš•ï¸</span>
          <p className="text-sm text-amber-200">{t(language, "result_nurse")}</p>
        </div>

        {/* Auto-reset countdown */}
        <div className="text-center">
          <p className="text-slate-500 text-sm">
            {t(language, "result_reset_in")} <span className="text-white font-bold">{countdown}s</span>
          </p>
          <button
            onClick={() => { resetSession(); router.replace("/idle"); }}
            className="mt-3 px-8 py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white text-sm transition-all"
          >
            {t(language, "result_new_session")}
          </button>
        </div>
      </div>
    </KioskShell>
  );
}
