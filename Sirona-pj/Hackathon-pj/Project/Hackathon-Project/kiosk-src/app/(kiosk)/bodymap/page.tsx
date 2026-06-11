"use client";
import { useRouter } from "next/navigation";
import KioskShell from "@/components/KioskShell";
import BodyMap from "@/components/BodyMap";
import { useKioskStore } from "@/store/kioskStore";

export default function BodyMapPage() {
  const router = useRouter();
  const { selectedRegions, removeRegion } = useKioskStore();

  return (
    <KioskShell step={5}>
      {/* Portrait layout: body diagram fills middle, controls at bottom */}
      <div className="flex flex-col h-full px-4 py-3 gap-3">

        {/* Header row */}
        <div className="shrink-0">
          <h1 className="text-xl font-bold text-white">Where does it hurt?</h1>
          <div className="flex items-center gap-3 mt-1.5">
            <div className="flex items-center gap-1.5 bg-sky-500/10 border border-sky-500/20 rounded-lg px-3 py-1.5">
              <span className="text-base">ðŸ‘†</span>
              <span className="text-xs text-sky-300">Tap the body to select pain areas</span>
            </div>
            {/* Selected region chips */}
            {selectedRegions.length > 0 && (
              <div className="flex gap-1.5 flex-wrap">
                {selectedRegions.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => removeRegion(r.id)}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs border border-white/10 bg-white/5"
                  >
                    <div
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: getPainColor(r.painLevel) }}
                    />
                    <span className="text-white">{r.label}</span>
                    <span className="text-slate-500 ml-0.5">âœ•</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Body map â€” takes all available middle space */}
        <div className="flex-1 min-h-0 flex items-center justify-center">
          <BodyMap />
        </div>

        {/* Action buttons â€” always visible at bottom */}
        <div className="flex flex-col gap-2 shrink-0 pb-1">
          <button
            onClick={() => router.push("/painscale")}
            disabled={selectedRegions.length === 0}
            className="w-full py-4 rounded-2xl bg-sky-500 hover:bg-sky-400 active:scale-95 transition-all text-white font-bold text-lg disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {selectedRegions.length === 0 ? "Tap the body to select an area" : `Rate Pain (${selectedRegions.length} area${selectedRegions.length > 1 ? "s" : ""}) â†’`}
          </button>
          <button
            onClick={() => router.push("/painscale")}
            className="text-slate-500 text-sm text-center py-1"
          >
            I have no pain â€” skip
          </button>
        </div>
      </div>
    </KioskShell>
  );
}

function getPainColor(level: number) {
  const colors = [
    "#22c55e","#4ade80","#a3e635","#facc15","#fb923c",
    "#f97316","#ef4444","#dc2626","#b91c1c","#991b1b","#7f1d1d",
  ];
  return colors[Math.min(level, 10)];
}
