"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import KioskShell from "@/components/KioskShell";

const STEPS = [
  {
    title: "Select Where It Hurts",
    desc: "Tap any area on the body diagram to mark pain. You can select multiple areas.",
    visual: "tap",
  },
  {
    title: "Rate Your Pain",
    desc: "After selecting an area, use the smiley face scale to rate how much it hurts.",
    visual: "rate",
  },
  {
    title: "Tap Again to Remove",
    desc: "Changed your mind? Tap a highlighted area again to deselect it.",
    visual: "remove",
  },
];

function TapVisual() {
  return (
    <div className="relative w-64 h-48 flex items-center justify-center">
      {/* Mini body silhouette */}
      <svg viewBox="0 0 80 140" className="h-40 opacity-40 text-slate-400 fill-current">
        <ellipse cx="40" cy="12" rx="10" ry="12" />
        <rect x="28" y="24" width="24" height="36" rx="4" />
        <rect x="14" y="26" width="12" height="28" rx="4" />
        <rect x="54" y="26" width="12" height="28" rx="4" />
        <rect x="28" y="60" width="10" height="38" rx="4" />
        <rect x="42" y="60" width="10" height="38" rx="4" />
        <rect x="26" y="98" width="10" height="28" rx="4" />
        <rect x="44" y="98" width="10" height="28" rx="4" />
      </svg>

      {/* Animated tap circle */}
      <div className="absolute" style={{ top: "45%", left: "48%" }}>
        <div className="absolute w-10 h-10 rounded-full border-2 border-sky-400 animate-ping opacity-60" style={{ transform: "translate(-50%,-50%)" }} />
        <div className="w-5 h-5 rounded-full bg-sky-400/80" style={{ transform: "translate(-50%,-50%)" }} />
      </div>

      {/* Tutorial hand */}
      <div className="absolute tutorial-hand" style={{ top: "40%", left: "52%" }}>
        <svg className="w-12 h-12 drop-shadow-xl" viewBox="0 0 48 48" fill="none">
          <path d="M16 34V16a3 3 0 016 0v10" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M22 22a3 3 0 016 0v4" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M28 24a3 3 0 016 0v6" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M34 28v2a8 8 0 01-8 8h-4a8 8 0 01-8-8v-4" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}

function RateVisual() {
  const faces = ["ðŸ˜Š", "ðŸ™‚", "ðŸ˜", "ðŸ˜•", "ðŸ˜£", "ðŸ˜­"];
  const [active, setActive] = useState(2);
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex gap-3">
        {faces.map((f, i) => (
          <button
            key={i}
            onClick={() => setActive(i)}
            className={`text-3xl transition-all ${i === active ? "scale-150" : "opacity-40 scale-100"}`}
          >
            {f}
          </button>
        ))}
      </div>
      <p className="text-sky-400 text-sm">Tap to try it</p>
    </div>
  );
}

function RemoveVisual() {
  const [on, setOn] = useState(true);
  return (
    <div className="flex flex-col items-center gap-4">
      <button
        onClick={() => setOn((v) => !v)}
        className={`w-16 h-16 rounded-full border-2 transition-all duration-300 text-2xl ${
          on
            ? "bg-rose-500/40 border-rose-400 scale-110"
            : "bg-white/5 border-white/20 scale-100 opacity-50"
        }`}
      >
        {on ? "ðŸ”´" : "â¬œ"}
      </button>
      <p className="text-sky-400 text-sm">Tap to toggle</p>
    </div>
  );
}

export default function TutorialPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const current = STEPS[step];

  function next() {
    if (step < STEPS.length - 1) setStep(step + 1);
    else router.push("/bodymap");
  }

  return (
    <KioskShell step={4}>
      <div className="flex flex-col items-center justify-center h-full gap-8 px-8 py-6">
        <div className="text-center">
          <p className="text-sky-400 text-sm font-semibold uppercase tracking-widest mb-2">
            Quick Demo
          </p>
          <h1 className="text-3xl font-bold text-white">{current.title}</h1>
          <p className="text-slate-400 mt-3 text-lg max-w-md">{current.desc}</p>
        </div>

        {/* Visual */}
        <div className="flex items-center justify-center h-48">
          {step === 0 && <TapVisual />}
          {step === 1 && <RateVisual />}
          {step === 2 && <RemoveVisual />}
        </div>

        {/* Dots */}
        <div className="flex gap-2">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`w-2.5 h-2.5 rounded-full transition-all ${
                i === step ? "bg-sky-400 w-6" : "bg-white/20"
              }`}
            />
          ))}
        </div>

        <button
          onClick={next}
          className="px-12 py-5 rounded-2xl bg-sky-500 hover:bg-sky-400 active:scale-95 transition-all text-white font-bold text-xl"
        >
          {step < STEPS.length - 1 ? "Next â†’" : "Got it â€” Start â†’"}
        </button>

        <button
          onClick={() => router.push("/bodymap")}
          className="text-slate-500 text-sm underline"
        >
          Skip tutorial
        </button>
      </div>
    </KioskShell>
  );
}
