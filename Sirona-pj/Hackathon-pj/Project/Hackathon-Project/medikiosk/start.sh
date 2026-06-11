#!/bin/bash
# ============================================================
# MediKiosk — start everything on the Raspberry Pi
# Just run:  ./start.sh
# ============================================================
cd "$(dirname "$0")"

# Install Flask if missing
python3 -c "import flask" 2>/dev/null || pip3 install flask

# Enable Pi camera V4L2 driver (needed for getUserMedia in Chromium)
sudo modprobe bcm2835-v4l2 2>/dev/null || true

echo "Starting MediKiosk server..."
python3 app.py "$@" &
SERVER_PID=$!

sleep 3

echo "Opening kiosk display..."
chromium-browser \
  --kiosk \
  --no-first-run \
  --disable-infobars \
  --touch-events=enabled \
  --use-gl=egl \
  http://localhost:5000 &
CHROME_PID=$!

echo ""
echo "  MediKiosk running at http://localhost:5000"
echo "  Press Ctrl+C to stop."
echo ""

trap "kill $SERVER_PID $CHROME_PID 2>/dev/null; exit 0" INT TERM
wait $CHROME_PID
kill $SERVER_PID 2>/dev/null
