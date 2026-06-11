# MediKiosk — Testing Notes & Improvement Log

> **STATUS: DRAFT** — more detail, test results from real Jetson + Pi 4B hardware,
> and future notes to be added before this is finalized.

---

## 1. Improvements so far (June 2026)

### Architecture / data flow
- Pi agent (`pi_sensor.py`) rewritten v3: **no live video streaming** — camera is
  opened only for the one 5-second clip, fully closed after. Two threads only:
  vitals push (1 s interval, keep-alive HTTP session) + clip recorder.
- 5-second clip can also be recorded **by the kiosk browser itself**
  (`getUserMedia` + `MediaRecorder`, 1280×720) and uploaded through the
  same-origin `/api/clip` proxy — used when the display device has its own
  camera (laptop demo). Both paths can coexist; the Pi path covers setups where
  the camera is at the sensor station.
- Jetson AI server accepts `.mp4` and `.webm` clips; analysis starts in the
  background the moment the upload lands, so results are ready before the
  patient finishes the pain questions.
- Networking: kiosk browser → same-origin proxy (`/api/session`, `/api/clip`)
  → Jetson AI server. No CORS/IP problems regardless of which device opens the
  kiosk. Direct `NEXT_PUBLIC_JETSON_AI_URL` is used only when it is reachable
  from the browser (never "localhost" from a remote device).

### AI pipeline
- **BP cuff display OCR v2** (the camera reads the home BP monitor's numbers):
  bright-screen region detection → crop + upscale → Otsu *and* adaptive
  thresholds, both polarities → shear correction for slanted LCD digits →
  seven-segment decode → multi-frame voting (≥2 frames must agree).
  Verified reading 139/93/78 from a simulated noisy, slanted, hand-held 720p
  capture. A display-OCR reading **overrides** the rPPG estimate and is marked
  final (`F`) in HL7; rPPG stays preliminary (`P`).
- **rPPG** (CHROM method) for HR / BP estimate / respiratory rate from the
  face; face detection every 5th frame with bbox reuse (Jetson CPU savings).
- **Distress AI**: MediaPipe face-mesh when installed; otherwise a new OpenCV
  fallback (head agitation + brow-furrow edge density + eye-squeeze) so
  distress is never silently 0. Distress now feeds both the rules engine and
  the Random Forest features.
- **ESI rebalanced**: self-reported pain is capped (max +5 risk, was +10) — a
  10/10 pain rating alone can no longer produce ESI 1-2 without abnormal
  vitals or AI-observed distress corroborating it. Distress weight raised.
- ESI = most conservative of: rules engine, Random Forest, Ollama LLM
  (llama3.2:3b, JSON-constrained output). All three logged per session.
- HL7 v2.5 ORU^R01 per session: correct `\r` segment terminators, ASCII-safe,
  LOINC-coded OBX (HR 8867-4, SpO2 59408-5, temp 8310-5, BP 55284-4, pain
  72514-3, weight 29463-7), patient name in PID, AL1 allergy segments,
  custom ZTR triage summary segment.

### Kiosk UI
- Camera consent folded into a **single line on the first consent page**
  (one-tap checkbox); dedicated camera-consent page removed. Flow is 7 steps.
- First/last name fields on consent → HL7 PID. Weight (kg) on intake → OBX.
- Vitals page shows a **live camera preview with an aiming guide box**
  ("hold BP display inside this box") + REC countdown during the 5 s clip.
- All color emojis replaced with inline SVG icons / ASCII tags — emoji fonts
  don't render on the Pi and other secondary displays.
- **Jetson Monitor dashboard at `/monitor`** (run on the Jetson's own screen):
  pulsing AI READY / AI WORKING status, playable received clip, stage-by-stage
  pipeline event feed, ESI summary card with vitals + sources + HL7 link.

### Infra
- `.gitignore` (node_modules, .next, models, clips, HL7 output, env files).
- `train_esi.py` model path configurable via `ESI_MODEL_PATH`.
- Stale clips auto-purged after 30 min; HL7 path-traversal protection.

---

## 2. What to check on real hardware (Jetson + Pi 4B + real BP monitor)

### Setup
- [ ] Jetson: `pip install fastapi uvicorn python-multipart httpx numpy scipy opencv-python scikit-learn`
- [ ] Jetson: `ESI_MODEL_PATH=... python3 AI-parts/train_esi.py` (generate model)
- [ ] Jetson: `ollama pull llama3.2:3b` (optional but recommended — LLM lane)
- [ ] Jetson: `pip install mediapipe` if a wheel exists for the JetPack Python
      version (better distress scoring; OpenCV fallback works without it)
- [ ] Jetson: start `python3 jetson_ai_server.py --host 0.0.0.0` + `npm run build && npm run start` in kiosk-src
- [ ] Pi: `python3 pi_sensor.py --server http://<jetson-ip>:3000 --real-sensors --real-camera`
- [ ] Pi browser (kiosk display): Chromium needs
      `--unsafely-treat-insecure-origin-as-secure=http://<jetson-ip>:3000 --user-data-dir=/tmp/kiosk-profile`
      if the browser-recording path is wanted on the Pi screen device
- [ ] Jetson screen: open `http://localhost:3000/monitor`

### Test checklist
- [ ] Vitals from real MAX30100/30102 + temp sensor appear on the vitals page
      within ~2 s and look plausible
- [ ] Camera consent line on consent page arms recording; recording triggers on
      the vitals page (Pi camera LED / monitor feed "[CLIP] received")
- [ ] **BP display OCR**: hold the real BP monitor inside the guide box, close
      and flat, screen bright, no glare. Watch the monitor feed:
      "[VIDEO-AI] Done — ... BP x/y (cuff display read)". Compare numbers with
      the actual device reading. Test at several distances/angles to find the
      reliable envelope.
- [ ] rPPG sanity: with a face (no BP monitor) in frame, HR estimate within
      ±15 BPM of the pulse oximeter
- [ ] Distress: grimace/frown during the clip → distress score rises in the
      monitor feed; calm face → low score
- [ ] ESI sanity: normal vitals + low pain → ESI 4-5; 10/10 pain alone →
      ESI 3 (not 1-2); abnormal vitals (hold breath for low SpO2 etc.) →
      ESI 2-3; chest pain + abnormal vitals → ESI 1-2
- [ ] HL7 file exists in HL7_DIR, opens, has patient name, weight, BP with
      correct F/P flag; ZTR segment populated
- [ ] Latency: clip upload → monitor "Done" (target < 10 s on Jetson);
      /analyze round trip with Ollama (target < 30 s)
- [ ] Jetson thermals/CPU during video analysis (`tegrastats`)
- [ ] Session reset: second patient gets fresh state (no stale vitals/clip)

### Known limits to keep in mind
- OCR needs the display large in the frame (fills most of the guide box),
  flat, well lit, minimal glare. Outside that envelope it deliberately reports
  nothing rather than guessing — rPPG estimate is the fallback.
- rPPG BP is approximate (±15-25 mmHg) and flagged preliminary.
- RF model is trained on synthetic rule-derived data — replace with a real
  triage dataset before any clinical claim.
- 5 s of video supports HR; respiratory rate from 5 s is rough.

---

## 3. Architecture note — where should the video AI run, and how do results reach the Pi screen?

**Question:** after the Jetson reads the data from the video, do we need to
send results back to the Pi for display? Or could the Pi 4B run the AI itself
and the Jetson act as just a database?

**Answer — current architecture already solves the display problem:**
The Pi does not need results "sent back" at all, because the Pi never renders
anything itself — its touchscreen shows a **browser pointed at the Next.js app
hosted on the Jetson**. The result page the patient sees on the Pi's screen IS
the Jetson's response arriving in that browser. The Pi pushes data up
(vitals JSON, one 5-second clip); pixels come back down as a web page. No
extra channel, no sync logic, nothing to build.

**Could the Pi 4B run the AI locally instead? Size of the AI involved:**
| Component | Size / load | Pi 4B feasible? |
|---|---|---|
| 7-seg display OCR (OpenCV) | tiny, CPU | Yes (~2-4× slower, fine) |
| rPPG vitals (OpenCV/scipy) | light-moderate | Yes, ~10-20 s per 5 s clip |
| Distress (OpenCV heuristic) | light | Yes |
| Distress (MediaPipe mesh) | moderate | Barely — a few FPS |
| Random Forest ESI | trivial (<1 MB) | Yes, instant |
| **Ollama llama3.2:3b LLM** | ~2 GB RAM, heavy compute | **Only on 8 GB Pi, ~1-3 tok/s → 1-3 min per triage. On Jetson (GPU): seconds.** |

So: the CV pieces could move to the Pi at the cost of a slower experience, but
the LLM is the deal-breaker — the whole reason the Jetson is in the design is
its GPU. Pi-as-AI + Jetson-as-database inverts the hardware's strengths:
the strongest compute would idle while the weakest does the heavy lifting.

**Recommendation:** keep the current split —
- **Pi 4B** = capture (sensors + one 5 s clip) + display (browser/kiosk UI)
- **Jetson** = web host + all AI (OCR, rPPG, distress, RF, LLM) + HL7 + storage

This is also the standard edge-AI pattern (thin sensor/display node, fat
inference node) and means one place to update models, one place where PHI
video ever exists, one place to secure.

*(If the team ever wants a Pi-only demo without a Jetson: drop the LLM lane,
keep rules + RF + OCR + rPPG on the Pi — it works, just slower. The code paths
already degrade gracefully in exactly that order.)*

---

## 4. Future notes / to-do (to be expanded)

- [ ] HL7 delivery: MLLP (port 2575) or Mirth Connect integration instead of
      file drop; TLS on all links (PHI on the network)
- [ ] Retry-with-backoff on Pi clip upload
- [ ] Train ESI model on a real triage dataset
- [ ] *(add your items here before finalizing)*
