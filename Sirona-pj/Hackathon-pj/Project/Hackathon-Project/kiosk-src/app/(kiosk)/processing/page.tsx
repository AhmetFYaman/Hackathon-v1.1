"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import KioskShell from "@/components/KioskShell";
import { useKioskStore } from "@/store/kioskStore";
import { computeESI } from "@/lib/esiScoring";
import { t } from "@/lib/i18n";

export default function ProcessingPage() {
  const router = useRouter();
  const { vitals, selectedRegions, intake, sessionId, firstName, lastName, language, setResult, setJetsonResult } = useKioskStore();
  const [stepIdx, setStepIdx] = useState(0);
  const [done, setDone] = useState(false);
  const [statusNote, setStatusNote] = useState<string | null>(null);

  const STEPS = [
    t(language, "proc_step1"),
    t(language, "proc_step2"),
    t(language, "proc_step3"),
    t(language, "proc_step4"),
    t(language, "proc_step5"),
  ];

  const startedRef = useRef(false);

  useEffect(() => {
    // Guard against React StrictMode double-invoking this effect in dev —
    // otherwise every patient generates two /analyze calls and two HL7 files
    if (startedRef.current) return;
    startedRef.current = true;
    runAnalysis();
  }, []);

  async function tryAnalyze(payload: Record<string, unknown>): Promise<Response | null> {
    // 1) Direct to the Jetson AI server, if a reachable URL is configured.
    //    NOTE: this code runs in the kiosk *browser* (on the Pi), so
    //    "localhost" would be the Pi itself — skip direct mode in that case.
    const jetsonUrl = process.env.NEXT_PUBLIC_JETSON_AI_URL ?? "";
    const directUsable =
      jetsonUrl &&
      (!jetsonUrl.includes("localhost") || window.location.hostname === "localhost");

    if (directUsable) {
      try {
        const res = await fetch(`${jetsonUrl}/analyze`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(40_000), // Ollama may take 20-30s on Jetson Nano
        });
        if (res.ok) return res;
      } catch {
        // fall through to proxy
      }
    }

    // 2) Same-origin proxy — Next.js runs on the Jetson, so this always
    //    reaches the AI server regardless of how the kiosk was opened.
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(40_000),
      });
      if (res.ok) return res;
    } catch {
      // Jetson AI fully unreachable
    }
    return null;
  }

  async function runAnalysis() {
    // Animate steps while we wait for Jetson response
    let i = 0;
    const iv = setInterval(() => {
      i++;
      if (i < STEPS.length) setStepIdx(i);
    }, 900);

    try {
      // Facial distress is computed on the Jetson from the 5-second clip,
      // so no facial data is collected or sent from the kiosk itself.
      const payload = {
        sessionId,
        vitals,
        intake,
        regions: selectedRegions,
        firstName,
        lastName,
        timestamp: new Date().toISOString(),
      };

      const res = await tryAnalyze(payload);

      if (res) {
        const data = await res.json();
        clearInterval(iv);
        setStepIdx(STEPS.length - 1);
        setStatusNote("✓ Jetson AI analysis complete");
        setJetsonResult({
          esiLevel: data.esiLevel,
          esiRationale: data.esiRationale,
          estimatedAge: data.estimatedAge ?? null,
          estimatedHeightCm: data.estimatedHeightCm ?? null,
          estimatedWeightKg: data.estimatedWeightKg ?? null,
          hl7Path: data.hl7Path ?? null,
          source: "jetson",
          bpSystolicVideo: data.bpSystolicVideo ?? null,
          bpDiastolicVideo: data.bpDiastolicVideo ?? null,
          bpConfidenceVideo: data.bpConfidenceVideo ?? null,
          bpFromVideo: data.bpFromVideo ?? false,
          respiratoryRateVideo: data.respiratoryRateVideo ?? null,
          heartRateVideo: data.heartRateVideo ?? null,
          redFlags: data.redFlags ?? [],
          recommendedAction: data.recommendedAction ?? null,
          esiSources: data.esiSources ?? null,
        });
        const queue = Math.floor(Math.random() * 6) + 1;
        setResult(data.esiLevel, queue, data.esiRationale);
        setDone(true);
        return;
      }
    } catch {
      // Jetson unreachable — fall back to local
    }

    // Local fallback ESI computation
    clearInterval(iv);
    setStepIdx(STEPS.length - 1);
    setStatusNote("⚠ Jetson offline — local analysis used");
    const { level, rationale } = computeESI({ vitals, regions: selectedRegions });
    const queue = Math.floor(Math.random() * 6) + 1;
    setResult(level, queue, rationale);
    setJetsonResult({
      esiLevel: level,
      esiRationale: rationale,
      estimatedAge: null,
      estimatedHeightCm: null,
      estimatedWeightKg: null,
      hl7Path: null,
      source: "local",
    });
    setDone(true);
  }

  useEffect(() => {
    if (done) {
      const timer = setTimeout(() => router.push("/result"), 600);
      return () => clearTimeout(timer);
    }
  }, [done]);

  return (
    <KioskShell>
      <div className="flex flex-col items-center justify-center h-full gap-8 px-8">
        {/* Spinner */}
        <div className="relative w-32 h-32">
          <svg className="absolute inset-0 w-full h-full animate-spin" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(14,165,233,0.15)" strokeWidth="8" />
            <circle cx="50" cy="50" r="44" fill="none" stroke="#0ea5e9" strokeWidth="8"
              strokeLinecap="round" strokeDasharray="120 160" />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <svg className="w-12 h-12 text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15M14.25 3.104c.251.023.501.05.75.082M19.8 15a3 3 0 00-2.8-2.93M5 14.5a3 3 0 002.8-2.93" />
            </svg>
          </div>
        </div>

        <div className="text-center">
          <h1 className="text-2xl font-bold text-white mb-2">{t(language, "proc_title")}</h1>
          <p className="text-slate-400">{t(language, "proc_sub")}</p>
          {statusNote && (
            <p className={`text-xs mt-2 ${statusNote.startsWith("✓") ? "text-green-400" : "text-amber-400"}`}>
              {statusNote}
            </p>
          )}
        </div>

        {/* Step list */}
        <div className="space-y-2 w-full max-w-sm">
          {STEPS.map((step, i) => (
            <div
              key={i}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-500 ${
                i < stepIdx ? "bg-white/5 text-slate-400" :
                i === stepIdx ? "bg-sky-500/15 border border-sky-500/30 text-white" :
                "text-slate-600"
              }`}
            >
              {i < stepIdx ? (
                <span className="text-green-400 text-sm">✓</span>
              ) : i === stepIdx ? (
                <span className="w-4 h-4 rounded-full border-2 border-sky-400 border-t-transparent animate-spin block" />
              ) : (
                <span className="w-4 h-4 rounded-full border border-white/20 block" />
              )}
              <span className="text-sm">{step}</span>
            </div>
          ))}
        </div>
      </div>
    </KioskShell>
  );
}
