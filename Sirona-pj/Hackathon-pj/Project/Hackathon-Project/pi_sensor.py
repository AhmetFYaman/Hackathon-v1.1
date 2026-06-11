#!/usr/bin/env python3
"""
MediKiosk — Raspberry Pi sensor + camera agent  v3

Runs on the Pi 4B. Two jobs only:

  1. VITALS  — read sensors (or mock) and push them to the kiosk every second
  2. VIDEO   — when the kiosk triggers it, record ONE 5-second clip and
               upload it to the Jetson AI server, then delete it locally

There is NO live video streaming and NO continuous camera use.
The camera is opened just before the 5-second recording and fully
closed (released) immediately after. All analysis (rPPG vitals, BP cuff
display OCR, distress, age estimate) happens on the Jetson from that clip.

Quick start (mock sensors, mock camera):
    python3 pi_sensor.py --server http://<Jetson-IP>:3000

Real hardware:
    python3 pi_sensor.py --server http://192.168.1.42:3000 \
                         --jetson http://192.168.1.42:8000 \
                         --real-sensors --real-camera

Install dependencies:
    pip install requests
    pip install picamera2 opencv-python                # 5-second recording
    pip install max30100                               # MAX30100 heart rate / SpO2
    # OR for MAX30102:
    pip install heartpy smbus2                         # raw I2C MAX30102
    pip install w1thermsensor                          # DS18B20 temperature (1-Wire)
    # OR for MLX90614 (infrared, no contact):
    pip install adafruit-circuitpython-mlx90614

Hardware wiring:
    MAX30100/30102  → SDA=GPIO2 SCL=GPIO3 (I2C1)
    DS18B20         → Data=GPIO4 (1-Wire, enable in /boot/config.txt: dtoverlay=w1-gpio)
    MLX90614        → SDA=GPIO2 SCL=GPIO3 (I2C1, same bus as MAX is fine)
    Pi Camera       → CSI ribbon cable, enable via raspi-config

Data flow (all over the LAN, Pi → Jetson):
    Pi  →  POST /api/vitals          → Jetson:3000 (Next.js) every 1 s   [JSON]
    Pi  →  GET  /api/video           → Jetson:3000 (poll: record now?)   [JSON]
    Pi  →  POST /video/{sessionId}   → Jetson:8000 (the 5 s clip)        [multipart MP4]
"""

import argparse
import math
import os
import random
import sys
import threading
import time

import requests

# ── CLI args ───────────────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser(description="MediKiosk Pi agent v3")
    p.add_argument("--server", default="http://localhost:3000",
                   help="URL of the Next.js kiosk on the Jetson (e.g. http://192.168.1.42:3000)")
    p.add_argument("--jetson", default=None,
                   help="URL of the Jetson AI server (e.g. http://192.168.1.42:8000). "
                        "Defaults to --server host on port 8000.")
    p.add_argument("--real-sensors", action="store_true",
                   help="Read from physical MAX30100/30102 + temperature sensor")
    p.add_argument("--real-camera", action="store_true",
                   help="Use the Pi camera for the 5-second recording")
    p.add_argument("--sensor-type", choices=["max30100", "max30102"], default="max30100",
                   help="Which pulse/SpO2 sensor is connected")
    p.add_argument("--temp-type", choices=["ds18b20", "mlx90614", "none"], default="ds18b20",
                   help="Which temperature sensor is connected")
    p.add_argument("--vitals-interval", type=float, default=1.0,
                   help="Seconds between sensor reads (default 1.0)")
    p.add_argument("--video-duration", type=float, default=5.0,
                   help="Duration of the recorded clip in seconds (default 5.0)")
    return p.parse_args()


# ── HTTP helpers ───────────────────────────────────────────────────────────────

# One keep-alive session — avoids a fresh TCP handshake for every poll/post
_http = requests.Session()

def post(server: str, path: str, data: dict):
    try:
        _http.post(f"{server}{path}", json=data, timeout=3)
    except Exception as e:
        print(f"[WARN] POST {path} failed: {e}")

def get_json(server: str, path: str) -> dict:
    try:
        r = _http.get(f"{server}{path}", timeout=3)
        return r.json()
    except Exception as e:
        print(f"[WARN] GET {path} failed: {e}")
        return {}


# ── Mock vitals (used when --real-sensors not set) ────────────────────────────

_hr_base   = random.randint(68, 88)
_spo2_base = random.randint(96, 99)
_temp_base = round(random.uniform(97.8, 99.2), 1)
_tick = 0

def read_mock_vitals() -> dict:
    global _tick
    _tick += 1
    hr   = max(50, min(120, _hr_base   + round(math.sin(_tick * 0.3) * 4)))
    spo2 = max(90, min(100, _spo2_base + round(math.sin(_tick * 0.1) * 0.5)))
    temp = round(_temp_base + math.sin(_tick * 0.05) * 0.2, 1)
    return {"heartRate": hr, "spO2": int(spo2), "temperature": temp}


# ── Real sensor reads ──────────────────────────────────────────────────────────

def init_max30100():
    """MAX30100 — heart rate + SpO2 via I2C."""
    from max30100 import MAX30100
    sensor = MAX30100()
    sensor.enable_spo2()
    return sensor

def read_max30100(sensor) -> dict:
    sensor.read_sensor()
    try:
        bpm = int(sensor.get_heart_rate())
        pct = int(sensor.get_spo2())
    except Exception:
        bpm, pct = 0, 0
    return {"heartRate": bpm if bpm > 0 else None,
            "spO2":      pct if pct > 0 else None}


def init_max30102():
    """MAX30102 — raw I2C read using smbus2."""
    import smbus2
    bus = smbus2.SMBus(1)
    # Reset
    bus.write_byte_data(0x57, 0x09, 0x40)
    time.sleep(0.1)
    # Mode: SpO2 (0x03), SR=100, pulse width=411us, LED current=7.2mA
    bus.write_byte_data(0x57, 0x09, 0x03)
    bus.write_byte_data(0x57, 0x0A, 0x27)
    bus.write_byte_data(0x57, 0x0C, 0x24)
    bus.write_byte_data(0x57, 0x0D, 0x24)
    return bus

def read_max30102(bus) -> dict:
    """
    Minimal MAX30102 read — for accurate BPM/SpO2 use the heartpy library
    to process the raw IR/Red buffers with peak detection.
    """
    data = bus.read_i2c_block_data(0x57, 0x07, 6)
    red = (data[0] << 16 | data[1] << 8 | data[2]) & 0x3FFFF
    ir  = (data[3] << 16 | data[4] << 8 | data[5]) & 0x3FFFF
    # Placeholder — integrate heartpy for real BPM/SpO2 from buffer
    return {"heartRate": None, "spO2": None, "_raw_red": red, "_raw_ir": ir}


def init_ds18b20():
    """DS18B20 one-wire temperature sensor."""
    from w1thermsensor import W1ThermSensor
    return W1ThermSensor()

def read_ds18b20(sensor) -> float:
    temp_c = sensor.get_temperature()
    return round(temp_c * 9 / 5 + 32, 1)  # → Fahrenheit


def init_mlx90614():
    """MLX90614 infrared (non-contact) temperature sensor."""
    import board
    import busio
    import adafruit_mlx90614
    i2c = busio.I2C(board.SCL, board.SDA)
    return adafruit_mlx90614.MLX90614(i2c)

def read_mlx90614(sensor) -> float:
    temp_c = sensor.object_temperature  # skin/forehead temp
    return round(temp_c * 9 / 5 + 32, 1)


def build_real_reader(args):
    """Returns a callable () -> dict that reads real sensors."""
    if args.sensor_type == "max30100":
        pulse_sensor = init_max30100()
        def read_pulse(): return read_max30100(pulse_sensor)
    else:
        pulse_bus = init_max30102()
        def read_pulse(): return read_max30102(pulse_bus)

    if args.temp_type == "ds18b20":
        temp_sensor = init_ds18b20()
        def read_temp(): return read_ds18b20(temp_sensor)
    elif args.temp_type == "mlx90614":
        temp_sensor = init_mlx90614()
        def read_temp(): return read_mlx90614(temp_sensor)
    else:
        def read_temp(): return None

    def read_all():
        result = read_pulse()
        result["temperature"] = read_temp()
        return result

    return read_all


# ── Vitals loop ────────────────────────────────────────────────────────────────

def run_vitals(server: str, read_fn, interval: float, stop: threading.Event):
    mode = "REAL" if read_fn != read_mock_vitals else "MOCK"
    print(f"[VITALS] Mode={mode}  Interval={interval}s  Server={server}")

    # Clear stale data from any previous session
    try:
        _http.delete(f"{server}/api/vitals", timeout=3)
    except Exception:
        pass

    while not stop.is_set():
        try:
            data = read_fn()
            # Only send fields that have a value
            payload = {k: v for k, v in data.items()
                       if v is not None and not k.startswith("_")}
            if payload:
                post(server, "/api/vitals", payload)
                vals = " | ".join(f"{k}={v}" for k, v in payload.items())
                print(f"[VITALS] {vals}")
        except Exception as e:
            print(f"[VITALS] Read error: {e}")
        stop.wait(interval)


# ── 5-second recording ─────────────────────────────────────────────────────────
#
# The camera is used for exactly one thing: when the kiosk's vitals page
# triggers it (after camera consent, before the patient rates pain areas),
# record a single `duration`-second clip and upload it to the Jetson AI
# server. The camera is opened right before and closed right after — it is
# never on otherwise.

def record_clip(duration: float, tmp_path: str) -> int:
    """Open the Pi camera, record `duration` seconds to tmp_path, close it.
    Returns the number of frames written."""
    import cv2
    from picamera2 import Picamera2

    cam = Picamera2()
    try:
        # 720p so the BP monitor digits are large enough for OCR on the Jetson
        cam.configure(cam.create_video_configuration(
            main={"size": (1280, 720), "format": "RGB888"}
        ))
        cam.start()
        time.sleep(0.3)   # sensor warm-up / auto-exposure settle

        fps = 15
        out = cv2.VideoWriter(
            tmp_path, cv2.VideoWriter_fourcc(*"mp4v"), fps, (1280, 720)
        )
        frames = int(duration * fps)
        for _ in range(frames):
            frame = cam.capture_array()
            out.write(cv2.cvtColor(frame, cv2.COLOR_RGB2BGR))
        out.release()
        return frames
    finally:
        # Always fully release the camera, even if recording failed
        try:
            cam.stop()
        except Exception:
            pass
        cam.close()


def upload_clip(jetson: str, session_id: str, tmp_path: str) -> bool:
    """Upload the clip to the Jetson AI server as multipart/form-data."""
    try:
        with open(tmp_path, "rb") as f:
            resp = _http.post(
                f"{jetson}/video/{session_id}",
                files={"file": ("clip.mp4", f, "video/mp4")},
                timeout=30,
            )
        if resp.ok:
            print("[VIDEO] Uploaded to Jetson ✓ (analysis starts immediately)")
            return True
        print(f"[VIDEO] Upload failed: HTTP {resp.status_code}")
    except Exception as e:
        print(f"[VIDEO] Upload error: {e}")
    return False


def run_video_recorder(server: str, jetson: str, duration: float,
                       real: bool, stop: threading.Event):
    """
    Polls the kiosk's /api/video for a recording trigger.
    On trigger: record one clip → upload to Jetson → delete local file.
    """
    if real:
        try:
            import cv2                      # noqa: F401
            from picamera2 import Picamera2 # noqa: F401
        except ImportError as e:
            print(f"[VIDEO] Missing library ({e}) — falling back to mock recorder")
            real = False

    print(f"[VIDEO] {'REAL' if real else 'MOCK'} recorder ready  "
          f"duration={duration}s  jetson={jetson}")

    last_session: "str | None" = None

    while not stop.is_set():
        state = get_json(server, "/api/video")
        should_record = state.get("shouldRecord", False)
        session_id    = state.get("sessionId")

        if not should_record or session_id == last_session:
            stop.wait(0.5)
            continue

        print(f"[VIDEO] Recording triggered for session {str(session_id)[:8]}…")
        last_session = session_id

        if not real:
            # Mock: acknowledge the trigger without touching any camera
            print("[VIDEO] Mock: skipping capture")
            post(server, "/api/video", {"action": "recording_done"})
            continue

        tmp_path = f"/tmp/mk_clip_{session_id}.mp4"
        try:
            frames = record_clip(duration, tmp_path)
            print(f"[VIDEO] Clip recorded ({frames} frames) → {tmp_path}")

            # Tell the kiosk the camera work is finished
            post(server, "/api/video", {"action": "recording_done"})

            upload_clip(jetson, session_id, tmp_path)
        except Exception as e:
            print(f"[VIDEO] Recording error: {e}")
            post(server, "/api/video", {"action": "recording_done"})
        finally:
            # The clip never persists on the Pi
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    print("[VIDEO] Recorder stopped.")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    args   = parse_args()
    server = args.server.rstrip("/")

    # Derive Jetson AI server URL from --jetson flag or default to same host on port 8000
    if args.jetson:
        jetson = args.jetson.rstrip("/")
    else:
        from urllib.parse import urlparse, urlunparse
        parsed = urlparse(server)
        jetson = urlunparse(parsed._replace(netloc=f"{parsed.hostname}:8000"))

    stop = threading.Event()

    print(f"{'='*50}")
    print(f"  MediKiosk Pi Agent v3")
    print(f"  Kiosk   : {server}")
    print(f"  Jetson  : {jetson}")
    print(f"  Sensors : {'REAL' if args.real_sensors else 'MOCK'}")
    print(f"  Camera  : {'REAL — 5s clip only' if args.real_camera else 'MOCK'}")
    print(f"{'='*50}")

    if args.real_sensors:
        try:
            read_fn = build_real_reader(args)
            print("[VITALS] Real sensors initialised OK")
        except Exception as e:
            print(f"[VITALS] Sensor init failed ({e}) — falling back to mock")
            read_fn = read_mock_vitals
    else:
        read_fn = read_mock_vitals

    threads = [
        threading.Thread(
            target=run_vitals,
            args=(server, read_fn, args.vitals_interval, stop),
            daemon=True,
        ),
        threading.Thread(
            target=run_video_recorder,
            args=(server, jetson, args.video_duration, args.real_camera, stop),
            daemon=True,
        ),
    ]
    for t in threads:
        t.start()

    print("[MAIN] Running — press Ctrl+C to stop\n")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[MAIN] Shutting down…")
        stop.set()
        for t in threads:
            t.join(timeout=4)
        post(server, "/api/video", {"action": "reset"})
        sys.exit(0)


if __name__ == "__main__":
    main()
