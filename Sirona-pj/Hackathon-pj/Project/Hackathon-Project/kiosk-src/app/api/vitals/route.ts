import { NextRequest, NextResponse } from "next/server";

type VitalReading = {
  heartRate: number | null;
  spO2: number | null;
  temperature: number | null;
  bloodPressureSystolic: number | null;
  bloodPressureDiastolic: number | null;
  timestamp: number;
};

// Stored on globalThis so dev-mode module reloads don't wipe live readings
const g = globalThis as typeof globalThis & { __mkVitals?: VitalReading };
g.__mkVitals ??= {
  heartRate: null,
  spO2: null,
  temperature: null,
  bloodPressureSystolic: null,
  bloodPressureDiastolic: null,
  timestamp: 0,
};
let latest: VitalReading = g.__mkVitals;

// GET — vitals page polls this
export async function GET() {
  return NextResponse.json(g.__mkVitals ?? latest);
}

// POST — Pi script pushes readings here
// Accepts: heartRate, spO2, temperature, bloodPressureSystolic, bloodPressureDiastolic
export async function POST(req: NextRequest) {
  const body = await req.json();
  latest = g.__mkVitals = {
    heartRate: body.heartRate ?? latest.heartRate,
    spO2: body.spO2 ?? latest.spO2,
    temperature: body.temperature ?? latest.temperature,
    bloodPressureSystolic: body.bloodPressureSystolic ?? latest.bloodPressureSystolic,
    bloodPressureDiastolic: body.bloodPressureDiastolic ?? latest.bloodPressureDiastolic,
    timestamp: Date.now(),
  };
  return NextResponse.json({ ok: true });
}

// DELETE — called on session reset to clear stale data
export async function DELETE() {
  latest = g.__mkVitals = {
    heartRate: null, spO2: null, temperature: null,
    bloodPressureSystolic: null, bloodPressureDiastolic: null,
    timestamp: 0,
  };
  return NextResponse.json({ ok: true });
}
