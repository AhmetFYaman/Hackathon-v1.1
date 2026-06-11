"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import KioskShell from "@/components/KioskShell";
import { useKioskStore } from "@/store/kioskStore";
import { t } from "@/lib/i18n";

function VitalCard({
  label, value, unit, icon, ready, normal, abnormal = false,
}: {
  label: string; value: number | null; unit: string;
  icon: React.ReactNode; ready: boolean; normal: string; abnormal?: boolean;
}) {
  return (
    <div className={`flex-1 rounded-2xl p-5 border transition-all duration-700 ${
      ready && abnormal ? "bg-red-500/10 border-red-500/40" :
      ready ? "bg-white/8 border-sky-500/40" : "bg-white/5 border-white/10"
    }`}>
      <div className="flex items-center gap-2 mb-3">
        <div className={ready && abnormal ? "text-red-400" : "text-sky-400"}>{icon}</div>
        <span className="text-xs font-medium text-slate-400 uppercase tracking-widest">{label}</span>
      </div>
      <div className="flex items-end gap-2">
        {ready && value !== null ? (
          <>
            <span className={`text-4xl font-bold ${abnormal ? "text-red-300" : "text-white"}`}>{value}</span>
            <span className="text-base text-slate-400 mb-0.5">{unit}</span>
          </>
        ) : (
          <div className="flex gap-1.5 items-center h-10">
            {[0, 1, 2].map((i) => (
              <div key={i} className="w-2 h-2 rounded-full bg-sky-500 animate-bounce"
                style={{ animationDelay: `${i * 0.15}s` }} />
            ))}
            <span className="ml-2 text-slate-400 text-sm">Measuring…</span>
          </div>
        )}
      </div>
      {ready && value !== null && (
        <p className="text-xs text-slate-500 mt-1">Normal: {normal}</p>
      )}
    </div>
  );
}

function BPCard({ systolic, diastolic }: { systolic: number | null; diastolic: number | null }) {
  const ready = systolic !== null && diastolic !== null;
  const high = ready && (systolic! > 140 || diastolic! > 90);
  return (
    <div className={`flex-1 rounded-2xl p-5 border transition-all duration-700 ${
      ready && high ? "bg-amber-500/10 border-amber-500/40" :
      ready ? "bg-white/8 border-sky-500/40" : "bg-white/5 border-white/10"
    }`}>
      <div className="flex items-center gap-2 mb-3">
        <div className="text-sky-400">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
          </svg>
        </div>
        <span className="text-xs font-medium text-slate-400 uppercase tracking-widest">Blood Pressure</span>
      </div>
      {ready ? (
        <>
          <div className="flex items-end gap-1">
            <span className={`text-4xl font-bold ${high ? "text-amber-300" : "text-white"}`}>{systolic}</span>
            <span className="text-xl text-slate-400 mb-1">/</span>
            <span className={`text-3xl font-bold ${high ? "text-amber-300" : "text-white"}`}>{diastolic}</span>
            <span className="text-base text-slate-400 mb-0.5">mmHg</span>
          </div>
          <p className="text-xs text-slate-500 mt-1">Normal: 90-140 / 60-90</p>
        </>
      ) : (
        <div className="flex flex-col gap-1">
          <div className="flex gap-1.5 items-center h-10">
            {[0, 1, 2].map((i) => (
              <div key={i} className="w-2 h-2 rounded-full bg-white/20 animate-bounce"
                style={{ animationDelay: `${i * 0.15}s` }} />
            ))}
            <span className="ml-2 text-slate-500 text-sm">No sensor</span>
          </div>
          <p className="text-xs text-slate-600">BP cuff attachment needed</p>
        </div>
      )}
    </div>
  );
}

export default function VitalsPage() {
  const router = useRouter();
  const { setVitals, vitals, intake, sessionId, language, setVideoRecordingTriggered } = useKioskStore();
  const [allDone, setAllDone] = useState(false);
  const [usingMock, setUsingMock] = useState(false);
  const [clipStatus, setClipStatus] = useState<"idle" | "recording" | "done" | "off">("idle");
  const [countdown, setCountdown] = useState(5);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const clipStartedRef = useRef(false);
  const previewRef = useRef<HTMLVideoElement | null>(null);

  // Records the 5-second clip with THIS device's camera (kiosk browser) and
  // uploads it to the Jetson via the same-origin /api/clip proxy. Used when
  // the kiosk display itself has a camera (e.g. laptop demo). If the browser
  // blocks the camera, the Pi-camera path (triggered below) still covers it.
  async function recordBrowserClip(sid: string) {
    if (clipStartedRef.current) return;
    clipStartedRef.current = true;
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        setClipStatus("off");
        return;
      }
      // 720p so the BP monitor digits are large enough for the OCR to decode
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      setClipStatus("recording");
      // Live preview so the patient can aim the BP display at the camera
      if (previewRef.current) {
        previewRef.current.srcObject = stream;
        previewRef.current.play().catch(() => {});
      }
      const cdTimer = setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1_000);

      const mime = ["video/mp4", "video/webm;codecs=vp8", "video/webm"]
        .find((m) => MediaRecorder.isTypeSupported(m));
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      const stopped = new Promise<void>((res) => { rec.onstop = () => res(); });
      rec.start();
      await new Promise((r) => setTimeout(r, 5_000));
      rec.stop();
      await stopped;
      clearInterval(cdTimer);
      stream.getTracks().forEach((t) => t.stop());
      if (previewRef.current) previewRef.current.srcObject = null;

      const type = rec.mimeType || "video/webm";
      const ext = type.includes("mp4") ? "mp4" : "webm";
      const fd = new FormData();
      fd.append("file", new Blob(chunks, { type }), `clip.${ext}`);
      fd.append("sessionId", sid);
      const res = await fetch("/api/clip", { method: "POST", body: fd });
      setClipStatus(res.ok ? "done" : "off");
    } catch {
      // No camera / permission denied — Pi camera path handles it instead
      setClipStatus("off");
    }
  }

  function isHRAbnormal(hr: number) { return hr > 100 || hr < 60; }
  function isSpO2Abnormal(spo2: number) { return spo2 < 94; }
  function isTempAbnormal(temp: number) { return temp > 101 || temp < 97; }

  useEffect(() => {
    setVitals({ status: "measuring" });
    fetch("/api/vitals", { method: "DELETE" }).catch(() => {});

    // One-time 5-second clip, if the patient consented:
    //  - trigger the Pi camera (sensor-station setups)
    //  - AND try this device's own camera (laptop / webcam setups)
    if (intake?.cameraConsent) {
      fetch("/api/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start_recording", sessionId }),
      }).catch(() => {});
      setVideoRecordingTriggered(true);
      recordBrowserClip(sessionId);
    } else {
      setClipStatus("off");
    }

    let noDataCount = 0;

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch("/api/vitals");
        const data = await res.json();
        const hasAny = data.heartRate !== null || data.spO2 !== null || data.temperature !== null;

        if (hasAny) {
          noDataCount = 0;
          setUsingMock(false);
          setVitals({
            heartRate: data.heartRate,
            spO2: data.spO2,
            temperature: data.temperature,
            bloodPressureSystolic: data.bloodPressureSystolic ?? null,
            bloodPressureDiastolic: data.bloodPressureDiastolic ?? null,
          });

          if (data.heartRate !== null && data.spO2 !== null && data.temperature !== null) {
            setVitals({ status: "done" });
            setAllDone(true);
            clearInterval(pollRef.current!);
          }
        } else {
          noDataCount++;
          if (noDataCount >= 8) {
            setUsingMock(true);
            clearInterval(pollRef.current!);
            simulateMock();
          }
        }
      } catch {
        setUsingMock(true);
        clearInterval(pollRef.current!);
        simulateMock();
      }
    }, 1000);

    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  function simulateMock() {
    let step = 0;
    const t = setInterval(() => {
      step++;
      if (step === 1) setVitals({ heartRate: 82 });
      if (step === 2) setVitals({ spO2: 97 });
      if (step === 3) {
        setVitals({ temperature: 98.6, status: "done" });
        setAllDone(true);
        clearInterval(t);
      }
    }, 1500);
  }

  return (
    <KioskShell step={3}>
      <div className="flex flex-col h-full px-5 py-4 gap-4">

        {/* Header */}
        <div className="text-center shrink-0">
          <h1 className="text-2xl font-bold text-white">{t(language, "vitals_title")}</h1>
          <p className="text-slate-400 text-sm mt-0.5">{t(language, "vitals_desc")}</p>
          {usingMock && (
            <p className="text-amber-400 text-xs mt-1">{t(language, "vitals_mock_warn")}</p>
          )}
          {intake?.cameraConsent && clipStatus === "recording" && (
            <p className="text-sky-400 text-xs mt-1">
              <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse mr-1.5 align-middle" />
              Recording 5s clip — hold your BP monitor display toward the camera
            </p>
          )}
          {intake?.cameraConsent && clipStatus === "done" && (
            <p className="text-green-400 text-xs mt-1">Clip captured ✓</p>
          )}
        </div>

        {/* Camera preview with aiming guide while the 5s clip records;
            compact sensor animation otherwise */}
        {clipStatus === "recording" ? (
          <div className="relative mx-auto w-full max-w-md shrink-0 rounded-2xl overflow-hidden border-2 border-sky-500/60 shadow-lg shadow-sky-500/20">
            <video ref={previewRef} autoPlay muted playsInline className="w-full max-h-[260px] object-cover bg-black" />
            {/* Aiming guide box */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-[55%] h-[70%] border-4 border-dashed border-amber-400/90 rounded-xl flex items-start justify-center">
                <span className="bg-black/70 text-amber-300 text-xs font-semibold px-2 py-1 rounded-b-lg">
                  Hold BP display inside this box — close &amp; flat
                </span>
              </div>
            </div>
            {/* Countdown + REC badge */}
            <div className="absolute top-2 left-2 flex items-center gap-2 bg-black/70 px-2.5 py-1 rounded-full">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-white text-xs font-bold">REC {countdown}s</span>
            </div>
          </div>
        ) : (
          <div className="flex justify-center shrink-0">
            <div className="relative w-14 h-14">
              <div className="absolute inset-0 rounded-full border-4 border-sky-500/30 animate-ping" />
              <div className="absolute inset-1.5 rounded-full border-2 border-sky-500/50 animate-pulse" />
              <div className="absolute inset-3 rounded-full bg-sky-500/20 flex items-center justify-center">
                <svg className="w-5 h-5 text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
                </svg>
              </div>
            </div>
          </div>
        )}

        {/* Vitals grid — 2-column on portrait */}
        <div className="grid grid-cols-2 gap-3 flex-1 min-h-0">
          <VitalCard
            label="Heart Rate"
            value={vitals.heartRate}
            unit="BPM"
            normal="60–100 BPM"
            ready={vitals.heartRate !== null}
            abnormal={vitals.heartRate !== null && isHRAbnormal(vitals.heartRate)}
            icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
            </svg>}
          />
          <VitalCard
            label="SpO₂"
            value={vitals.spO2}
            unit="%"
            normal="95–100%"
            ready={vitals.spO2 !== null}
            abnormal={vitals.spO2 !== null && isSpO2Abnormal(vitals.spO2)}
            icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
            </svg>}
          />
          <VitalCard
            label="Temperature"
            value={vitals.temperature}
            unit="°F"
            normal="97–99°F"
            ready={vitals.temperature !== null}
            abnormal={vitals.temperature !== null && isTempAbnormal(vitals.temperature)}
            icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.362 5.214A8.252 8.252 0 0112 21 8.25 8.25 0 016.038 7.048 8.287 8.287 0 009 9.6a8.983 8.983 0 013.361-6.867 8.21 8.21 0 003 2.48z" />
            </svg>}
          />
          <BPCard systolic={vitals.bloodPressureSystolic} diastolic={vitals.bloodPressureDiastolic} />
        </div>

        {/* Continue — always visible at bottom */}
        <div className="flex justify-center shrink-0 pb-1">
          {allDone ? (
            <button
              onClick={() => router.push("/tutorial")}
              className="w-full py-5 rounded-2xl bg-sky-500 hover:bg-sky-400 active:scale-95 transition-all text-white font-bold text-xl"
            >
              {t(language, "continue")}
            </button>
          ) : (
            <p className="text-slate-500 text-sm">Waiting for sensor readings…</p>
          )}
        </div>
      </div>
    </KioskShell>
  );
}
