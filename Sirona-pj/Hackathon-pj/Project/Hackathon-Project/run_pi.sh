#!/bin/bash
# ============================================================
# MediKiosk — run on Pi while PC hosts the server
# The Pi does NOT need Node.js.
# The website runs on your PC at http://144.167.228.179:3000
# ============================================================
#
# Usage:
#   chmod +x run_pi.sh
#   ./run_pi.sh
#
# With real sensors:
#   ./run_pi.sh --real-sensors --real-camera

PC_SERVER="http://144.167.228.179:3000"   # ← your PC's IP (update if it changes)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "  MediKiosk Pi — connecting to $PC_SERVER"
echo ""

# Install Python requests if missing
python3 -c "import requests" 2>/dev/null || pip3 install requests

# Enable Pi camera as V4L2 so browser getUserMedia can reach it
sudo modprobe bcm2835-v4l2 2>/dev/null || true

# Start the sensor + camera agent (passes extra args through)
echo "[1/2] Starting sensor agent…"
python3 "$SCRIPT_DIR/pi_sensor.py" --server "$PC_SERVER" "$@" &
SENSOR_PID=$!

# Open Chromium in kiosk mode
# The --unsafely-treat-insecure-origin-as-secure flag lets the browser
# use getUserMedia (camera) over plain HTTP on the local network.
echo "[2/2] Opening kiosk in Chromium…"
sleep 2
chromium-browser \
  --kiosk \
  --no-first-run \
  --disable-infobars \
  --touch-events=enabled \
  --unsafely-treat-insecure-origin-as-secure="$PC_SERVER" \
  --user-data-dir=/tmp/medikiosk-profile \
  "$PC_SERVER" &
CHROME_PID=$!

echo ""
echo "  ✓ Running! (Ctrl+C to stop)"
echo ""

trap "kill $SENSOR_PID $CHROME_PID 2>/dev/null; exit 0" INT TERM
wait $CHROME_PID
kill $SENSOR_PID 2>/dev/null
