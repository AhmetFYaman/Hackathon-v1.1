#!/usr/bin/env python3
"""
MediKiosk — Jetson AI Server  v2
FastAPI server running on the Jetson Nano/Orin.

New in v2:
  - rPPG heart rate + blood pressure estimation from the 5-second video clip
  - Random Forest ESI model (trained by AI-parts/train_esi.py)
  - Ollama LLM for clinical reasoning (install: ollama pull llama3.2:3b)
  - Background video pre-processing (results ready before /analyze is called)
  - /process/video + /analyze/llm endpoints (compatible with AI-parts/pi_server.py)

Start:
    python3 jetson_ai_server.py

Environment variables:
    OLLAMA_URL        Ollama base URL  (default: http://localhost:11434)
    OLLAMA_MODEL      Model name       (default: llama3.2:3b)
    ESI_MODEL_PATH    Path to pkl      (default: /home/sana/esi_model.pkl)
    HL7_DIR           HL7 output dir   (default: /opt/medikiosk/hl7)
    VIDEO_TEMP_DIR    Tmp video dir    (default: /tmp/medikiosk_video)

Install deps:
    pip install fastapi uvicorn python-multipart aiofiles httpx
    pip install opencv-python scipy numpy     # rPPG analysis
    pip install mediapipe                     # distress score (optional, falls back)
    pip install scikit-learn                  # Random Forest ESI model

Install Ollama on Jetson:
    curl -fsSL https://ollama.com/install.sh | sh
    ollama pull llama3.2:3b

Train ESI model:
    python3 AI-parts/train_esi.py
"""

import argparse
import asyncio
import concurrent.futures
import json
import logging
import os
import re
import shutil
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

# ── Config ─────────────────────────────────────────────────────────────────────

HL7_DIR        = Path(os.getenv("HL7_DIR",        "/opt/medikiosk/hl7"))
VIDEO_TEMP_DIR = Path(os.getenv("VIDEO_TEMP_DIR", "/tmp/medikiosk_video"))
ESI_MODEL_PATH = Path(os.getenv("ESI_MODEL_PATH", "/home/sana/esi_model.pkl"))
OLLAMA_URL     = os.getenv("OLLAMA_URL",   "http://localhost:11434")
OLLAMA_MODEL   = os.getenv("OLLAMA_MODEL", "llama3.2:3b")
LOG_LEVEL      = os.getenv("LOG_LEVEL",    "INFO")

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL),
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("jetson_ai")

_executor = concurrent.futures.ThreadPoolExecutor(max_workers=2)

# ── Monitor state — feeds the /monitor dashboard on the Jetson screen ──────────

from collections import deque

_mon_events: deque = deque(maxlen=60)
_mon_state: dict = {"busy": False, "stage": "idle", "lastClip": None, "lastResult": None}


def _mon(stage: str, message: str, busy: Optional[bool] = None) -> None:
    """Record a pipeline event for the live dashboard."""
    _mon_events.appendleft({
        "ts":      datetime.utcnow().isoformat() + "Z",
        "stage":   stage,
        "message": message,
    })
    _mon_state["stage"] = stage
    if busy is not None:
        _mon_state["busy"] = busy

# ── Load ESI Random Forest model ───────────────────────────────────────────────

_esi_model = None

def _load_esi_model() -> None:
    global _esi_model
    if not ESI_MODEL_PATH.exists():
        log.warning(
            f"[MODEL] ESI model not found at {ESI_MODEL_PATH}. "
            "Run: python3 AI-parts/train_esi.py"
        )
        return
    try:
        import pickle
        with open(ESI_MODEL_PATH, "rb") as f:
            _esi_model = pickle.load(f)
        log.info(f"[MODEL] Loaded RandomForest ESI model from {ESI_MODEL_PATH}")
    except Exception as e:
        log.error(f"[MODEL] Load failed: {e}")


# ── Pydantic models ─────────────────────────────────────────────────────────────

class Vitals(BaseModel):
    heartRate:             Optional[float] = None
    spO2:                  Optional[float] = None
    temperature:           Optional[float] = None   # °F
    bloodPressureSystolic: Optional[float] = None
    bloodPressureDiastolic:Optional[float] = None
    status: str = "done"

class BodyRegion(BaseModel):
    id:         str
    label:      str
    x:          float
    y:          float
    painLevel:  float

class IntakeData(BaseModel):
    chiefComplaints:     list[str] = []
    chiefComplaintNote:  str = ""
    ageGroup:            Optional[str] = None   # under18|18-40|41-65|over65
    sex:                 Optional[str] = None   # male|female|nonbinary|prefer-not
    weightKg:            Optional[float] = None
    conditions:          list[str] = []
    allergies:           list[str] = []
    cameraConsent:       bool = False

class SessionPayload(BaseModel):
    sessionId:  str
    vitals:     Vitals
    intake:     Optional[IntakeData] = None
    regions:    list[BodyRegion] = []
    facialData: Optional[dict] = None
    firstName:  Optional[str] = None
    lastName:   Optional[str] = None
    timestamp:  str

class LLMAnalysisRequest(BaseModel):
    """Compatible with AI-parts/pi_server.py /analyze/llm endpoint."""
    systolic_bp:       float = 120
    diastolic_bp:      float = 80
    spo2:              float = 98
    pulse:             float = 80
    temp_c:            float = 37.0
    chief_complaint:   str   = ""
    distress_score:    float = 0
    respiratory_rate:  float = 16
    age:               int   = 40


# ── Shared face detector (loading the cascade once saves ~100ms per call) ─────

_face_cascade_cache = None

def _get_face_cascade():
    global _face_cascade_cache
    if _face_cascade_cache is None:
        import cv2
        _face_cascade_cache = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        )
    return _face_cascade_cache


# ── BP cuff display reader — seven-segment OCR ─────────────────────────────────

# Standard seven-segment encoding: (A, B, C, D, E, F, G)
_SEG_DIGITS = {
    (1, 1, 1, 1, 1, 1, 0): 0,
    (0, 1, 1, 0, 0, 0, 0): 1,
    (1, 1, 0, 1, 1, 0, 1): 2,
    (1, 1, 1, 1, 0, 0, 1): 3,
    (0, 1, 1, 0, 0, 1, 1): 4,
    (1, 0, 1, 1, 0, 1, 1): 5,
    (1, 0, 1, 1, 1, 1, 1): 6,
    (1, 1, 1, 0, 0, 0, 0): 7,
    (1, 1, 1, 1, 1, 1, 1): 8,
    (1, 1, 1, 1, 0, 1, 1): 9,
}


def _find_screen_region(gray):
    """Locate the bright LCD/phone-screen blob in a frame. Returns box or None."""
    import cv2
    import numpy as np

    thr = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
    thr = cv2.morphologyEx(thr, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    contours, _ = cv2.findContours(thr, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    best = None
    for c in contours:
        x, y, w, h = cv2.boundingRect(c)
        area = w * h
        if area < 1500:
            continue
        ar = w / h
        if 0.2 < ar < 5.0 and (best is None or area > best[4]):
            best = (x, y, w, h, area)
    return best[:4] if best else None


def _decode_seven_segment_digit(roi) -> Optional[int]:
    """Decode one binarized digit ROI (white segments on black) to 0-9."""
    import cv2

    h, w = roi.shape[:2]
    if h < 14 or w < 3:
        return None

    # A digit "1" has no lit left-column segments → very narrow bounding box
    if w / h < 0.34:
        fill = cv2.countNonZero(roi) / (h * w)
        return 1 if fill > 0.35 else None

    # Sample regions for the 7 segments (fractions of the bounding box)
    sw, sh = max(2, int(w * 0.30)), max(2, int(h * 0.18))
    segments = {
        "A": roi[0:sh,                       int(w*0.2):int(w*0.85)],
        "B": roi[int(h*0.08):int(h*0.45),    w - sw:w],
        "C": roi[int(h*0.55):int(h*0.92),    w - sw:w],
        "D": roi[h - sh:h,                   int(w*0.15):int(w*0.8)],
        "E": roi[int(h*0.55):int(h*0.92),    0:sw],
        "F": roi[int(h*0.08):int(h*0.45),    0:sw],
        "G": roi[int(h*0.42):int(h*0.58),    int(w*0.2):int(w*0.8)],
    }
    state = []
    for key in "ABCDEFG":
        seg = segments[key]
        if seg.size == 0:
            return None
        state.append(1 if cv2.countNonZero(seg) / seg.size > 0.40 else 0)
    return _SEG_DIGITS.get(tuple(state))


def _decode_rows_in_binary(binary) -> list[tuple[float, int]]:
    """Find digit rows in a binarized image → [(y_center, number), …]."""
    import cv2

    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    H = binary.shape[0]
    boxes = []
    for c in contours:
        x, y, w, h = cv2.boundingRect(c)
        if h < 20 or h > H * 0.5:
            continue
        if not (0.04 <= w / h <= 0.95):
            continue
        boxes.append((x, y, w, h))
    if not boxes:
        return []

    boxes.sort(key=lambda b: b[1])
    rows: list[list[tuple[int, int, int, int]]] = []
    for b in boxes:
        for row in rows:
            ry, rh = row[0][1], row[0][3]
            if abs(b[1] - ry) < 0.5 * max(rh, b[3]) and abs(b[3] - rh) < 0.4 * max(rh, b[3]):
                row.append(b)
                break
        else:
            rows.append([b])

    out: list[tuple[float, int]] = []
    for row in rows:
        if not (2 <= len(row) <= 3):
            continue
        row.sort(key=lambda b: b[0])
        digits = []
        for x, y, w, h in row:
            d = _decode_seven_segment_digit(binary[y:y+h, x:x+w])
            if d is None:
                digits = None
                break
            digits.append(d)
        if digits:
            out.append((row[0][1] + row[0][3] / 2, int("".join(map(str, digits)))))
    out.sort()
    return out


def _read_bp_numbers_in_frame(gray) -> list[int]:
    """
    Find seven-segment digit groups in one grayscale frame.

    Robustness for real webcam captures:
      - locates the bright screen region, crops and upscales it
      - adaptive threshold in both polarities (dark-on-light / light-on-dark)
      - shear correction for slanted LCD digits
    Returns decoded numbers ordered top-to-bottom (SYS above DIA above PULSE).
    """
    import cv2
    import numpy as np

    candidates: list[tuple[str, "np.ndarray"]] = []
    box = _find_screen_region(gray)
    if box:
        x, y, w, h = box
        m = int(0.05 * max(w, h))
        crop = gray[max(0, y - m):y + h + m, max(0, x - m):x + w + m]
        scale = max(2.0, 220.0 / max(crop.shape[0], 1))
        crop = cv2.resize(crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
        candidates.append(("screen", crop))
    candidates.append(("full", cv2.resize(gray, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)))

    kernel3 = np.ones((3, 3), np.uint8)
    kernel2 = np.ones((2, 2), np.uint8)

    for _, g in candidates:
        g = cv2.GaussianBlur(g, (3, 3), 0)
        for shear in (0.0, -0.15, -0.3):   # LCD digits lean right
            if shear != 0.0:
                Hh, Ww = g.shape
                M = np.float32([[1, shear, 0], [0, 1, 0]])
                gs = cv2.warpAffine(
                    g, M, (Ww + int(abs(shear) * Hh), Hh),
                    borderValue=int(np.median(g)),
                )
            else:
                gs = g
            binaries = []
            for inv in (True, False):
                flag = cv2.THRESH_BINARY_INV if inv else cv2.THRESH_BINARY
                # Global Otsu: best for clean, evenly lit displays — adaptive
                # thresholding hollows out large solid digit segments
                binaries.append(cv2.threshold(gs, 0, 255, flag + cv2.THRESH_OTSU)[1])
                # Adaptive: best for uneven lighting / glare on real captures
                binaries.append(cv2.adaptiveThreshold(
                    gs, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, flag, 35, 12,
                ))

            for binary in binaries:
                binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel3)
                binary = cv2.dilate(binary, kernel2)
                rows = _decode_rows_in_binary(binary)
                if not rows:
                    continue
                values = [v for _, v in rows]
                # Early exit on the first config that yields a plausible BP pair
                has_sys = any(70 <= v <= 250 for v in values)
                has_dia = any(40 <= v <= 150 for v in values)
                if has_sys and has_dia:
                    return values
    return []


def read_bp_display_from_video(video_path: Path) -> dict:
    """
    Read systolic/diastolic/pulse from a home BP monitor display held up
    to the camera. Samples frames across the clip and requires at least
    two frames to agree on the same (SYS, DIA) pair before reporting.

    Returns {} or {bpSystolic, bpDiastolic, pulse?, bpConfidence, source}.
    """
    try:
        import cv2
    except ImportError:
        return {}

    cap = cv2.VideoCapture(str(video_path))

    from collections import Counter
    candidates: Counter = Counter()
    pulses: list[int] = []

    # Read sequentially with a stride — CAP_PROP_FRAME_COUNT / frame seeking
    # is unreliable for browser-recorded WebM clips, so never depend on it.
    sampled = 0
    frame_idx = -1
    while sampled < 12:
        ok, frame = cap.read()
        if not ok:
            break
        frame_idx += 1
        if frame_idx % 7 != 0:     # ~2 samples/second at 15 fps
            continue
        sampled += 1
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        values = _read_bp_numbers_in_frame(gray)

        # Map top-to-bottom rows onto SYS / DIA / PULSE with sanity ranges
        sys_v = dia_v = pul_v = None
        for v in values:
            if sys_v is None and 70 <= v <= 250:
                sys_v = v
            elif dia_v is None and 40 <= v <= 150 and sys_v and v < sys_v:
                dia_v = v
            elif pul_v is None and 30 <= v <= 200:
                pul_v = v
        if sys_v and dia_v:
            candidates[(sys_v, dia_v)] += 1
            if pul_v:
                pulses.append(pul_v)

    cap.release()

    if not candidates:
        return {}

    (sbp, dbp), votes = candidates.most_common(1)[0]
    if votes < 2:   # one-frame readings are too often misdecodes
        log.info(f"[BP-OCR] Unconfirmed reading {sbp}/{dbp} (1 frame) — discarded")
        return {}

    result = {
        "bpSystolic":   sbp,
        "bpDiastolic":  dbp,
        "bpConfidence": round(min(0.95, 0.5 + votes * 0.15), 2),
        "source":       "bp_display",
    }
    if pulses:
        result["pulse"] = int(sorted(pulses)[len(pulses) // 2])
    log.info(f"[BP-OCR] Cuff display read: {sbp}/{dbp} mmHg  ({votes} frames agree)")
    return result


# ── rPPG — Heart rate + BP from video ─────────────────────────────────────────

def extract_rppg_vitals(video_path: Path) -> dict:
    """
    Remote photoplethysmography (rPPG) from a 5-second facial video.

    Uses the CHROM method (de Haan & Jeanne, 2013) on the forehead ROI
    to extract a cardiac signal, then estimates:
      - Heart rate       (reliable with ≥4 visible beats)
      - Blood pressure   (approximate; uses pulse wave morphology features)
      - Respiratory rate (from low-frequency rPPG component)

    Returns dict with: heartRate, bpSystolic, bpDiastolic, bpConfidence,
                       respiratoryRate, confidence, faceDetected, source
    confidence=0.0 means the analysis failed or face was not detected.
    """
    result: dict = {"faceDetected": False, "confidence": 0.0, "source": "rppg"}

    try:
        import cv2
        import numpy as np
    except ImportError:
        log.warning("[rPPG] opencv-python not installed — skipping video BP")
        return result

    try:
        from scipy.signal import butter, filtfilt, find_peaks
    except ImportError:
        log.warning("[rPPG] scipy not installed — skipping video BP")
        return result

    cap = cv2.VideoCapture(str(video_path))
    fps = cap.get(cv2.CAP_PROP_FPS)
    fps = fps if fps and fps > 5.0 else 15.0

    face_cascade = _get_face_cascade()

    r_sig: list[float] = []
    g_sig: list[float] = []
    b_sig: list[float] = []

    # The face barely moves within 1/3 s, so re-detecting every frame wastes
    # most of the Jetson CPU budget — detect every 5th frame, reuse the box.
    last_face: Optional[tuple] = None
    frame_idx = -1

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        frame_idx += 1

        if frame_idx % 5 == 0 or last_face is None:
            gray  = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            faces = face_cascade.detectMultiScale(
                gray, scaleFactor=1.1, minNeighbors=5, minSize=(60, 60)
            )
            last_face = max(faces, key=lambda f: f[2] * f[3]) if len(faces) else None

        if last_face is None:
            continue

        x, y, w, h = last_face
        result["faceDetected"] = True

        # Forehead ROI: rows 8-38% of face height, cols 20-80%
        ry1, ry2 = y + int(h * 0.08), y + int(h * 0.38)
        rx1, rx2 = x + int(w * 0.20), x + int(w * 0.80)
        roi = frame[ry1:ry2, rx1:rx2]
        if roi.size == 0:
            continue

        b_ch, g_ch, r_ch = cv2.split(roi)
        r_sig.append(float(np.mean(r_ch)))
        g_sig.append(float(np.mean(g_ch)))
        b_sig.append(float(np.mean(b_ch)))

    cap.release()

    # Need at least 2 s of face-visible frames
    n = len(g_sig)
    if n < max(int(fps * 2.0), 20):
        log.info(f"[rPPG] Only {n} face frames — insufficient for analysis")
        return result

    r = np.array(r_sig)
    g = np.array(g_sig)
    b = np.array(b_sig)

    # CHROM rPPG — cancels motion artifacts using two chrominance channels
    r_n = r / (np.mean(r) + 1e-8)
    g_n = g / (np.mean(g) + 1e-8)
    b_n = b / (np.mean(b) + 1e-8)
    x_ch = 3.0 * r_n - 2.0 * g_n
    y_ch = 1.5 * r_n + g_n - 1.5 * b_n
    alpha = float(np.std(x_ch) / (np.std(y_ch) + 1e-8))
    rppg_signal = x_ch - alpha * y_ch

    # Bandpass: 0.75–3.5 Hz → 45–210 BPM
    nyq  = fps / 2.0
    low  = 0.75 / nyq
    high = min(3.5 / nyq, 0.98)
    b_c, a_c = butter(4, [low, high], btype="band")
    filtered = filtfilt(b_c, a_c, rppg_signal)

    min_dist = int(fps * 0.30)
    peaks, _ = find_peaks(filtered, distance=min_dist, prominence=0.03)

    if len(peaks) < 2:
        log.info(f"[rPPG] Insufficient peaks ({len(peaks)}) — HR not detected")
        return result

    rr_intervals = np.diff(peaks) / fps    # seconds
    hr = round(60.0 / float(np.mean(rr_intervals)), 1)

    if not (40.0 <= hr <= 200.0):
        log.info(f"[rPPG] HR {hr} outside physiological range")
        return result

    result["heartRate"] = hr
    # Confidence: scales with number of detected beats (full at ≥7 beats)
    hr_conf = float(min(1.0, len(peaks) / 7.0))
    result["confidence"] = round(hr_conf, 2)
    log.info(f"[rPPG] HR={hr} BPM  peaks={len(peaks)}  conf={hr_conf:.2f}")

    # ── BP estimation from pulse wave morphology ───────────────────────────────
    # Features extracted from inter-beat signal segments:
    #   amplitude_cv  — coefficient of variation of peak amplitudes
    #                   (higher = more vascular resistance = higher DBP)
    #   rise_frac     — fraction of beat period before systolic peak
    #                   (larger = slower rise = stiffer vessels = higher BP)
    # These are first-order approximations — accuracy ≈ ±15-25 mmHg.
    segs = [
        filtered[peaks[i]:peaks[i + 1]]
        for i in range(len(peaks) - 1)
        if peaks[i + 1] - peaks[i] > 3
    ]
    if segs:
        amps = np.array([float(np.max(s) - np.min(s)) for s in segs])
        rise = np.array([
            float(np.argmax(s)) / max(len(s), 1) for s in segs
        ])
        hr_delta  = hr - 70.0
        amp_cv    = float(np.std(amps) / (np.mean(amps) + 1e-8))
        mean_rise = float(np.mean(rise))

        sbp = 115 + 0.38 * hr_delta + 10.0 * mean_rise + 8.0 * amp_cv
        dbp = 75  + 0.20 * hr_delta +  6.0 * mean_rise + 5.0 * amp_cv

        result["bpSystolic"]   = int(max(85,  min(190, sbp)))
        result["bpDiastolic"]  = int(max(50,  min(115, dbp)))
        result["bpConfidence"] = round(hr_conf * 0.55, 2)  # BP less reliable than HR
        log.info(
            f"[rPPG] BP~{result['bpSystolic']}/{result['bpDiastolic']}  "
            f"bp_conf={result['bpConfidence']:.2f}"
        )

    # ── Respiratory rate from low-frequency component ─────────────────────────
    try:
        rlo = max(0.10 / nyq, 0.001)
        rhi = min(0.50 / nyq, 0.99)
        if rlo < rhi:
            b_r, a_r = butter(2, [rlo, rhi], btype="band")
            resp_sig  = filtfilt(b_r, a_r, rppg_signal)
            resp_pks, _ = find_peaks(resp_sig, distance=int(fps * 1.8))
            if len(resp_pks) >= 2:
                rr_resp = float(np.mean(np.diff(resp_pks) / fps))
                rr_bpm  = round(60.0 / rr_resp, 1)
                if 8.0 <= rr_bpm <= 35.0:
                    result["respiratoryRate"] = rr_bpm
                    log.info(f"[rPPG] RR={rr_bpm} /min")
    except Exception:
        pass

    return result


def estimate_age_from_video(video_path: Path) -> Optional[int]:
    """
    Rough age estimate from forehead skin texture (Laplacian variance).
    Low variance → smooth skin → younger.  Very approximate (±15 years).
    Returns None if face not detected.
    """
    try:
        import cv2
        import numpy as np
    except ImportError:
        return None

    cap = cv2.VideoCapture(str(video_path))
    face_cascade = _get_face_cascade()

    texture_vars: list[float] = []
    frame_limit = 30
    frame_count = 0

    while frame_count < frame_limit:
        ok, frame = cap.read()
        if not ok:
            break
        frame_count += 1

        gray  = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = face_cascade.detectMultiScale(gray, 1.1, 5, minSize=(80, 80))
        if len(faces) == 0:
            continue

        x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
        fh = gray[
            y + int(h * 0.05) : y + int(h * 0.30),
            x + int(w * 0.15) : x + int(w * 0.85),
        ]
        if fh.size > 100:
            lap_var = float(cv2.Laplacian(fh, cv2.CV_64F).var())
            texture_vars.append(lap_var)

    cap.release()

    if not texture_vars:
        return None

    mean_tex = float(sum(texture_vars) / len(texture_vars))
    if mean_tex < 40:   return 22
    if mean_tex < 80:   return 32
    if mean_tex < 140:  return 45
    if mean_tex < 220:  return 58
    return 70


def _distress_opencv_fallback(video_path: Path) -> float:
    """
    Distress estimate 0-10 without MediaPipe, from three observable signals:
      - agitation:   head movement across the clip (face-center displacement)
      - brow furrow: edge density in the brow band of the face (Canny)
      - eye squeeze: frames where the face is found but eyes are not
    Heuristic — coarser than MediaPipe landmarks, but better than reporting 0.
    """
    try:
        import cv2
        import numpy as np
    except ImportError:
        return 0.0

    face_cascade = _get_face_cascade()
    eye_cascade = cv2.CascadeClassifier(
        cv2.data.haarcascades + "haarcascade_eye.xml"
    )

    centers: list[tuple[float, float]] = []
    brow_edges: list[float] = []
    face_frames = 0
    eyes_missing = 0

    cap = cv2.VideoCapture(str(video_path))
    idx = -1
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        idx += 1
        if idx % 5 != 0:        # ~3 samples/second
            continue

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = face_cascade.detectMultiScale(gray, 1.1, 5, minSize=(60, 60))
        if len(faces) == 0:
            continue
        x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
        face_frames += 1
        centers.append((x + w / 2, y + h / 2))

        # Brow band: rows 18-35% of the face, central 60%
        brow = gray[y + int(h*0.18):y + int(h*0.35), x + int(w*0.2):x + int(w*0.8)]
        if brow.size > 200:
            edges = cv2.Canny(brow, 60, 140)
            brow_edges.append(cv2.countNonZero(edges) / edges.size)

        # Eye region: rows 25-55% — undetected eyes suggest squinting/grimace
        roi = gray[y + int(h*0.25):y + int(h*0.55), x:x + w]
        eyes = eye_cascade.detectMultiScale(roi, 1.1, 4, minSize=(18, 18))
        if len(eyes) == 0:
            eyes_missing += 1

    cap.release()

    if face_frames < 3:
        return 0.0

    # Agitation: mean per-sample head displacement, normalized by face count
    motion = 0.0
    if len(centers) >= 2:
        deltas = [
            ((centers[i][0] - centers[i-1][0]) ** 2 +
             (centers[i][1] - centers[i-1][1]) ** 2) ** 0.5
            for i in range(1, len(centers))
        ]
        motion = float(np.mean(deltas))
    agitation = min(4.0, motion / 6.0)              # ≥24px avg shift → max

    furrow = 0.0
    if brow_edges:
        # Typical relaxed brow shows ~2-6% edge pixels; furrowed 10%+
        furrow = min(4.0, max(0.0, (float(np.mean(brow_edges)) - 0.05) * 60))

    squeeze = min(2.0, 2.0 * eyes_missing / face_frames)

    score = round(min(10.0, agitation + furrow + squeeze), 1)
    log.info(
        f"[DISTRESS] OpenCV fallback: agitation={agitation:.1f} "
        f"furrow={furrow:.1f} eyeSqueeze={squeeze:.1f} → {score}/10"
    )
    return score


def compute_distress_from_video(video_path: Path) -> float:
    """
    Estimate facial distress score 0–10 from video frames.
    Uses MediaPipe face mesh if available; otherwise an OpenCV heuristic
    (head agitation + brow furrow + eye squeeze).
    """
    try:
        import cv2
        import mediapipe as mp

        mp_face   = mp.solutions.face_mesh
        face_mesh = mp_face.FaceMesh(
            static_image_mode=True, max_num_faces=1,
            min_detection_confidence=0.5
        )
        cap    = cv2.VideoCapture(str(video_path))
        scores: list[float] = []

        for _ in range(45):     # sample first ~3 s at 15 fps
            ok, frame = cap.read()
            if not ok:
                break
            results = face_mesh.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            if results.multi_face_landmarks:
                lm = results.multi_face_landmarks[0].landmark
                try:
                    inner_brow = (lm[9].y  + lm[10].y)  / 2
                    outer_brow = (lm[70].y + lm[300].y) / 2
                    brow_furrow = max(0.0, inner_brow - outer_brow) * 80
                    corner_y    = (lm[61].y + lm[291].y) / 2
                    frown       = max(0.0, corner_y - lm[1].y) * 60
                    scores.append(min(10.0, brow_furrow + frown))
                except (IndexError, AttributeError):
                    pass

        cap.release()
        face_mesh.close()

        if scores:
            return round(sum(scores) / len(scores), 1)
    except ImportError:
        # MediaPipe not installed — use the OpenCV heuristic instead
        return _distress_opencv_fallback(video_path)
    except Exception as e:
        log.debug(f"[DISTRESS] MediaPipe error: {e}")

    return _distress_opencv_fallback(video_path)


def analyze_video_full(video_path: Path, session_id: str) -> dict:
    """Run all video analysis tasks synchronously (called in thread pool)."""
    log.info(f"[VIDEO] Analyzing clip {session_id[:8]}…")

    bp_ocr   = read_bp_display_from_video(video_path)
    rppg     = extract_rppg_vitals(video_path)
    age      = estimate_age_from_video(video_path)
    distress = compute_distress_from_video(video_path)

    result = {
        "faceDetected":     rppg.get("faceDetected", False),
        "heartRate":        rppg.get("heartRate"),
        "bpSystolic":       rppg.get("bpSystolic"),
        "bpDiastolic":      rppg.get("bpDiastolic"),
        "bpConfidence":     rppg.get("bpConfidence", 0.0),
        "bpSource":         "rppg",
        "respiratoryRate":  rppg.get("respiratoryRate"),
        "confidence":       rppg.get("confidence", 0.0),
        "estimatedAge":     age,
        "estimatedHeightCm": None,    # not estimable from a seated 5-second clip
        "estimatedWeightKg": None,
        "distressScore":    distress,
        "source":           "rppg",
        "visibleInjuries":  [],
    }

    # A cuff display read off the video is a real measurement — it beats the
    # rPPG estimate whenever the OCR confirmed it across multiple frames.
    if bp_ocr:
        result["bpSystolic"]   = bp_ocr["bpSystolic"]
        result["bpDiastolic"]  = bp_ocr["bpDiastolic"]
        result["bpConfidence"] = bp_ocr["bpConfidence"]
        result["bpSource"]     = "bp_display"
        if bp_ocr.get("pulse") and not result["heartRate"]:
            result["heartRate"] = float(bp_ocr["pulse"])

    log.info(
        f"[VIDEO] Done — "
        f"HR={result['heartRate']} "
        f"BP={result['bpSystolic']}/{result['bpDiastolic']} "
        f"RR={result['respiratoryRate']} "
        f"age~{result['estimatedAge']} "
        f"distress={distress}"
    )
    return result


# ── ESI — Random Forest + rules ────────────────────────────────────────────────

_AGE_GROUP_NUMERIC = {"under18": 12, "18-40": 30, "41-65": 53, "over65": 72}

_COMPLAINT_MAP: list[tuple[tuple[str, ...], int]] = [
    (("chest", "heart"),              1),
    (("breath", "breathing"),         2),
    (("stroke", "neuro", "vision"),   3),
    (("pain", "abdomen", "back"),     4),
    (("fever", "infection"),          5),
]

def _encode_complaint(complaints: list[str]) -> int:
    text = " ".join(complaints).lower()
    for keywords, code in _COMPLAINT_MAP:
        if any(k in text for k in keywords):
            return code
    return 0


def compute_esi_rf(payload: SessionPayload, video: Optional[dict]) -> tuple[int, float]:
    """
    Predict ESI via the loaded Random Forest.
    Feature vector: [age, pulse, spo2, temp_c, rr, sbp, dbp, distress, cc_enc]
    Returns (esi_level, confidence).  Falls back to (3, 0.0) if model unavailable.
    """
    if _esi_model is None:
        return 3, 0.0

    age = _AGE_GROUP_NUMERIC.get(
        (payload.intake.ageGroup if payload.intake else None) or "", 30
    )
    if video and video.get("estimatedAge"):
        age = video["estimatedAge"]

    pulse  = payload.vitals.heartRate or 80.0
    spo2   = payload.vitals.spO2      or 98.0
    temp_f = payload.vitals.temperature or 98.6
    temp_c = (temp_f - 32.0) * 5.0 / 9.0

    rr = 16.0
    if video and video.get("respiratoryRate"):
        rr = float(video["respiratoryRate"])

    sbp = payload.vitals.bloodPressureSystolic
    dbp = payload.vitals.bloodPressureDiastolic
    if sbp is None and video:
        sbp = video.get("bpSystolic")
        dbp = video.get("bpDiastolic")
    sbp = float(sbp or 120.0)
    dbp = float(dbp or 80.0)

    # Distress = AI-observed facial distress only; the model's distress
    # feature must not be inflated by the subjective self-reported pain
    distress = 0.0
    if payload.facialData:
        distress = float(payload.facialData.get("distressScore", 0) or 0)
    if video and video.get("distressScore"):
        distress = max(distress, float(video["distressScore"]))

    cc = _encode_complaint(
        payload.intake.chiefComplaints if payload.intake else []
    )

    features = [[age, pulse, spo2, temp_c, rr, sbp, dbp, distress, cc]]
    try:
        pred  = int(_esi_model.predict(features)[0])
        proba = _esi_model.predict_proba(features)[0]
        return max(1, min(5, pred)), float(max(proba))
    except Exception as e:
        log.warning(f"[RF-MODEL] Prediction error: {e}")
        return 3, 0.0


ESI_LABELS = {
    1: "Resuscitation",
    2: "Emergent",
    3: "Urgent",
    4: "Less Urgent",
    5: "Non-Urgent",
}

ESI_RATIONALE = {
    1: "Immediate life threat suspected — unstable vitals or extreme pain in critical area.",
    2: "High-risk condition — vitals or pain indicate urgent assessment needed within 15 minutes.",
    3: "Multiple resources likely needed — stable vitals, moderate to significant pain.",
    4: "One resource anticipated — mild symptoms with normal vitals.",
    5: "Minor complaint — vitals within normal limits, minimal pain.",
}

_CRITICAL_REGIONS = {"chest-left", "chest-right", "head-front", "abdomen"}


def compute_esi_rules(payload: SessionPayload, video: Optional[dict] = None) -> int:
    """Rule-based ESI fallback (no ML dependency)."""
    v    = payload.vitals
    risk = 0

    if v.heartRate is not None:
        if   v.heartRate > 150 or v.heartRate < 40:  risk += 3
        elif v.heartRate > 100 or v.heartRate < 60:  risk += 1

    if v.spO2 is not None:
        if   v.spO2 < 90:  risk += 3
        elif v.spO2 < 94:  risk += 2

    if v.temperature is not None:
        tc = (v.temperature - 32.0) * 5.0 / 9.0
        if   tc > 39.5 or tc < 35.5:  risk += 2
        elif tc > 38.0 or tc < 36.0:  risk += 1

    if v.bloodPressureSystolic is not None:
        if v.bloodPressureSystolic > 180 or v.bloodPressureSystolic < 80:
            risk += 2

    if payload.regions:
        # Self-reported pain is subjective — cap its contribution at 5 so a
        # 10/10 rating alone cannot reach ESI 1-2 without vitals or observed
        # distress backing it up
        max_pain  = max(r.painLevel for r in payload.regions)
        has_crit  = any(r.id in _CRITICAL_REGIONS for r in payload.regions)
        risk += min(5, int(round(max_pain / 2.0))) + (2 if has_crit else 0)

    # AI-observed distress (facial analysis of the 5s clip) corroborates pain
    distress = 0.0
    if payload.facialData:
        d = payload.facialData.get("distressScore", 0)
        if isinstance(d, (int, float)):
            distress = float(d)
    if video and video.get("distressScore"):
        distress = max(distress, float(video["distressScore"]))
    if   distress > 7:  risk += 3
    elif distress > 4:  risk += 2
    elif distress > 2:  risk += 1

    if payload.intake:
        if any(c in {"heart", "thinners", "cancer"} for c in payload.intake.conditions):
            risk += 1

    if   risk >= 12:  return 1
    elif risk >= 8:   return 2
    elif risk >= 5:   return 3
    elif risk >= 2:   return 4
    return 5


# ── Ollama LLM ─────────────────────────────────────────────────────────────────

async def query_ollama(
    payload: SessionPayload,
    rf_esi: int,
    video: Optional[dict],
) -> Optional[dict]:
    """
    Ask the local Ollama LLM for clinical ESI reasoning.
    Returns a parsed JSON dict (esi_level, reasoning, red_flags, recommended_action)
    or None if Ollama is unavailable or returns unparseable output.
    """
    try:
        import httpx
    except ImportError:
        log.warning("[OLLAMA] httpx not installed — LLM reasoning unavailable")
        return None

    # Build the patient summary dict for the prompt
    age_map = {"under18": 12, "18-40": 30, "41-65": 53, "over65": 72}
    age = age_map.get(
        (payload.intake.ageGroup if payload.intake else None) or "", 40
    )
    if video and video.get("estimatedAge"):
        age = video["estimatedAge"]

    max_pain  = max((r.painLevel for r in payload.regions), default=0)
    pain_locs = [f"{r.label} ({int(r.painLevel)}/10)" for r in payload.regions]

    sbp = payload.vitals.bloodPressureSystolic
    dbp = payload.vitals.bloodPressureDiastolic
    if sbp is None and video:
        sbp = video.get("bpSystolic")
        dbp = video.get("bpDiastolic")
    bp_str = f"{sbp}/{dbp}" if (sbp and dbp) else "unknown"

    rr = video.get("respiratoryRate") if video else None

    distress = 0.0
    if payload.facialData:
        distress = float(payload.facialData.get("distressScore", 0) or 0)
    if video and video.get("distressScore"):
        distress = max(distress, float(video["distressScore"]))

    patient_data = {
        "chiefComplaints":  payload.intake.chiefComplaints if payload.intake else [],
        "estimatedAge":     age,
        "sex":              payload.intake.sex if payload.intake else "unknown",
        "weightKg":         payload.intake.weightKg if payload.intake else None,
        "vitals": {
            "heartRate":       payload.vitals.heartRate,
            "spO2":            payload.vitals.spO2,
            "temperatureF":    payload.vitals.temperature,
            "bloodPressure":   bp_str,
            "respiratoryRate": rr,
        },
        "maxPainScore":   int(max_pain),
        "painLocations":  pain_locs or ["none reported"],
        "medicalHistory": payload.intake.conditions if payload.intake else [],
        "allergies":      [
            a for a in (payload.intake.allergies if payload.intake else [])
            if a != "none"
        ],
        "facialDistress": round(distress, 1),
        "mlModelESI":     rf_esi,
    }

    prompt = (
        "You are a triage AI assistant supporting emergency room nurses. "
        "Analyze the patient data below and return ONLY valid JSON — no markdown, "
        "no explanation outside the JSON.\n\n"
        f"Patient:\n{json.dumps(patient_data, indent=2)}\n\n"
        "Required response format (JSON only):\n"
        '{"esi_level":<1-5>,'
        '"esi_label":"<Resuscitation|Emergent|Urgent|Less Urgent|Non-Urgent>",'
        '"reasoning":"<2-3 sentence clinical explanation>",'
        '"red_flags":["<item1>","<item2>"],'
        '"recommended_action":"<immediate action or null>"}'
    )

    try:
        async with httpx.AsyncClient(timeout=25.0) as client:
            resp = await client.post(
                f"{OLLAMA_URL}/api/generate",
                json={
                    "model":   OLLAMA_MODEL,
                    "prompt":  prompt,
                    "stream":  False,
                    "format":  "json",   # constrains decoding to valid JSON
                    "options": {"temperature": 0.1, "top_p": 0.9, "num_predict": 300},
                },
            )
            if resp.status_code != 200:
                log.warning(f"[OLLAMA] HTTP {resp.status_code}")
                return None

            raw = resp.json().get("response", "")
            # Extract the first JSON object from the response
            match = re.search(r"\{[^{}]*\}", raw, re.DOTALL)
            if match:
                parsed = json.loads(match.group())
                log.info(f"[OLLAMA] ESI={parsed.get('esi_level')}  "
                         f"flags={parsed.get('red_flags', [])}")
                return parsed

            log.warning(f"[OLLAMA] No JSON in response: {raw[:200]}")
            return None

    except Exception as e:
        log.warning(f"[OLLAMA] Unavailable ({e}) — falling back to rule/RF ESI")
        return None


def choose_final_esi(
    rules: int,
    rf: int,
    llm: Optional[dict],
) -> tuple[int, str]:
    """
    Combine rule-based, Random-Forest, and LLM estimates.
    Takes the most conservative (lowest = most urgent) result.
    """
    candidates = [rules, rf]
    if llm and isinstance(llm.get("esi_level"), int) and 1 <= llm["esi_level"] <= 5:
        candidates.append(llm["esi_level"])

    level     = min(candidates)
    rationale = ESI_RATIONALE[level]

    if llm and llm.get("reasoning"):
        rationale = str(llm["reasoning"])[:400]

    return level, rationale


# ── HL7 v2.5 Builder ───────────────────────────────────────────────────────────

def _hl7_ts(dt: Optional[datetime] = None) -> str:
    return (dt or datetime.utcnow()).strftime("%Y%m%d%H%M%S")

def _esc(v: str) -> str:
    v = v.replace("|", "\\F\\").replace("^", "\\S\\").replace("~", "\\R\\")
    # HL7 v2 receivers commonly expect ASCII — replace typographic dashes,
    # then drop anything else outside the printable ASCII range.
    v = v.replace("—", "-").replace("–", "-").replace("’", "'").replace("‘", "'")
    return v.encode("ascii", errors="replace").decode("ascii")

_SEX_MAP     = {"male": "M", "female": "F", "nonbinary": "O", "prefer-not": "U"}
_AGE_OFFSET  = {"under18": 10, "18-40": 28, "41-65": 52, "over65": 72}


def build_hl7(
    payload:    SessionPayload,
    esi_level:  int,
    esi_rationale: str,
    video:      Optional[dict] = None,
) -> str:
    ts  = _hl7_ts()
    sid = payload.sessionId[:12].upper()
    msg_id = f"MK-{sid}-{int(time.time())}"

    intake   = payload.intake or IntakeData()
    max_pain = max((r.painLevel for r in payload.regions), default=0)

    complaints   = _esc(", ".join(intake.chiefComplaints) or "Not specified")
    conditions   = _esc(", ".join(intake.conditions) or "None reported")
    allergy_list = [a for a in intake.allergies if a != "none"]
    allergies_str = _esc(", ".join(allergy_list) or "NKDA")
    sex = _SEX_MAP.get(intake.sex or "prefer-not", "U")
    dob = f"{datetime.utcnow().year - _AGE_OFFSET.get(intake.ageGroup or '18-40', 28)}0101"

    temp_c = None
    if payload.vitals.temperature:
        temp_c = round((payload.vitals.temperature - 32.0) * 5.0 / 9.0, 1)

    # BP: prefer sensor reading; fall back to cuff-display OCR / rPPG estimate
    sbp = payload.vitals.bloodPressureSystolic
    dbp = payload.vitals.bloodPressureDiastolic
    bp_from_video = False
    bp_estimated  = False
    if sbp is None and video:
        sbp = video.get("bpSystolic")
        dbp = video.get("bpDiastolic")
        bp_from_video = sbp is not None
        # rPPG values are estimates; numbers OCR'd off the cuff display are
        # real measurements and can be reported as final
        bp_estimated = bp_from_video and video.get("bpSource") != "bp_display"

    rr = video.get("respiratoryRate") if video else None

    lines: list[str] = []
    lines.append(
        f"MSH|^~\\&|MEDIKIOSK|ER01|HOSPITAL-HIS|HIS|{ts}||"
        f"ORU^R01^ORU_R01|{msg_id}|P|2.5|||AL|AL|||NE"
    )
    last  = _esc((payload.lastName or "").strip().upper())  or "UNKNOWN"
    first = _esc((payload.firstName or "").strip().upper()) or "PATIENT"
    lines.append(
        f"PID|1||KIOSK-{sid}^^^MEDIKIOSK^PI||{last}^{first}^^||"
        f"{dob}|{sex}|||||||||||||||||||"
    )
    lines.append(
        f"PV1|1|E|ER01^EMERGENCY^ER||||||||||||||||"
        f"{sid}|||||||||||||||||||||||||||{ts}"
    )
    for i, a in enumerate(allergy_list, 1):
        lines.append(f"AL1|{i}||DA^{_esc(a)}^L||UNKNOWN")

    lines.append(
        f"OBR|1||{msg_id}-OBR|TRIAGE^Emergency Triage^LOCAL|||{ts}|"
        "||||||||||||MEDIKIOSK^MEDIKIOSK||||||F"
    )

    seq = 1
    if payload.vitals.heartRate is not None:
        hr   = payload.vitals.heartRate
        flag = "A" if (hr > 100 or hr < 60) else "N"
        lines.append(f"OBX|{seq}|NM|8867-4^Heart rate^LN||{hr}|/min|60-100|{flag}|||F|||{ts}")
        seq += 1

    # rPPG heart rate as a secondary observation (if different from sensor)
    if video and video.get("heartRate") and video["heartRate"] != payload.vitals.heartRate:
        rhr = video["heartRate"]
        lines.append(
            f"OBX|{seq}|NM|8867-4^Heart rate (rPPG)^LN||{rhr}|/min|60-100|N|||P|||{ts}"
        )
        seq += 1

    if payload.vitals.spO2 is not None:
        s    = payload.vitals.spO2
        flag = "L" if s < 95 else "N"
        lines.append(f"OBX|{seq}|NM|59408-5^Oxygen saturation^LN||{s}|%|95-100|{flag}|||F|||{ts}")
        seq += 1

    if temp_c is not None:
        flag = "A" if (temp_c > 38.0 or temp_c < 36.0) else "N"
        lines.append(
            f"OBX|{seq}|NM|8310-5^Body temperature^LN||{temp_c}|Cel|36.1-37.5|{flag}|||F|||{ts}"
        )
        seq += 1

    if sbp is not None and dbp is not None:
        flag   = "H" if sbp > 140 or dbp > 90 else "N"
        # P = preliminary (rPPG estimate); F = final (sensor or cuff display)
        method = "P" if bp_estimated else "F"
        lines.append(
            f"OBX|{seq}|NM|55284-4^Blood pressure^LN||{sbp}^{dbp}|"
            f"mm[Hg]|90-140/60-90|{flag}|||{method}|||{ts}"
        )
        seq += 1

    if rr is not None:
        flag = "A" if (rr > 20 or rr < 12) else "N"
        lines.append(
            f"OBX|{seq}|NM|9279-1^Respiratory rate^LN||{rr}|/min|12-20|{flag}|||P|||{ts}"
        )
        seq += 1

    lines.append(
        f"OBX|{seq}|ST|11449-6^Reason for visit^LN||{complaints}||||F|||{ts}"
    )
    seq += 1

    pain_flag = "H" if max_pain >= 7 else "N"
    lines.append(
        f"OBX|{seq}|NM|72514-3^Pain severity 0-10^LN||{int(max_pain)}|"
        f"{{score}}|0-10|{pain_flag}|||F|||{ts}"
    )
    seq += 1

    if payload.regions:
        locs = _esc(
            ", ".join(f"{r.label}({int(r.painLevel)}/10)" for r in payload.regions)
        )
        lines.append(f"OBX|{seq}|ST|38208-5^Pain location^LN||{locs}||||F|||{ts}")
        seq += 1

    if intake.weightKg:
        lines.append(
            f"OBX|{seq}|NM|29463-7^Body weight^LN||{intake.weightKg}|kg||N|||F|||{ts}"
        )
        seq += 1

    lines.append(f"OBX|{seq}|ST|8653-6^Medical history^LN||{conditions}||||F|||{ts}")
    seq += 1
    lines.append(f"OBX|{seq}|ST|52473-6^Allergy and ADR^LN||{allergies_str}||||F|||{ts}")
    seq += 1

    esi_label = ESI_LABELS[esi_level]
    esi_flag  = "H" if esi_level <= 2 else "N"
    lines.append(
        f"OBX|{seq}|CE|ESI^Emergency Severity Index^LOCAL||"
        f"{esi_level}^{esi_label}^LOCAL||1-5|{esi_flag}|||F|||{ts}"
    )
    seq += 1
    lines.append(
        f"OBX|{seq}|ST|ESI-RAT^ESI Rationale^LOCAL||"
        f"{_esc(esi_rationale[:200])}||||F|||{ts}"
    )
    seq += 1

    # Video-inferred demographics (marked as preliminary)
    if video and video.get("estimatedAge"):
        lines.append(
            f"OBX|{seq}|NM|29553-5^Age estimated (video)^LOCAL||"
            f"{video['estimatedAge']}|a||||P|||{ts}"
        )
        seq += 1

    if video and video.get("distressScore") is not None:
        lines.append(
            f"OBX|{seq}|NM|DISTRESS^Facial distress score^LOCAL||"
            f"{video['distressScore']}|{{score}}|0-10|N|||P|||{ts}"
        )
        seq += 1

    bp_str = f"{sbp}/{dbp}" if sbp else "N/A"
    cam    = "Y" if intake.cameraConsent else "N"
    lines.append(
        f"ZTR|1|{esi_level}|{_esc(esi_label)}|{_esc(esi_rationale[:80])}|"
        f"{int(max_pain)}|{payload.vitals.heartRate or ''}|"
        f"{payload.vitals.spO2 or ''}|{payload.vitals.temperature or ''}|"
        f"{bp_str}|{intake.ageGroup or 'unknown'}|{sex}|"
        f"{_esc(conditions[:60])}|{_esc(allergies_str[:60])}|{cam}"
    )

    # HL7 v2 mandates a bare carriage return (0x0D) as the segment terminator
    return "\r".join(lines) + "\r"


# ── FastAPI app ─────────────────────────────────────────────────────────────────

app = FastAPI(title="MediKiosk Jetson AI Server", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory per-session stores (cleared after /analyze)
_video_clips:   dict[str, Path]           = {}
_video_futures: dict[str, "asyncio.Future[dict]"] = {}


@app.on_event("startup")
async def _startup() -> None:
    _load_esi_model()
    VIDEO_TEMP_DIR.mkdir(parents=True, exist_ok=True)
    HL7_DIR.mkdir(parents=True, exist_ok=True)
    log.info(f"[STARTUP] HL7 dir:   {HL7_DIR}")
    log.info(f"[STARTUP] ESI model: {ESI_MODEL_PATH} (loaded={_esi_model is not None})")
    log.info(f"[STARTUP] Ollama:    {OLLAMA_URL}  model={OLLAMA_MODEL}")


# ── Routes ─────────────────────────────────────────────────────────────────────

@app.get("/status")
async def status():
    return {
        "status":        "online",
        "service":       "MediKiosk Jetson AI v2",
        "esi_model":     _esi_model is not None,
        "hl7_dir":       str(HL7_DIR),
        "ollama_url":    OLLAMA_URL,
        "ollama_model":  OLLAMA_MODEL,
        "timestamp":     datetime.utcnow().isoformat(),
    }


@app.post("/video/{session_id}")
async def receive_video(session_id: str, file: UploadFile = File(...)):
    """
    Pi agent uploads the 5-second video clip here.
    Analysis starts immediately in a background thread so results are
    ready before the patient reaches the /analyze step.
    """
    VIDEO_TEMP_DIR.mkdir(parents=True, exist_ok=True)

    # Purge clips from abandoned sessions so /tmp never fills up
    cutoff = time.time() - 1800
    for old in VIDEO_TEMP_DIR.glob("*.*"):
        try:
            if old.stat().st_mtime < cutoff:
                old.unlink()
                _video_clips.pop(old.stem, None)
                _video_futures.pop(old.stem, None)
        except OSError:
            pass

    # Keep the uploaded container format — Pi sends .mp4, browsers send .webm
    suffix = Path(file.filename or "clip.mp4").suffix.lower()
    if suffix not in (".mp4", ".webm", ".avi", ".mkv"):
        suffix = ".mp4"
    dest = VIDEO_TEMP_DIR / f"{session_id}{suffix}"

    with open(dest, "wb") as out:
        shutil.copyfileobj(file.file, out)

    _video_clips[session_id] = dest
    size_kb = dest.stat().st_size // 1024
    log.info(f"[VIDEO] Received {dest.stat().st_size} bytes for {session_id[:8]}")

    _mon_state["lastClip"] = {
        "sessionId": session_id,
        "filename":  dest.name,
        "url":       f"/monitor/clip/{dest.name}",
        "receivedAt": datetime.utcnow().isoformat() + "Z",
    }
    _mon("clip_received", f"[CLIP] 5s clip received ({size_kb} KB) — session {session_id[:8]}", busy=True)
    _mon("video_analysis", "[VIDEO-AI] Started: BP display OCR + rPPG vitals + distress scan")

    # Fire off analysis immediately so results are pre-computed
    def _analyze_and_report() -> dict:
        result = analyze_video_full(dest, session_id)
        bits = []
        if result.get("bpSystolic"):
            src = "cuff display read" if result.get("bpSource") == "bp_display" else "rPPG estimate"
            bits.append(f"BP {result['bpSystolic']}/{result['bpDiastolic']} ({src})")
        if result.get("heartRate"):
            bits.append(f"HR {result['heartRate']}")
        if result.get("respiratoryRate"):
            bits.append(f"RR {result['respiratoryRate']}")
        if result.get("distressScore"):
            bits.append(f"distress {result['distressScore']}/10")
        summary = ", ".join(bits) if bits else "no vitals extractable from clip"
        face = "face detected" if result.get("faceDetected") else "no face detected"
        _mon("video_done", f"[VIDEO-AI] Done — {face}; {summary}")
        return result

    loop   = asyncio.get_event_loop()
    future = loop.run_in_executor(_executor, _analyze_and_report)
    _video_futures[session_id] = asyncio.ensure_future(asyncio.wrap_future(future))

    return {"ok": True, "sessionId": session_id, "analyzing": True}


@app.post("/process/video")
async def process_video_legacy(file: UploadFile = File(...)):
    """
    Compatible with AI-parts/pi_server.py architecture.
    Returns vision analysis results in pi_server.py's expected format.
    """
    import tempfile

    VIDEO_TEMP_DIR.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mktemp(suffix=".mp4", dir=str(VIDEO_TEMP_DIR)))

    with open(tmp, "wb") as out:
        shutil.copyfileobj(file.file, out)

    loop   = asyncio.get_event_loop()
    result = await loop.run_in_executor(_executor, analyze_video_full, tmp, "legacy")

    try:
        tmp.unlink()
    except Exception:
        pass

    return {
        "age":               result.get("estimatedAge"),
        "respiratory_rate":  result.get("respiratoryRate"),
        "distress_score":    result.get("distressScore", 0.0),
        "active_aus":        [],
        "face_detected":     result.get("faceDetected", False),
        "systolic_bp":       result.get("bpSystolic"),
        "diastolic_bp":      result.get("bpDiastolic"),
        "heart_rate_rppg":   result.get("heartRate"),
        "confidence":        result.get("confidence", 0.0),
    }


@app.post("/analyze/llm")
async def analyze_llm(req: LLMAnalysisRequest):
    """
    Compatible with AI-parts/pi_server.py architecture.
    Runs RF model + Ollama LLM on structured vitals and returns ESI.
    """
    vitals = Vitals(
        heartRate              = req.pulse,
        spO2                   = req.spo2,
        temperature            = req.temp_c * 9.0 / 5.0 + 32.0,
        bloodPressureSystolic  = req.systolic_bp,
        bloodPressureDiastolic = req.diastolic_bp,
    )
    intake  = IntakeData(chiefComplaints=[req.chief_complaint])
    regions = (
        [BodyRegion(id="pain", label="pain", x=0.5, y=0.5, painLevel=req.distress_score)]
        if req.distress_score > 0 else []
    )

    pseudo = SessionPayload(
        sessionId = "llm-legacy",
        vitals    = vitals,
        intake    = intake,
        regions   = regions,
        timestamp = datetime.utcnow().isoformat(),
    )
    video_hint: dict = {
        "respiratoryRate": req.respiratory_rate,
        "estimatedAge":    req.age,
    }

    rf_esi, rf_conf = compute_esi_rf(pseudo, video_hint)
    llm_result      = await query_ollama(pseudo, rf_esi, video_hint)
    rule_esi        = compute_esi_rules(pseudo, video_hint)
    final_esi, rationale = choose_final_esi(rule_esi, rf_esi, llm_result)

    return {
        "esi_level":         final_esi,
        "esi_label":         ESI_LABELS[final_esi],
        "reasoning":         rationale,
        "red_flags":         (llm_result.get("red_flags", []) if llm_result else []),
        "recommended_action":(llm_result.get("recommended_action") if llm_result else None),
        "sources": {
            "rules":       rule_esi,
            "rf_model":    rf_esi,
            "rf_conf":     round(rf_conf, 3),
            "llm":         llm_result.get("esi_level") if llm_result else None,
        },
    }


@app.post("/analyze")
async def analyze(payload: SessionPayload):
    """
    Main endpoint called by the Next.js processing page.

    1. Awaits the background video analysis (pre-started on clip upload)
    2. Runs RF model + Ollama LLM concurrently with rules
    3. Selects the most conservative ESI from all three
    4. Writes an HL7 v2.5 file to HL7_DIR
    5. Returns full analysis result
    """
    log.info(
        f"[ANALYZE] Session {payload.sessionId[:8]}  "
        f"HR={payload.vitals.heartRate} SpO2={payload.vitals.spO2} "
        f"Temp={payload.vitals.temperature}"
    )
    pname = " ".join(p for p in [payload.firstName, payload.lastName] if p) or "patient"
    _mon("analyzing", f"[TRIAGE] Analysis started for {pname} — merging vitals, intake & video", busy=True)

    # ── Retrieve video analysis ─────────────────────────────────────────────
    video: Optional[dict] = None

    if payload.sessionId in _video_futures:
        fut = _video_futures.pop(payload.sessionId)
        try:
            video = await asyncio.wait_for(fut, timeout=15.0)
            log.info("[ANALYZE] Video analysis ready")
        except asyncio.TimeoutError:
            log.warning("[ANALYZE] Video analysis timed out — proceeding without")
        except Exception as e:
            log.warning(f"[ANALYZE] Video analysis error: {e}")
    elif payload.sessionId in _video_clips:
        # Clip present but analysis task was never created
        clip = _video_clips[payload.sessionId]
        if clip.exists():
            loop = asyncio.get_event_loop()
            try:
                video = await asyncio.wait_for(
                    loop.run_in_executor(_executor, analyze_video_full, clip, payload.sessionId),
                    timeout=15.0,
                )
            except Exception as e:
                log.warning(f"[ANALYZE] On-demand video analysis failed: {e}")

    # Keep the clip on disk so the monitor dashboard can replay it —
    # the 30-minute purge in receive_video removes it later.
    _video_clips.pop(payload.sessionId, None)

    # ── ESI computation ─────────────────────────────────────────────────────
    rule_esi         = compute_esi_rules(payload, video)
    rf_esi, rf_conf  = compute_esi_rf(payload, video)
    _mon("scoring", f"[SCORING] Rule engine → ESI {rule_esi} · Random Forest → ESI {rf_esi} "
                    f"(conf {rf_conf:.0%}) · querying LLM…")
    llm_result       = await query_ollama(payload, rf_esi, video)
    if llm_result:
        _mon("llm_done", f"[LLM] Agrees: ESI {llm_result.get('esi_level')} — "
                         f"{str(llm_result.get('reasoning', ''))[:80]}")
    else:
        _mon("llm_skip", "[LLM] Unavailable — using rules + Random Forest")

    final_esi, rationale = choose_final_esi(rule_esi, rf_esi, llm_result)

    log.info(
        f"[ESI] rules={rule_esi} rf={rf_esi}({rf_conf:.2f}) "
        f"llm={llm_result.get('esi_level') if llm_result else 'N/A'} "
        f"→ final={final_esi}"
    )

    # ── HL7 generation ──────────────────────────────────────────────────────
    HL7_DIR.mkdir(parents=True, exist_ok=True)
    hl7_name    = f"{payload.sessionId[:12].upper()}-{_hl7_ts()}.hl7"
    hl7_path    = HL7_DIR / hl7_name
    hl7_content = build_hl7(payload, final_esi, rationale, video)
    hl7_path.write_text(hl7_content, encoding="utf-8")
    log.info(f"[HL7] Written {hl7_path}  ESI={final_esi}")

    mon_sbp = payload.vitals.bloodPressureSystolic or (video or {}).get("bpSystolic")
    mon_dbp = payload.vitals.bloodPressureDiastolic or (video or {}).get("bpDiastolic")
    mon_bp_source = (
        "sensor" if payload.vitals.bloodPressureSystolic
        else (video or {}).get("bpSource")
    )

    _mon("done", f"[DONE] ESI {final_esi} ({ESI_LABELS[final_esi]}) for {pname} — HL7 file {hl7_name}",
         busy=False)
    _mon_state["lastResult"] = {
        "sessionId":    payload.sessionId,
        "patientName":  pname,
        "esiLevel":     final_esi,
        "esiLabel":     ESI_LABELS[final_esi],
        "rationale":    rationale,
        "redFlags":     (llm_result.get("red_flags", []) if llm_result else []),
        "vitals": {
            "heartRate":   payload.vitals.heartRate,
            "spO2":        payload.vitals.spO2,
            "temperature": payload.vitals.temperature,
            "bp":          f"{mon_sbp}/{mon_dbp}" if mon_sbp and mon_dbp else None,
            "bpSource":    mon_bp_source,
        },
        "ageGroup":     payload.intake.ageGroup if payload.intake else None,
        "weightKg":     payload.intake.weightKg if payload.intake else None,
        "allergies":    [a for a in (payload.intake.allergies if payload.intake else []) if a != "none"],
        "complaints":   payload.intake.chiefComplaints if payload.intake else [],
        "painRegions":  [f"{r.label} ({int(r.painLevel)}/10)" for r in payload.regions],
        "esiSources":   {"rules": rule_esi, "rfModel": rf_esi,
                         "llm": llm_result.get("esi_level") if llm_result else None},
        "hl7Filename":  hl7_name,
        "finishedAt":   datetime.utcnow().isoformat() + "Z",
    }

    # Whether BP came from sensor or rPPG
    bp_from_video = (
        payload.vitals.bloodPressureSystolic is None
        and video is not None
        and video.get("bpSystolic") is not None
    )

    return {
        "sessionId":            payload.sessionId,
        "esiLevel":             final_esi,
        "esiLabel":             ESI_LABELS[final_esi],
        "esiRationale":         rationale,
        "redFlags":             (llm_result.get("red_flags", []) if llm_result else []),
        "recommendedAction":    (llm_result.get("recommended_action") if llm_result else None),
        # Video demographics
        "estimatedAge":         video.get("estimatedAge")       if video else None,
        "estimatedHeightCm":    None,   # not estimable from seated 5-second clip
        "estimatedWeightKg":    None,
        "videoAnalyzed":        video is not None,
        "videoConfidence":      video.get("confidence", 0.0)    if video else 0.0,
        # rPPG vitals
        "bpSystolicVideo":      video.get("bpSystolic")         if video else None,
        "bpDiastolicVideo":     video.get("bpDiastolic")        if video else None,
        "bpConfidenceVideo":    video.get("bpConfidence", 0.0)  if video else 0.0,
        "bpFromVideo":          bp_from_video,
        "bpSource":             (video.get("bpSource") if video else None),
        "respiratoryRateVideo": video.get("respiratoryRate")    if video else None,
        "heartRateVideo":       video.get("heartRate")          if video else None,
        # ESI breakdown for transparency
        "esiSources": {
            "rules":        rule_esi,
            "rfModel":      rf_esi,
            "rfConfidence": round(rf_conf, 3),
            "llm":          (llm_result.get("esi_level") if llm_result else None),
            "llmAvailable": llm_result is not None,
        },
        # HL7
        "hl7Path":      str(hl7_path),
        "hl7Filename":  hl7_name,
        "timestamp":    datetime.utcnow().isoformat(),
    }


@app.get("/monitor/state")
async def monitor_state():
    """Live pipeline state for the Jetson-screen dashboard."""
    return {
        "busy":       _mon_state["busy"],
        "stage":      _mon_state["stage"],
        "lastClip":   _mon_state["lastClip"],
        "lastResult": _mon_state["lastResult"],
        "events":     list(_mon_events),
        "ollama":     OLLAMA_MODEL,
        "esiModel":   _esi_model is not None,
        "timestamp":  datetime.utcnow().isoformat() + "Z",
    }


@app.get("/monitor/clip/{filename}")
async def monitor_clip(filename: str):
    """Serve the received 5-second clip for playback on the dashboard."""
    path = (VIDEO_TEMP_DIR / filename).resolve()
    if path.parent != VIDEO_TEMP_DIR.resolve() or not path.is_file():
        raise HTTPException(status_code=404, detail="Clip not found")
    media = "video/webm" if path.suffix == ".webm" else "video/mp4"
    return FileResponse(path, media_type=media)


@app.get("/hl7/{filename}")
async def get_hl7(filename: str):
    # Reject path traversal — filename must resolve inside HL7_DIR
    path = (HL7_DIR / filename).resolve()
    if path.parent != HL7_DIR.resolve() or not path.is_file():
        raise HTTPException(status_code=404, detail="HL7 file not found")
    # read_bytes: read_text() would rewrite the HL7 \r terminators to \n
    return JSONResponse({"filename": path.name, "content": path.read_bytes().decode("utf-8")})


@app.get("/hl7")
async def list_hl7(limit: int = Query(default=20, le=100)):
    if not HL7_DIR.exists():
        return {"files": []}
    files = sorted(
        HL7_DIR.glob("*.hl7"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    return {
        "files": [
            {"name": f.name, "size": f.stat().st_size, "mtime": f.stat().st_mtime}
            for f in files[:limit]
        ]
    }


# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    p = argparse.ArgumentParser(description="MediKiosk Jetson AI Server v2")
    p.add_argument("--host",         default="0.0.0.0")
    p.add_argument("--port",         type=int, default=8000)
    p.add_argument("--hl7-dir",      default=str(HL7_DIR))
    p.add_argument("--model-path",   default=str(ESI_MODEL_PATH))
    p.add_argument("--ollama-url",   default=OLLAMA_URL)
    p.add_argument("--ollama-model", default=OLLAMA_MODEL)
    p.add_argument("--reload",       action="store_true")
    args = p.parse_args()

    HL7_DIR        = Path(args.hl7_dir)
    ESI_MODEL_PATH = Path(args.model_path)
    OLLAMA_URL     = args.ollama_url
    OLLAMA_MODEL   = args.ollama_model

    uvicorn.run(
        "jetson_ai_server:app",
        host      = args.host,
        port      = args.port,
        reload    = args.reload,
        log_level = LOG_LEVEL.lower(),
    )
