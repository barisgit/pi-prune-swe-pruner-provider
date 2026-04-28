#!/usr/bin/env bash
set -euo pipefail

VENV="${SWE_PRUNER_VENV:-/workspace/swe-pruner-venv}"
PROJECT_DIR="${SWE_PRUNER_PROJECT_DIR:-/workspace/pi-prune-swe-pruner-provider}"
LOG="${SWE_PRUNER_LOG:-/workspace/swe_pruner_provider.log}"
SESSION="${SWE_PRUNER_TMUX_SESSION:-swe-pruner-provider}"

export SWE_PRUNER_MODEL_PATH="${SWE_PRUNER_MODEL_PATH:-/workspace/models/code-pruner}"
export SWE_PRUNER_HOST="${SWE_PRUNER_HOST:-127.0.0.1}"
export SWE_PRUNER_PORT="${SWE_PRUNER_PORT:-8765}"
export SWE_PRUNER_DTYPE="${SWE_PRUNER_DTYPE:-float16}"
export SWE_PRUNER_EMPTY_CACHE="${SWE_PRUNER_EMPTY_CACHE:-1}"

tmux kill-session -t "$SESSION" 2>/dev/null || true
tmux new-session -d -s "$SESSION" \
  "source '$VENV/bin/activate' && cd '$PROJECT_DIR' && pi-prune-swe-pruner-remote > '$LOG' 2>&1"

echo "started tmux session $SESSION"
echo "logs: $LOG"
