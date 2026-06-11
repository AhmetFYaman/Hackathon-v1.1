"""
Camera agent — runs in a background thread.
Activates only after patient gives camera consent.
Analyzes face with MediaPipe, posts derived metrics only.
No images are ever stored or transmitted.
"""

import threading
import time


def _compute_distress(landmarks) -> float:
    """Derive 0-10 distress from MediaPipe face mesh landmark geometry."""
    try:
        inner_brow_y = (landmarks[9].y  + landmarks[10].y)  / 2
        outer_brow_y = (landmarks[70].y + landmarks[300].y) / 2
        brow_furrow  = max(0.0, inner_brow_y - outer_brow_y) * 80

        nose_y   = landmarks[1].y
        corner_y = (landmarks[61].y + landmarks[291].y) / 2
        frown    = max(0.0, corner_y - nose_y) * 60

        return min(10.0, round(brow_furrow + frown, 1))
    except (IndexError, AttributeError):
        return 0.0


def _distress_label(score: float) -> str:
    if score < 2: return "calm"
    if score < 4: return "mild discomfort"
    if score < 6: return "moderate distress"
    if score < 8: return "significant distress"
    return "severe distress"


def _run_real_camera(state: dict, lock: threading.Lock):
    try:
        import cv2
        import mediapipe as mp
        from picamera2 import Picamera2
    except ImportError as e:
        print(f"[CAMERA] Missing library ({e}) — falling back to mock facial data")
        _run_mock_camera(state, lock)
        return

    mp_face   = mp.solutions.face_mesh
    face_mesh = mp_face.FaceMesh(
        static_image_mode=False,
        max_num_faces=1,
        refine_landmarks=True,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    )
    cam = None

    print("[CAMERA] Waiting for patient consent…")
    while True:
        with lock:
            active = state.get("camera_active", False)

        if not active:
            if cam:
                cam.stop()
                cam = None
                print("[CAMERA] Deactivated")
            time.sleep(0.5)
            continue

        if cam is None:
            print("[CAMERA] Consent received — opening Pi camera")
            cam = Picamera2()
            cam.configure(cam.create_preview_configuration(
                main={"size": (640, 480), "format": "RGB888"}
            ))
            cam.start()
            time.sleep(0.5)

        frame   = cam.capture_array()
        results = face_mesh.process(frame)
        del frame  # never stored

        if results.multi_face_landmarks:
            lm    = results.multi_face_landmarks[0].landmark
            score = _compute_distress(lm)
            label = _distress_label(score)
            metrics = {"faceDetected": True, "distressScore": score, "expressionLabel": label}
            print(f"[CAMERA] face=yes  distress={score:.1f} ({label})")
        else:
            metrics = {"faceDetected": False, "distressScore": 0.0, "expressionLabel": "unknown"}

        with lock:
            state["facial_metrics"] = metrics

        time.sleep(0.5)  # ~2 FPS


def _run_mock_camera(state: dict, lock: threading.Lock):
    import random, math
    tick = 0
    print("[CAMERA] Mock facial mode")
    while True:
        with lock:
            active = state.get("camera_active", False)
        if active:
            tick += 1
            score = round(2.0 + abs(math.sin(tick * 0.4)) * 4.0, 1)
            with lock:
                state["facial_metrics"] = {
                    "faceDetected": True,
                    "distressScore": score,
                    "expressionLabel": _distress_label(score),
                }
        time.sleep(2.0)


def start_camera_thread(state: dict, lock: threading.Lock,
                        real: bool = False) -> threading.Thread:
    fn = _run_real_camera if real else _run_mock_camera
    t  = threading.Thread(target=fn, args=(state, lock), daemon=True, name="camera")
    t.start()
    return t
