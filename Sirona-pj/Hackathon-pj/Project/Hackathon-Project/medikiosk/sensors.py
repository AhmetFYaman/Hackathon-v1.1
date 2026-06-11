"""
Sensor reader — mock by default, real hardware when --real-sensors flag is passed.

Supported hardware:
  Pulse + SpO2 : MAX30100  (pip install max30100)
               : MAX30102  (pip install smbus2 heartpy)
  Temperature  : DS18B20   (pip install w1thermsensor)   [1-Wire, GPIO4]
               : MLX90614  (pip install adafruit-circuitpython-mlx90614)  [I2C]
"""

import math
import random
import threading
import time

# ── Mock ──────────────────────────────────────────────────────────────────────

_base_hr   = random.randint(68, 88)
_base_spo2 = random.randint(96, 99)
_base_temp = round(random.uniform(97.8, 99.2), 1)
_tick = 0

def _read_mock() -> dict:
    global _tick
    _tick += 1
    return {
        "heartRate":   max(50, min(120, _base_hr   + round(math.sin(_tick * 0.3) * 4))),
        "spO2":        max(90, min(100, _base_spo2 + round(math.sin(_tick * 0.1) * 0.5))),
        "temperature": round(_base_temp + math.sin(_tick * 0.05) * 0.2, 1),
    }


# ── MAX30100 ──────────────────────────────────────────────────────────────────

def _init_max30100():
    from max30100 import MAX30100
    s = MAX30100()
    s.enable_spo2()
    return s

def _read_max30100(sensor) -> dict:
    sensor.read_sensor()
    try:
        bpm  = int(sensor.get_heart_rate())
        pct  = int(sensor.get_spo2())
    except Exception:
        bpm, pct = 0, 0
    return {
        "heartRate": bpm  if bpm  > 0 else None,
        "spO2":      pct  if pct  > 0 else None,
    }


# ── MAX30102 (raw I2C via smbus2) ─────────────────────────────────────────────

def _init_max30102():
    import smbus2
    bus = smbus2.SMBus(1)
    bus.write_byte_data(0x57, 0x09, 0x40)   # reset
    time.sleep(0.1)
    bus.write_byte_data(0x57, 0x09, 0x03)   # SpO2 mode
    bus.write_byte_data(0x57, 0x0A, 0x27)   # SR=100, PW=411µs
    bus.write_byte_data(0x57, 0x0C, 0x24)   # Red LED 7.2mA
    bus.write_byte_data(0x57, 0x0D, 0x24)   # IR  LED 7.2mA
    return bus

def _read_max30102(bus) -> dict:
    """
    Returns raw FIFO values. Wrap with heartpy for accurate BPM/SpO2:
        import heartpy as hp
        working_data, measures = hp.process(ir_buffer, sample_rate=100)
        bpm = measures['bpm']
    """
    data = bus.read_i2c_block_data(0x57, 0x07, 6)
    red = (data[0] << 16 | data[1] << 8 | data[2]) & 0x3FFFF
    ir  = (data[3] << 16 | data[4] << 8 | data[5]) & 0x3FFFF
    # Placeholder until heartpy buffer is full
    return {"heartRate": None, "spO2": None, "_raw_red": red, "_raw_ir": ir}


# ── DS18B20 (1-Wire) ──────────────────────────────────────────────────────────

def _init_ds18b20():
    from w1thermsensor import W1ThermSensor
    return W1ThermSensor()

def _read_ds18b20(sensor) -> float:
    c = sensor.get_temperature()
    return round(c * 9 / 5 + 32, 1)


# ── MLX90614 (infrared, I2C) ──────────────────────────────────────────────────

def _init_mlx90614():
    import board, busio, adafruit_mlx90614
    i2c = busio.I2C(board.SCL, board.SDA)
    return adafruit_mlx90614.MLX90614(i2c)

def _read_mlx90614(sensor) -> float:
    return round(sensor.object_temperature * 9 / 5 + 32, 1)


# ── Public: build reader + start background thread ────────────────────────────

def build_real_reader(sensor_type: str, temp_type: str):
    if sensor_type == "max30100":
        ps = _init_max30100()
        def pulse(): return _read_max30100(ps)
    else:
        pb = _init_max30102()
        def pulse(): return _read_max30102(pb)

    if temp_type == "ds18b20":
        ts = _init_ds18b20()
        def temp(): return _read_ds18b20(ts)
    elif temp_type == "mlx90614":
        tm = _init_mlx90614()
        def temp(): return _read_mlx90614(tm)
    else:
        def temp(): return None

    def read_all():
        data = pulse()
        data["temperature"] = temp()
        return {k: v for k, v in data.items() if not k.startswith("_")}

    return read_all


def start_sensor_thread(state: dict, lock: threading.Lock,
                        real: bool = False,
                        sensor_type: str = "max30100",
                        temp_type: str = "ds18b20",
                        interval: float = 1.0) -> threading.Thread:
    if real:
        try:
            reader = build_real_reader(sensor_type, temp_type)
            print(f"[SENSOR] Real sensors OK ({sensor_type} + {temp_type})")
        except Exception as e:
            print(f"[SENSOR] Init failed ({e}) — using mock data")
            reader = _read_mock
    else:
        reader = _read_mock
        print("[SENSOR] Mock mode")

    def loop():
        while True:
            try:
                data = reader()
                with lock:
                    state["vitals"].update(
                        {k: v for k, v in data.items() if v is not None}
                    )
            except Exception as e:
                print(f"[SENSOR] Read error: {e}")
            time.sleep(interval)

    t = threading.Thread(target=loop, daemon=True, name="sensor")
    t.start()
    return t
