#!/usr/bin/env bash
set -euo pipefail

VENV="${SWE_PRUNER_VENV:-/workspace/swe-pruner-venv}"
PROJECT_DIR="${SWE_PRUNER_PROJECT_DIR:-/workspace/pi-prune-swe-pruner-provider}"
MODEL_DIR="${SWE_PRUNER_MODEL_PATH:-/workspace/models/code-pruner}"

apt-get update
apt-get install -y software-properties-common curl git build-essential ninja-build tmux python3-pip

if ! command -v python3.12 >/dev/null 2>&1; then
  add-apt-repository -y ppa:deadsnakes/ppa
  apt-get update
  apt-get install -y python3.12 python3.12-dev python3.12-venv
fi

python3.12 -m venv "$VENV"
source "$VENV/bin/activate"

pip install --upgrade pip setuptools wheel packaging ninja
pip install torch==2.8.0 --index-url https://download.pytorch.org/whl/cu128
pip install -e "$PROJECT_DIR[remote]"
pip install flash-attn==2.8.3 --no-build-isolation

python - <<PY
from huggingface_hub import snapshot_download
snapshot_download("ayanami-kitasan/code-pruner", local_dir="$MODEL_DIR")
print("downloaded", "$MODEL_DIR")
PY
