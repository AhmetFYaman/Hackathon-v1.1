import { NextRequest, NextResponse } from "next/server";

// Proxies the completed session payload to the Jetson AI server.
// The processing page calls this directly, but this route exists as a
// backup proxy and for logging purposes.

const JETSON_AI = process.env.JETSON_AI_URL ?? "http://localhost:8000";

export async function POST(req: NextRequest) {
  const session = await req.json();

  try {
    const res = await fetch(`${JETSON_AI}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(session),
      // Must outlast the Jetson's Ollama call (~25s) plus video analysis
      signal: AbortSignal.timeout(40_000),
    });

    if (!res.ok) {
      throw new Error(`Jetson returned ${res.status}`);
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.warn("[session] Jetson AI unavailable:", (err as Error).message);
    return NextResponse.json({ error: "Jetson unavailable" }, { status: 503 });
  }
}

// GET returns current Jetson health status
export async function GET() {
  try {
    const res = await fetch(`${JETSON_AI}/status`, { signal: AbortSignal.timeout(3_000) });
    const data = await res.json();
    return NextResponse.json({ online: true, ...data });
  } catch {
    return NextResponse.json({ online: false });
  }
}
