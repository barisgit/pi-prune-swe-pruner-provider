#!/usr/bin/env bash
set -euo pipefail

HOST="${SWE_PRUNER_SSH_HOST:?set SWE_PRUNER_SSH_HOST, e.g. 171.248.245.1}"
PORT="${SWE_PRUNER_SSH_PORT:?set SWE_PRUNER_SSH_PORT, e.g. 48185}"
LOCAL_PORT="${SWE_PRUNER_LOCAL_PORT:-8765}"
REMOTE_PORT="${SWE_PRUNER_REMOTE_PORT:-8765}"
SESSION="${SWE_PRUNER_TUNNEL_SESSION:-swe-pruner-tunnel}"

tmux kill-session -t "$SESSION" 2>/dev/null || true
tmux new-session -d -s "$SESSION" \
  "ssh -N -L ${LOCAL_PORT}:127.0.0.1:${REMOTE_PORT} -p ${PORT} root@${HOST}"

echo "local SWE-Pruner backend: http://127.0.0.1:${LOCAL_PORT}"
echo "tmux attach -t $SESSION"
