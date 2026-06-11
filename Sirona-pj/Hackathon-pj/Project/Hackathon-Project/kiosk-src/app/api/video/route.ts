import { NextRequest, NextResponse } from "next/server";

// In-memory video recording state — one patient at a time
type VideoState = {
  shouldRecord: boolean;
  sessionId: string | null;
  consentGiven: boolean;
  recordingStartedAt: number | null;
};

// Stored on globalThis so dev-mode module reloads don't drop the trigger
const g = globalThis as typeof globalThis & { __mkVideo?: VideoState };
g.__mkVideo ??= {
  shouldRecord: false,
  sessionId: null,
  consentGiven: false,
  recordingStartedAt: null,
};
let state: VideoState = g.__mkVideo;

// GET — Pi agent polls this to know when to start recording
export async function GET() {
  return NextResponse.json(g.__mkVideo ?? state);
}

// POST — Three actions:
//   { action: "consent_given" }              — patient consented to camera
//   { action: "start_recording", sessionId } — vitals page triggers recording
//   { action: "reset" }                      — session reset
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action, sessionId } = body;
  state = g.__mkVideo!;

  if (action === "consent_given") {
    state.consentGiven = true;
    return NextResponse.json({ ok: true });
  }

  if (action === "start_recording") {
    if (state.consentGiven) {
      state.shouldRecord = true;
      state.sessionId = sessionId ?? null;
      state.recordingStartedAt = Date.now();
    }
    return NextResponse.json({ ok: true, recording: state.shouldRecord });
  }

  if (action === "recording_done") {
    state.shouldRecord = false;
    return NextResponse.json({ ok: true });
  }

  if (action === "reset") {
    state = g.__mkVideo = { shouldRecord: false, sessionId: null, consentGiven: false, recordingStartedAt: null };
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

export async function DELETE() {
  state = g.__mkVideo = { shouldRecord: false, sessionId: null, consentGiven: false, recordingStartedAt: null };
  return NextResponse.json({ ok: true });
}
