"use client";
import { useEffect, useRef, useState } from "react";

// Jetson AI Monitor — runs full-screen on the Jetson's own display.
// Live view of the AI pipeline: received 5-second clip, stage-by-stage
// event feed, and the final ESI triage summary.

type MonitorEvent = { ts: string; stage: string; message: string };
type MonitorState = {
  busy: boolean;
  stage: string;
  lastClip: { sessionId: string; filename: string; url: string; receivedAt: string } | null;
  lastResult: {
    patientName: string;
    esiLevel: number;
    esiLabel: string;
    rationale: string;
    redFlags: string[];
    vitals: { heartRate: number | null; spO2: number | null; temperature: number | null; bp: string | null; bpSource: string | null };
    ageGroup: string | null;
    weightKg: number | null;
    allergies: string[];
    complaints: string[];
    painRegions: string[];
    esiSources: { rules: number; rfModel: number; llm: number | null };
    hl7Filename: string;
  } | null;
  events: MonitorEvent[];
  ollama: string;
  esiModel: boolean;
};

const ESI_COLORS: Record<number, string> = {
  1: "#ef4444", 2: "#f97316", 3: "#facc15", 4: "#22c55e", 5: "#06b6d4",
};

export default function MonitorPage() {
  const [state, setState] = useState<MonitorState | null>(null);
  const [online, setOnline] = useState(false);
  const aiBase = useRef("");

  useEffect(() => {
    aiBase.current = `${window.location.protocol}//${window.location.hostname}:8000`;
    const poll = async () => {
      try {
        const res = await fetch(`${aiBase.current}/monitor/state`, {
          signal: AbortSignal.timeout(3_000),
        });
        if (res.ok) {
          setState(await res.json());
          setOnline(true);
          return;
        }
      } catch { /* server offline */ }
      setOnline(false);
    };
    poll();
    const iv = setInterval(poll, 1_000);
    return () => clearInterval(iv);
  }, []);

  const busy = state?.busy ?? false;
  const result = state?.lastResult ?? null;
  const clip = state?.lastClip ?? null;

  return (
    <div className="min-h-screen w-screen bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 text-white p-6 flex flex-col gap-5">

      {/* Header */}
      <header className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-sky-500 flex items-center justify-center">
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 3.75H6.912a2.25 2.25 0 00-2.15 1.588L2.35 13.177a2.25 2.25 0 00-.1.661V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18v-4.162c0-.224-.034-.447-.1-.661l-2.41-7.839a2.25 2.25 0 00-2.15-1.588H15M9 3.75v2.25M15 3.75v2.25m-6 0h6m-6 0H6.75m8.25 0h2.25" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold">Jetson AI Monitor</h1>
            <p className="text-xs text-slate-500">
              MediKiosk triage engine · RF model {state?.esiModel ? "loaded" : "missing"} · LLM {state?.ollama ?? "—"}
            </p>
          </div>
        </div>

        {/* Big AI status indicator */}
        <div className={`flex items-center gap-3 px-5 py-3 rounded-2xl border transition-all duration-300 ${
          !online ? "bg-slate-800/60 border-white/10"
          : busy ? "bg-amber-500/15 border-amber-500/50 shadow-lg shadow-amber-500/20"
          : "bg-green-500/10 border-green-500/30"
        }`}>
          <span className={`w-3.5 h-3.5 rounded-full ${
            !online ? "bg-slate-600"
            : busy ? "bg-amber-400 animate-ping" : "bg-green-400 animate-pulse"
          }`} />
          <span className={`font-bold tracking-wide ${
            !online ? "text-slate-500" : busy ? "text-amber-300" : "text-green-300"
          }`}>
            {!online ? "AI SERVER OFFLINE" : busy ? "AI WORKING…" : "AI READY"}
          </span>
        </div>
      </header>

      {/* Main grid */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-5 min-h-0">

        {/* Left column: video + result */}
        <div className="lg:col-span-2 flex flex-col gap-5 min-h-0">

          {/* Received clip */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-sky-400 uppercase tracking-widest">
                Received 5-second clip
              </h2>
              {clip && (
                <span className="text-xs text-slate-500">
                  session {clip.sessionId.slice(0, 8)} · {clip.filename}
                </span>
              )}
            </div>
            {clip ? (
              <video
                key={clip.filename}
                src={`${aiBase.current}${clip.url}`}
                controls
                autoPlay
                muted
                loop
                playsInline
                className="w-full max-h-[340px] rounded-xl bg-black object-contain"
              />
            ) : (
              <div className="h-[200px] flex items-center justify-center text-slate-600 text-sm">
                No clip received yet — waiting for a patient session…
              </div>
            )}
          </div>

          {/* ESI summary */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5 flex-1">
            <h2 className="text-xs font-semibold text-sky-400 uppercase tracking-widest mb-3">
              Triage summary
            </h2>
            {result ? (
              <div className="flex gap-5">
                {/* ESI badge */}
                <div
                  className="w-28 h-28 rounded-2xl flex flex-col items-center justify-center shrink-0"
                  style={{ backgroundColor: `${ESI_COLORS[result.esiLevel]}22`, border: `2px solid ${ESI_COLORS[result.esiLevel]}` }}
                >
                  <span className="text-5xl font-black" style={{ color: ESI_COLORS[result.esiLevel] }}>
                    {result.esiLevel}
                  </span>
                  <span className="text-xs font-semibold mt-1" style={{ color: ESI_COLORS[result.esiLevel] }}>
                    {result.esiLabel}
                  </span>
                </div>

                <div className="flex-1 space-y-2 text-sm">
                  <p className="text-lg font-bold">{result.patientName}</p>
                  <p className="text-slate-300">{result.rationale}</p>

                  <div className="flex flex-wrap gap-x-5 gap-y-1 text-slate-400 pt-1">
                    {result.vitals.heartRate && <span>HR <b className="text-white">{result.vitals.heartRate}</b> bpm</span>}
                    {result.vitals.spO2 && <span>SpO₂ <b className="text-white">{result.vitals.spO2}</b>%</span>}
                    {result.vitals.temperature && <span>Temp <b className="text-white">{result.vitals.temperature}</b>°F</span>}
                    {result.vitals.bp && (
                      <span>BP <b className="text-white">{result.vitals.bp}</b>
                        {result.vitals.bpSource === "bp_display" && <em className="text-sky-400 not-italic"> (read from cuff display)</em>}
                      </span>
                    )}
                    {result.weightKg && <span>Weight <b className="text-white">{result.weightKg}</b> kg</span>}
                    {result.ageGroup && <span>Age <b className="text-white">{result.ageGroup}</b></span>}
                  </div>

                  {result.complaints.length > 0 && (
                    <p className="text-slate-400">Complaints: <span className="text-white">{result.complaints.join(", ")}</span></p>
                  )}
                  {result.painRegions.length > 0 && (
                    <p className="text-slate-400">Pain: <span className="text-white">{result.painRegions.join(", ")}</span></p>
                  )}
                  {result.allergies.length > 0 && (
                    <p className="text-slate-400">Allergies: <span className="text-amber-300">{result.allergies.join(", ")}</span></p>
                  )}
                  {result.redFlags.length > 0 && (
                    <p className="text-red-400 font-semibold">Red flags: {result.redFlags.join(" · ")}</p>
                  )}

                  <p className="text-xs text-slate-500 pt-1">
                    Sources — rules: ESI {result.esiSources.rules} · RF: ESI {result.esiSources.rfModel} · LLM:{" "}
                    {result.esiSources.llm ? `ESI ${result.esiSources.llm}` : "n/a"} &nbsp;|&nbsp; HL7:{" "}
                    <a
                      href={`${aiBase.current}/hl7/${result.hl7Filename}`}
                      target="_blank"
                      className="text-sky-400 underline"
                    >
                      {result.hl7Filename}
                    </a>
                  </p>
                </div>
              </div>
            ) : (
              <div className="h-[140px] flex items-center justify-center text-slate-600 text-sm">
                No triage completed yet
              </div>
            )}
          </div>
        </div>

        {/* Right column: live event feed */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex flex-col min-h-0">
          <h2 className="text-xs font-semibold text-sky-400 uppercase tracking-widest mb-3 shrink-0">
            AI pipeline feed
          </h2>
          <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
            {(state?.events ?? []).length === 0 && (
              <p className="text-slate-600 text-sm">Waiting for activity…</p>
            )}
            {(state?.events ?? []).map((e, i) => (
              <div
                key={`${e.ts}-${i}`}
                className={`px-3 py-2 rounded-xl border text-sm leading-snug ${
                  i === 0 && busy
                    ? "bg-amber-500/10 border-amber-500/30 text-amber-100"
                    : e.stage === "done"
                    ? "bg-green-500/10 border-green-500/20 text-green-100"
                    : "bg-white/5 border-white/10 text-slate-300"
                }`}
              >
                <span className="text-[10px] text-slate-500 block">
                  {new Date(e.ts).toLocaleTimeString()}
                </span>
                {e.message}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
