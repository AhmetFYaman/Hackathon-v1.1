#!/bin/bash
# ============================================================
# MediKiosk — Raspberry Pi deployment script
# Run this ON THE PI after copying the project over.
# Does NOT require npm or the Next.js dev tools.
# Only needs: node (runtime), python3, and the built files.
# ============================================================

set -e

KIOSK_DIR="$(cd "$(dirname "$0")/kiosk-src" && pwd)"
SERVER_PORT=3000

echo ""
echo "  MediKiosk Pi Deployment"
echo "  Project: $KIOSK_DIR"
echo ""

# ── Step 1: Install Node.js runtime (if not present) ─────────────────────────
if ! command -v node &>/dev/null; then
  echo "[1/4] Installing Node.js runtime…"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
  echo "      Node $(node --version) installed"
else
  echo "[1/4] Node.js already installed: $(node --version)"
fi

# ── Step 2: Install Python dependencies ──────────────────────────────────────
echo "[2/4] Installing Python sensor + camera libraries…"
pip3 install --quiet requests

echo "      Core packages installed."
echo "      For REAL sensors, also run:"
echo "        pip3 install picamera2 opencv-python mediapipe   # camera"
echo "        pip3 install max30100                            # MAX30100"
echo "        pip3 install smbus2 heartpy                      # MAX30102"
echo "        pip3 install w1thermsensor                       # DS18B20 temp"

# ── Step 3: Check for standalone build or build now ───────────────────────────
STANDALONE="$KIOSK_DIR/.next/standalone/server.js"

if [ ! -f "$STANDALONE" ]; then
  echo "[3/4] No standalone build found — building now…"
  echo "      (This may take 2-3 min on Pi — run on PC instead for speed)"
  cd "$KIOSK_DIR"
  # Install build deps (only needed once, then can remove node_modules)
  npm ci --prefer-offline 2>/dev/null || npm install
  npm run build
  echo "      Build complete."
else
  echo "[3/4] Standalone build found — skipping build step."
fi

# Copy static assets into standalone (required by Next.js standalone output)
STANDALONE_DIR="$KIOSK_DIR/.next/standalone"
if [ ! -d "$STANDALONE_DIR/.next/static" ]; then
  cp -r "$KIOSK_DIR/.next/static" "$STANDALONE_DIR/.next/static"
fi
if [ -d "$KIOSK_DIR/public" ] && [ ! -d "$STANDALONE_DIR/public" ]; then
  cp -r "$KIOSK_DIR/public" "$STANDALONE_DIR/public"
fi

# ── Step 4: Launch everything ─────────────────────────────────────────────────
echo "[4/4] Starting MediKiosk…"
echo ""

# Enable Pi camera as V4L2 device (required for browser getUserMedia)
if ! lsmod | grep -q "bcm2835_v4l2\|v4l2"; then
  echo "      Enabling Pi camera V4L2 driver…"
  sudo modprobe v4l2-common 2>/dev/null || true
  sudo modprobe bcm2835-v4l2 2>/dev/null || true
fi

# Start the web server in the background
echo "      Starting Next.js server on port $SERVER_PORT…"
cd "$STANDALONE_DIR"
PORT=$SERVER_PORT HOSTNAME=0.0.0.0 node server.js &
SERVER_PID=$!

# Give the server a moment to start
sleep 3

# Start the sensor agent in the background
echo "      Starting Pi sensor agent…"
cd "$(dirname "$0")"
python3 pi_sensor.py --server "http://localhost:$SERVER_PORT" &
SENSOR_PID=$!

# Launch Chromium in kiosk mode
# --unsafely-treat-insecure-origin-as-secure lets getUserMedia work over HTTP on LAN IPs
# --user-data-dir is required when using that flag
SERVER_URL="http://localhost:$SERVER_PORT"
echo "      Launching Chromium kiosk at $SERVER_URL…"
sleep 2
chromium-browser \
  --kiosk \
  --no-first-run \
  --disable-infobars \
  --disable-translate \
  --overscroll-history-navigation=0 \
  --touch-events=enabled \
  --use-gl=egl \
  --disable-features=Translate \
  --unsafely-treat-insecure-origin-as-secure="$SERVER_URL" \
  --user-data-dir=/tmp/medikiosk-profile \
  "$SERVER_URL" &
CHROME_PID=$!

echo ""
echo "  ✓ MediKiosk is running!"
echo "  Server  PID: $SERVER_PID"
echo "  Sensor  PID: $SENSOR_PID"
echo "  Browser PID: $CHROME_PID"
echo ""
echo "  Press Ctrl+C to stop everything."
echo ""

# Wait and handle shutdown
trap "echo 'Stopping…'; kill $SERVER_PID $SENSOR_PID $CHROME_PID 2>/dev/null; exit 0" INT TERM
wait $CHROME_PID
kill $SERVER_PID $SENSOR_PID 2>/dev/null
echo "Done."
