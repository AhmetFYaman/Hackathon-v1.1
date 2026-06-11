"use client";
import { useState } from "react";
import { useKioskStore, BodyRegion } from "@/store/kioskStore";

// Anatomical body regions with SVG path data + center points for labels
// Viewbox: 0 0 200 400 — front + back side by side
export const BODY_REGIONS: Omit<BodyRegion, "painLevel">[] = [
  // ── FRONT ──
  { id: "head-front",     label: "Head",          x: 50,  y: 18  },
  { id: "neck-front",     label: "Neck",          x: 50,  y: 40  },
  { id: "chest-left",     label: "Left Chest",    x: 36,  y: 60  },
  { id: "chest-right",    label: "Right Chest",   x: 64,  y: 60  },
  { id: "abdomen",        label: "Abdomen",       x: 50,  y: 82  },
  { id: "pelvis-front",   label: "Pelvis",        x: 50,  y: 105 },
  { id: "l-shoulder",     label: "L. Shoulder",   x: 20,  y: 52  },
  { id: "r-shoulder",     label: "R. Shoulder",   x: 80,  y: 52  },
  { id: "l-arm",          label: "L. Upper Arm",  x: 12,  y: 74  },
  { id: "r-arm",          label: "R. Upper Arm",  x: 88,  y: 74  },
  { id: "l-forearm",      label: "L. Forearm",    x: 8,   y: 96  },
  { id: "r-forearm",      label: "R. Forearm",    x: 92,  y: 96  },
  { id: "l-hand",         label: "L. Hand",       x: 5,   y: 115 },
  { id: "r-hand",         label: "R. Hand",       x: 95,  y: 115 },
  { id: "l-thigh",        label: "L. Thigh",      x: 38,  y: 135 },
  { id: "r-thigh",        label: "R. Thigh",      x: 62,  y: 135 },
  { id: "l-knee",         label: "L. Knee",       x: 36,  y: 163 },
  { id: "r-knee",         label: "R. Knee",       x: 64,  y: 163 },
  { id: "l-shin",         label: "L. Shin",       x: 36,  y: 185 },
  { id: "r-shin",         label: "R. Shin",       x: 64,  y: 185 },
  { id: "l-foot",         label: "L. Foot",       x: 34,  y: 210 },
  { id: "r-foot",         label: "R. Foot",       x: 66,  y: 210 },
];

// SVG paths for front body silhouette regions
const REGION_PATHS: Record<string, string> = {
  "head-front":   "M40,4 Q50,0 60,4 Q68,8 68,20 Q68,36 50,38 Q32,36 32,20 Q32,8 40,4Z",
  "neck-front":   "M44,38 Q50,36 56,38 L57,47 Q50,49 43,47Z",
  "chest-left":   "M43,49 Q37,52 26,54 Q20,56 18,65 Q16,74 20,78 L30,78 L38,80 L43,72 Z",
  "chest-right":  "M57,49 Q63,52 74,54 Q80,56 82,65 Q84,74 80,78 L70,78 L62,80 L57,72 Z",
  "abdomen":      "M38,80 Q50,82 62,80 L64,102 Q50,106 36,102Z",
  "pelvis-front": "M36,102 Q50,106 64,102 L66,116 Q50,120 34,116Z",
  "l-shoulder":   "M26,54 Q18,56 14,62 L18,68 Q22,65 26,62Z",
  "r-shoulder":   "M74,54 Q82,56 86,62 L82,68 Q78,65 74,62Z",
  "l-arm":        "M14,62 Q8,68 6,82 L12,84 Q16,72 18,68Z",
  "r-arm":        "M86,62 Q92,68 94,82 L88,84 Q84,72 82,68Z",
  "l-forearm":    "M6,82 Q3,96 4,108 L10,108 Q10,96 12,84Z",
  "r-forearm":    "M94,82 Q97,96 96,108 L90,108 Q90,96 88,84Z",
  "l-hand":       "M4,108 Q2,116 4,120 Q6,122 10,120 L10,108Z",
  "r-hand":       "M96,108 Q98,116 96,120 Q94,122 90,120 L90,108Z",
  "l-thigh":      "M36,116 Q34,130 33,152 L42,154 Q42,130 43,116Z",
  "r-thigh":      "M64,116 Q66,130 67,152 L58,154 Q58,130 57,116Z",
  "l-knee":       "M33,152 Q32,162 33,170 L42,170 Q43,162 42,154Z",
  "r-knee":       "M67,152 Q68,162 67,170 L58,170 Q57,162 58,154Z",
  "l-shin":       "M33,170 Q32,188 33,200 L41,200 Q41,188 42,170Z",
  "r-shin":       "M67,170 Q68,188 67,200 L59,200 Q59,188 58,170Z",
  "l-foot":       "M33,200 Q30,208 31,214 Q34,218 40,216 L41,200Z",
  "r-foot":       "M67,200 Q70,208 69,214 Q66,218 60,216 L59,200Z",
};

const PAIN_COLORS = [
  "#22c55e", // 0 – green
  "#4ade80",
  "#a3e635",
  "#facc15",
  "#fb923c", // 4
  "#f97316",
  "#ef4444",
  "#dc2626",
  "#b91c1c", // 8
  "#991b1b",
  "#7f1d1d", // 10 – deep red
];

export default function BodyMap() {
  const { selectedRegions, addRegion, removeRegion } = useKioskStore();
  const [activeLabel, setActiveLabel] = useState<string | null>(null);

  function toggleRegion(regionId: string) {
    const existing = selectedRegions.find((r) => r.id === regionId);
    if (existing) {
      removeRegion(regionId);
      if (activeLabel === regionId) setActiveLabel(null);
    } else {
      const def = BODY_REGIONS.find((r) => r.id === regionId)!;
      addRegion({ ...def, painLevel: 5 });
      setActiveLabel(regionId);
    }
  }

  function getColor(regionId: string) {
    const r = selectedRegions.find((s) => s.id === regionId);
    if (!r) return null;
    return PAIN_COLORS[r.painLevel];
  }

  return (
    <div className="relative flex justify-center">
      <svg
        viewBox="0 0 100 225"
        className="w-full max-w-[220px] md:max-w-[280px]"
        style={{ filter: "drop-shadow(0 0 20px rgba(14,165,233,0.15))" }}
      >
        {/* Body silhouette base */}
        <rect x="0" y="0" width="100" height="225" fill="transparent" />

        {/* Render each region */}
        {BODY_REGIONS.map((region) => {
          const path = REGION_PATHS[region.id];
          const color = getColor(region.id);
          const isSelected = !!color;

          return (
            <g key={region.id} onClick={() => toggleRegion(region.id)} style={{ cursor: "pointer" }}>
              <path
                d={path}
                fill={isSelected ? color : "rgba(148,163,184,0.18)"}
                stroke={isSelected ? color : "rgba(148,163,184,0.35)"}
                strokeWidth="0.6"
                className={isSelected ? "region-selected" : ""}
                style={{
                  transition: "fill 0.3s, filter 0.3s",
                  filter: isSelected ? `drop-shadow(0 0 4px ${color})` : "none",
                }}
              />
              {/* Invisible larger hit area for easier touch */}
              <path
                d={path}
                fill="transparent"
                stroke="transparent"
                strokeWidth="4"
                style={{ cursor: "pointer" }}
              />
            </g>
          );
        })}

        {/* Body outline (decorative) */}
        <path
          d="M40,4 Q50,0 60,4 Q68,8 68,20 Q68,36 50,38 Q32,36 32,20 Q32,8 40,4Z
             M44,38 Q50,36 56,38 L57,47 Q50,49 43,47Z
             M43,49 Q20,54 18,65 Q14,82 20,120 L34,120 Q36,102 50,100 Q64,102 66,120 L80,120 Q86,82 82,65 Q80,54 57,49Z
             M34,120 Q32,155 33,200 Q30,210 34,218 Q40,220 42,216 L42,200 L42,154 L43,120Z
             M66,120 Q68,155 67,200 Q70,210 66,218 Q60,220 58,216 L58,200 L58,154 L57,120Z
             M20,65 Q10,62 6,82 Q2,108 4,120 L10,120 L10,108 Q3,96 14,68Z
             M80,65 Q90,62 94,82 Q98,108 96,120 L90,120 L90,108 Q97,96 86,68Z"
          fill="none"
          stroke="rgba(148,163,184,0.15)"
          strokeWidth="0.4"
        />
      </svg>
    </div>
  );
}
