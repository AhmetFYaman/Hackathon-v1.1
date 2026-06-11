#!/usr/bin/env python3
"""
MediKiosk — Flask web server
Runs entirely on the Raspberry Pi. Open http://localhost:5000 in Chromium.

Usage:
    python3 app.py                          # mock sensors + mock camera
    python3 app.py --real-sensors           # real MAX30100 + DS18B20
    python3 app.py --real-sensors --real-camera   # full hardware
    python3 app.py --sensor-type max30102 --temp-type mlx90614

Install:
    pip install flask
    pip install picamera2 opencv-python mediapipe   # for real camera
    pip install max30100                            # for MAX30100
    pip install smbus2 heartpy                      # for MAX30102
    pip install w1thermsensor                       # for DS18B20
    pip install adafruit-circuitpython-mlx90614     # for MLX90614
"""

import argparse
import threading
import uuid

from flask import Flask, jsonify, redirect, render_template, request, session, url_for

from camera import start_camera_thread
from esi import compute_esi
from sensors import start_sensor_thread

# ── App setup ─────────────────────────────────────────────────────────────────

app = Flask(__name__)
app.secret_key = "medikiosk-change-this-in-production"

# ── Global shared state (one patient at a time) ───────────────────────────────

_lock  = threading.Lock()
_state = {
    "vitals":         {"heartRate": None, "spO2": None, "temperature": None},
    "camera_active":  False,
    "facial_metrics": None,
}

# ── Guards ────────────────────────────────────────────────────────────────────

def require_consent():
    if not session.get("consent"):
        return redirect(url_for("consent"))

# ── Routes ────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    session.clear()
    with _lock:
        _state["vitals"]         = {"heartRate": None, "spO2": None, "temperature": None}
        _state["camera_active"]  = False
        _state["facial_metrics"] = None
    return redirect(url_for("consent"))


@app.route("/consent", methods=["GET", "POST"])
def consent():
    if request.method == "POST":
        session["consent"]    = True
        session["session_id"] = str(uuid.uuid4())
        return redirect(url_for("camera_consent"))
    return render_template("consent.html", step=1, total_steps=8, step_label="Consent")


@app.route("/camera-consent", methods=["GET", "POST"])
def camera_consent():
    _redir = require_consent()
    if _redir: return _redir
    if request.method == "POST":
        enabled = request.form.get("camera") == "yes"
        session["camera_consent"] = enabled
        if enabled:
            with _lock:
                _state["camera_active"] = True
            print("[APP] Camera activated by patient consent")
        return redirect(url_for("vitals"))
    return render_template("camera_consent.html", step=2, total_steps=8, step_label="Camera")


@app.route("/vitals")
def vitals():
    _redir = require_consent()
    if _redir: return _redir
    return render_template("vitals.html", step=3, total_steps=8, step_label="Vitals")


@app.route("/tutorial")
def tutorial():
    _redir = require_consent()
    if _redir: return _redir
    return render_template("tutorial.html", step=4, total_steps=8, step_label="Tutorial")


@app.route("/bodymap", methods=["GET", "POST"])
def bodymap():
    _redir = require_consent()
    if _redir: return _redir
    if request.method == "POST":
        session["regions"] = request.get_json()
        return jsonify({"ok": True})
    return render_template("bodymap.html", step=5, total_steps=8, step_label="Body Map")


@app.route("/painscale", methods=["GET", "POST"])
def painscale():
    _redir = require_consent()
    if _redir: return _redir
    if request.method == "POST":
        session["regions"] = request.get_json()
        return jsonify({"ok": True})
    regions = session.get("regions", [])
    return render_template("painscale.html", regions=regions,
                           step=6, total_steps=8, step_label="Pain Scale")


@app.route("/processing")
def processing():
    _redir = require_consent()
    if _redir: return _redir
    return render_template("processing.html")


@app.route("/result")
def result():
    if not session.get("esi"):
        return redirect(url_for("consent"))
    esi = session["esi"]
    return render_template("result.html", esi=esi,
                           step=8, total_steps=8, step_label="Done")


# ── API ───────────────────────────────────────────────────────────────────────

@app.route("/api/vitals")
def api_vitals():
    with _lock:
        return jsonify(_state["vitals"])


@app.route("/api/process")
def api_process():
    with _lock:
        vitals  = _state["vitals"].copy()
        facial  = _state["facial_metrics"]
    regions = session.get("regions", [])
    result  = compute_esi(vitals, regions, facial)
    session["esi"] = result
    return jsonify(result)


@app.route("/api/camera", methods=["GET", "POST"])
def api_camera():
    if request.method == "POST":
        body = request.get_json(silent=True) or {}
        if body.get("action") == "deactivate":
            with _lock:
                _state["camera_active"]  = False
                _state["facial_metrics"] = None
        return jsonify({"ok": True})
    with _lock:
        return jsonify({
            "active":  _state["camera_active"],
            "metrics": _state["facial_metrics"],
        })


# ── Main ──────────────────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--real-sensors",  action="store_true")
    p.add_argument("--real-camera",   action="store_true")
    p.add_argument("--sensor-type",   choices=["max30100", "max30102"], default="max30100")
    p.add_argument("--temp-type",     choices=["ds18b20", "mlx90614", "none"], default="ds18b20")
    p.add_argument("--port",          type=int, default=5000)
    p.add_argument("--host",          default="0.0.0.0")
    return p.parse_args()


if __name__ == "__main__":
    args = parse_args()

    start_sensor_thread(_state, _lock,
                        real=args.real_sensors,
                        sensor_type=args.sensor_type,
                        temp_type=args.temp_type)

    start_camera_thread(_state, _lock, real=args.real_camera)

    print(f"\n  MediKiosk running at http://localhost:{args.port}\n")
    # use_reloader=False is required with background threads
    app.run(host=args.host, port=args.port, debug=False, use_reloader=False, threaded=True)
