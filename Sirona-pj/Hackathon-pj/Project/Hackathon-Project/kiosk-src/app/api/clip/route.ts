import { NextRequest, NextResponse } from "next/server";

// Receives the 5-second clip recorded by the kiosk browser and forwards it
// to the Jetson AI server. Same-origin for the browser, so it works no
// matter which IP/host the kiosk was opened from.

const JETSON_AI = process.env.JETSON_AI_URL ?? "http://localhost:8000";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  const sessionId = form.get("sessionId");

  if (!(file instanceof Blob) || typeof sessionId !== "string" || !sessionId) {
    return NextResponse.json({ error: "file and sessionId required" }, { status: 400 });
  }

  const upstream = new FormData();
  upstream.append("file", file, (file as File).name || "clip.webm");

  try {
    const res = await fetch(`${JETSON_AI}/video/${encodeURIComponent(sessionId)}`, {
      method: "POST",
      body: upstream,
      signal: AbortSignal.timeout(30_000),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    console.warn("[clip] Jetson AI unreachable:", (err as Error).message);
    return NextResponse.json({ error: "Jetson unavailable" }, { status: 503 });
  }
}
