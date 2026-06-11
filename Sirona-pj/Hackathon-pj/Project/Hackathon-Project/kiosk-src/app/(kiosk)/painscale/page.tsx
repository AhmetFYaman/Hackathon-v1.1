"use client";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import KioskShell from "@/components/KioskShell";
import { useKioskStore } from "@/store/kioskStore";

const FACES = [
  { emoji: "ðŸ˜Š", label: "No Pain",      value: 0,  color: "#22c55e" },
  { emoji: "ðŸ™‚", label: "Very Mild",    value: 2,  color: "#86efac" },
  { emoji: "ðŸ˜", label: "Mild",         value: 4,  color: "#facc15" },
  { emoji: "ðŸ˜•", label: "Moderate",     value: 6,  color: "#fb923c" },
  { emoji: "ðŸ˜£", label: "Severe",       value: 8,  color: "#ef4444" },
  { emoji: "ðŸ˜­", label: "Worst",        value: 10, color: "#7f1d1d" },
];

export default function PainScalePage() {
  const router = useRouter();
  const { selectedRegions, updateRegionPain } = useKioskStore();
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);

  const regions = selectedRegions.length > 0 ? selectedRegions : [];
  const current = regions[currentIdx];

  function confirm() {
    if (selected === null || !current) return;
    updateRegionPain(current.id, selected);
    if (currentIdx < regions.length - 1) {
      setCurrentIdx(currentIdx + 1);
      setSelected(null);
    } else {
      router.push("/processing");
    }
  }

  useEffect(() => {
    if (regions.length === 0) router.push("/processing");
  }, [regions.length]);

  const face = FACES.find((f) => f.value === selected);

  return (
    <KioskShell step={6}>
      <div className="flex flex-col items-center justify-center h-full gap-6 px-8 py-4">
        {/* Region header */}
        <div className="text-center">
          <p className="text-sky-400 text-sm uppercase tracking-widest mb-1">
            Area {currentIdx + 1} of {regions.length}
          </p>
          <h1 className="text-3xl font-bold text-white">
            {current?.label}
          </h1>
          <p className="text-slate-400 mt-2">
            How much does this area hurt right now?
          </p>
        </div>

        {/* Big selected face */}
        <div
          className="w-28 h-28 rounded-full flex items-center justify-center text-6xl transition-all duration-300"
          style={{
            background: face ? `${face.color}22` : "rgba(255,255,255,0.04)",
            border: `2px solid ${face ? face.color : "rgba(255,255,255,0.1)"}`,
          }}
        >
          {face ? face.emoji : "â“"}
        </div>

        {/* Face scale row */}
        <div className="flex gap-3 flex-wrap justify-center">
          {FACES.map((f) => (
            <button
              key={f.value}
              onClick={() => setSelected(f.value)}
              className={`flex flex-col items-center gap-1.5 p-3 rounded-2xl border transition-all active:scale-90 ${
                selected === f.value
                  ? "border-transparent scale-110"
                  : "border-white/10 bg-white/5 hover:bg-white/10"
              }`}
              style={
                selected === f.value
                  ? { background: `${f.color}30`, borderColor: f.color, boxShadow: `0 0 20px ${f.color}50` }
                  : {}
              }
            >
              <span className="text-4xl leading-none">{f.emoji}</span>
              <span className="text-xs text-slate-400">{f.label}</span>
              <span className="text-xs font-bold" style={{ color: f.color }}>{f.value}</span>
            </button>
          ))}
        </div>

        {/* Pain level slider label */}
        {selected !== null && (
          <div className="flex items-center gap-2">
            <div
              className="h-2 rounded-full transition-all duration-500"
              style={{
                width: `${(selected / 10) * 260}px`,
                maxWidth: "260px",
                background: `linear-gradient(to right, #22c55e, ${face?.color})`,
              }}
            />
            <span className="text-sm font-bold" style={{ color: face?.color }}>
              {selected}/10
            </span>
          </div>
        )}

        {/* Progress dots for multi-region */}
        {regions.length > 1 && (
          <div className="flex gap-2">
            {regions.map((_, i) => (
              <div
                key={i}
                className={`h-2 rounded-full transition-all ${
                  i < currentIdx
                    ? "bg-sky-500 w-6"
                    : i === currentIdx
                    ? "bg-white w-4"
                    : "bg-white/20 w-2"
                }`}
              />
            ))}
          </div>
        )}

        <button
          onClick={confirm}
          disabled={selected === null}
          className="px-14 py-5 rounded-2xl bg-sky-500 hover:bg-sky-400 active:scale-95 transition-all text-white font-bold text-xl disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {currentIdx < regions.length - 1 ? "Next Area â†’" : "Submit â†’"}
        </button>
      </div>
    </KioskShell>
  );
}
