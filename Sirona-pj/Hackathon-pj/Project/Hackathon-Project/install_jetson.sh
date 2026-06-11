#!/usr/bin/env bash
# MediKiosk — Jetson setup script
# Run once on the Jetson Nano/Orin after cloning the repo.
#
# Usage:
#   chmod +x install_jetson.sh
#   ./install_jetson.sh

set -euo pipefail

echo "======================================================"
echo "  MediKiosk Jetson Setup"
echo "======================================================"

# ── Python dependencies ────────────────────────────────────────────────────────
echo ""
echo "[1/5] Installing Python dependencies..."
pip3 install --upgrade pip
pip3 install \
    fastapi uvicorn python-multipart aiofiles httpx \
    scikit-learn numpy \
    opencv-python scipy \
    mediapipe

echo "  Python deps installed."

# ── Train ESI Random Forest model ─────────────────────────────────────────────
echo ""
echo "[2/5] Training ESI Random Forest model..."
python3 AI-parts/train_esi.py
echo "  ESI model saved to /home/sana/esi_model.pkl"

# ── Install Ollama ─────────────────────────────────────────────────────────────
echo ""
echo "[3/5] Installing Ollama..."
if command -v ollama &>/dev/null; then
    echo "  Ollama already installed: $(ollama --version)"
else
    curl -fsSL https://ollama.com/install.sh | sh
    echo "  Ollama installed."
fi

# ── Pull Ollama model ──────────────────────────────────────────────────────────
echo ""
echo "[4/5] Pulling Ollama model (llama3.2:3b — ~2 GB)..."
echo "  This may take several minutes depending on your connection."
ollama pull llama3.2:3b
echo "  Model ready."

# ── Create output directories ──────────────────────────────────────────────────
echo ""
echo "[5/5] Creating directories..."
sudo mkdir -p /opt/medikiosk/hl7
sudo chown -R "$USER:$USER" /opt/medikiosk
mkdir -p /tmp/medikiosk_video
echo "  Directories created."

# ── Print launch instructions ──────────────────────────────────────────────────
echo ""
echo "======================================================"
echo "  Setup complete!"
echo ""
echo "  Start Ollama (keep running in background):"
echo "    ollama serve &"
echo ""
echo "  Start Jetson AI server:"
echo "    python3 jetson_ai_server.py"
echo ""
echo "  Start Next.js kiosk:"
echo "    cd kiosk-src && npm install && npm run build && npm start"
echo ""
echo "  On the Raspberry Pi:"
echo "    python3 pi_sensor.py \\"
echo "      --server http://<JETSON_IP>:3000 \\"
echo "      --jetson http://<JETSON_IP>:8000 \\"
echo "      --real-sensors --real-camera"
echo "======================================================"
