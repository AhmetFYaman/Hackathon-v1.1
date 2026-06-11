from __future__ import annotations  # Python 3.9 compat for dict | None syntax
import random

ESI_INFO = {
    1: {"label": "Resuscitation", "color": "#ef4444", "wait": "Immediate",  "bg": "rgba(239,68,68,0.15)"},
    2: {"label": "Emergent",      "color": "#f97316", "wait": "< 15 min",  "bg": "rgba(249,115,22,0.15)"},
    3: {"label": "Urgent",        "color": "#facc15", "wait": "< 30 min",  "bg": "rgba(250,204,21,0.15)"},
    4: {"label": "Less Urgent",   "color": "#22c55e", "wait": "< 60 min",  "bg": "rgba(34,197,94,0.15)"},
    5: {"label": "Non-Urgent",    "color": "#06b6d4", "wait": "< 120 min", "bg": "rgba(6,182,212,0.15)"},
}

ESI_DESC = {
    1: "You require immediate attention. Please alert the front desk or press the call button now.",
    2: "You will be seen by a nurse very soon. Please remain nearby and do not leave.",
    3: "Your condition needs attention. A nurse will review your assessment and call you shortly.",
    4: "You are in the queue. Your vitals look stable — a nurse will confirm your assessment.",
    5: "Your symptoms appear minor. Please wait in the waiting area — you are in the queue.",
}

CRITICAL_REGIONS = {"chest-left", "chest-right", "head-front", "abdomen"}


def _vital_risk(vitals: dict) -> int:
    risk = 0
    hr   = vitals.get("heartRate")
    spo2 = vitals.get("spO2")
    temp = vitals.get("temperature")
    if hr   is not None:
        if   hr > 150 or hr < 40:   risk += 3
        elif hr > 100 or hr < 60:   risk += 1
    if spo2 is not None:
        if   spo2 < 90:             risk += 3
        elif spo2 < 94:             risk += 2
    if temp is not None:
        if   temp > 104 or temp < 95: risk += 2
        elif temp > 101 or temp < 97: risk += 1
    return risk


def _pain_risk(regions: list) -> int:
    if not regions:
        return 0
    max_pain     = max(r.get("painLevel", 0) for r in regions)
    has_critical = any(r.get("id") in CRITICAL_REGIONS for r in regions)
    return max_pain + (2 if has_critical else 0)


def _facial_risk(facial: dict | None) -> int:
    if not facial:
        return 0
    score = facial.get("distressScore", 0)
    if score >= 7: return 2
    if score >= 4: return 1
    return 0


def compute_esi(vitals: dict, regions: list, facial: dict | None = None) -> dict:
    total = _vital_risk(vitals) + _pain_risk(regions) + _facial_risk(facial)

    if   total >= 12: level = 1
    elif total >= 8:  level = 2
    elif total >= 5:  level = 3
    elif total >= 2:  level = 4
    else:             level = 5

    return {
        "level":          level,
        "description":    ESI_DESC[level],
        "queue_position": random.randint(1, 8),
        **ESI_INFO[level],
    }
