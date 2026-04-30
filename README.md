# pi-prune-swe-pruner-provider

SWE-Pruner provider/backend for `pi-prune-router`.

This package contains:

- a Pi TypeScript extension that registers provider `swe-pruner` via `prune:register-provider`
- a TypeScript HTTP client for the remote backend
- a Python FastAPI GPU backend exposing `/health` and `/prune`
- Vast.ai install/run/tunnel scripts

It does **not** expose user-facing pruning tools. Public tools such as `scan_files` are owned by `pi-prune-router`.

## Architecture

```text
Pi scan_files tool / prune:request event
  -> pi-prune-router
    -> provider prune(request)
      -> TypeScript SwePrunerClient
        -> HTTP POST /prune
          -> Python SWE-Pruner model on GPU
```

The remote Python backend never reads local paths. Local filesystem expansion, artifact creation, provider selection, and model-facing rendering happen in `pi-prune-router`.

## Repository structure

```text
pi-prune-swe-pruner-provider/
  README.md
  SPEC.md
  TRAINING_PROPOSAL.md
  package.json
  pyproject.toml
  tsconfig.json

  src/
    index.ts            # Pi extension entrypoint; registers provider
    remote-client.ts    # HTTP client for /health and /prune
    types.ts            # Shared TypeScript request/result types
    *.test.ts

  python/src/pi_prune_swe_pruner_provider/
    remote_cli.py       # CLI entrypoint for the FastAPI backend
    remote_server.py    # /health and /prune implementation

  scripts/
    install_remote_vast.sh
    run_remote_server.sh
    start_tunnel.sh

  examples/
    pi-extensions.json
```

`SPEC.md` contains product/design context. Treat this README as the operational source of truth for recreating the current backend.

## Pi extension config

The provider extension talks to a stable local HTTP endpoint:

```bash
export SWE_PRUNER_REMOTE_URL=http://127.0.0.1:8765
```

The extension registers provider `swe-pruner` at startup and again on `session_start`.

Add both router and provider packages to `~/.pi/agent/settings.json`:

```json
{
  "packages": [
    "/Users/blaz/Programming_local/Projects/pi-extensions/pi-prune-router",
    "/Users/blaz/Programming_local/Projects/pi-extensions/pi-prune-swe-pruner-provider"
  ]
}
```

## Remote backend contract

### `GET /health`

Returns backend/model status:

```json
{
  "ok": true,
  "model_path": "/workspace/models/code-pruner",
  "model_dtype": "float16",
  "model_loaded": true,
  "cuda_available": true,
  "gpu": {
    "name": "NVIDIA GeForce RTX 5060 Ti",
    "allocated_bytes": 1268975616,
    "reserved_bytes": 1291845632
  },
  "limits": {
    "max_documents": 50,
    "max_document_chars": 500000,
    "max_total_chars": 1000000
  }
}
```

### `POST /prune`

Accepts normalized router requests:

```json
{
  "goal": "Find auth gate logic",
  "documents": [
    {
      "source": "demo.ts",
      "text": "function authGate(user) { return user?.role === 'admin' }"
    }
  ],
  "options": {
    "threshold": 0.5,
    "lineNumbers": true,
    "chunkOverlapTokens": 50,
    "includeScores": true,
    "includeSpans": true
  }
}
```

Returns provider-pruned text plus structured stats/documents:

```json
{
  "ok": true,
  "text": "# demo.ts\nscore: ...\n\n  1 | function authGate...",
  "documents": [],
  "stats": {
    "inputTokens": 100,
    "outputTokens": 20,
    "compressionRatio": 0.2,
    "backend": "swe-pruner",
    "provider": "swe-pruner"
  },
  "provider": "swe-pruner"
}
```

Failure behavior:

- `413` for request/document size limits
- `507` for CUDA out-of-memory
- non-2xx responses are surfaced by the TypeScript provider as provider failures
- the router must not return raw unpruned fallback content when the provider fails

## Deploy from scratch on Vast.ai

Assume a fresh GPU instance with SSH access and this repo available locally.

### 1. Copy repo to the instance

```bash
rsync -az --delete \
  --exclude .git --exclude node_modules --exclude .venv \
  -e 'ssh -p <SSH_PORT>' \
  /Users/blaz/Programming_local/Projects/pi-extensions/pi-prune-swe-pruner-provider/ \
  root@<SSH_HOST>:/workspace/pi-prune-swe-pruner-provider/
```

### 2. Install remote dependencies and model

```bash
ssh -p <SSH_PORT> root@<SSH_HOST>
cd /workspace/pi-prune-swe-pruner-provider
bash scripts/install_remote_vast.sh
```

This creates:

```text
/workspace/swe-pruner-venv
/workspace/models/code-pruner
```

and installs:

- Python 3.12
- PyTorch CUDA 12.8
- this package with `[remote]` extras
- `flash-attn`
- `ayanami-kitasan/code-pruner` model weights

If Vast startup apt locks are active, wait for the lock to clear and rerun the script.

### 3. Start the remote backend

On the GPU instance:

```bash
cd /workspace/pi-prune-swe-pruner-provider
SWE_PRUNER_PORT=8766 bash scripts/run_remote_server.sh
```

The backend runs in tmux. Defaults:

```text
tmux session: swe-pruner-provider
log: /workspace/swe_pruner_provider.log
host: 127.0.0.1
port: 8765 unless SWE_PRUNER_PORT is set
```

### 4. Start the local tunnel

Keep Pi/provider config stable by always exposing the backend locally on port `8765`, regardless of the remote port:

```bash
SWE_PRUNER_SSH_HOST=<SSH_HOST> \
SWE_PRUNER_SSH_PORT=<SSH_PORT> \
SWE_PRUNER_LOCAL_PORT=8765 \
SWE_PRUNER_REMOTE_PORT=8766 \
SWE_PRUNER_TUNNEL_SESSION=pi-prune-swe-tunnel \
  bash scripts/start_tunnel.sh
```

Stable local contract:

```text
Pi/provider -> http://127.0.0.1:8765
local SSH tunnel -> remote 127.0.0.1:8766
```

### 5. Validate health

Locally:

```bash
curl http://127.0.0.1:8765/health | python3 -m json.tool
```

Remotely:

```bash
ssh -p <SSH_PORT> root@<SSH_HOST> 'curl http://127.0.0.1:8766/health && nvidia-smi'
```

### 6. Reload Pi and smoke test

After Pi reload, call `scan_files`:

```json
{
  "goal": "Find provider registration and remote client prune logic",
  "input": "/Users/blaz/Programming_local/Projects/pi-extensions/pi-prune-swe-pruner-provider/src",
  "threshold": 0.5,
  "maxFiles": 20,
  "lineNumbers": true
}
```

Expected: plain text with `# <path>` headings, score/token metadata, line-numbered snippets, and a prune artifact reference.

## Operational recovery

If pruning fails with `Provider swe-pruner failed: fetch failed`, check the local tunnel first:

```bash
curl http://127.0.0.1:8765/health
```

If local health fails, check remote instance/SSH and restart the tunnel:

```bash
vastai show instances
SWE_PRUNER_SSH_HOST=<SSH_HOST> SWE_PRUNER_SSH_PORT=<SSH_PORT> bash scripts/start_tunnel.sh
```

If `/health` works but `/prune` fails with `500`/`507`/OOM, restart the remote backend:

```bash
ssh -p <SSH_PORT> root@<SSH_HOST> '
  cd /workspace/pi-prune-swe-pruner-provider &&
  SWE_PRUNER_PORT=8766 bash scripts/run_remote_server.sh &&
  tail -80 /workspace/swe_pruner_provider.log &&
  nvidia-smi
'
```

If Vast reports the instance is `exited`, `scheduling`, or the GPU is unavailable, launch a fresh GPU and redeploy from this repo. Do not depend on a specific Vast instance as durable infrastructure.

## Backend stability decisions

The Python backend intentionally includes guardrails learned from OOM failures:

- `SWE_PRUNER_DTYPE=float16` by default
- generation/cache disabled where supported
- `torch.inference_mode()` and CUDA autocast during pruning
- single-flight `_prune_lock` so concurrent requests do not multiply VRAM usage
- request size guards:
  - `SWE_PRUNER_MAX_DOCUMENTS` default `50`
  - `SWE_PRUNER_MAX_DOCUMENT_CHARS` default `500000`
  - `SWE_PRUNER_MAX_TOTAL_CHARS` default `1000000`
- output budget guards:
  - `SWE_PRUNER_MAX_RENDERED_DOCUMENTS` default `10`
  - `SWE_PRUNER_MAX_RENDERED_CHARS` default `20000`
- CUDA OOM returns HTTP `507` after cleanup
- `gc.collect()`, `torch.cuda.empty_cache()`, and `torch.cuda.ipc_collect()` after requests when enabled

Do not remove these without replacing them with measured stability improvements.

## Environment variables

Pi/TypeScript provider:

```text
SWE_PRUNER_REMOTE_URL=http://127.0.0.1:8765
SWE_PRUNER_TIMEOUT_MS=60000
SWE_PRUNER_PROVIDER_PRIORITY=100
```

Remote Python backend:

```text
SWE_PRUNER_MODEL_PATH=/workspace/models/code-pruner
SWE_PRUNER_HOST=127.0.0.1
SWE_PRUNER_PORT=8766
SWE_PRUNER_DTYPE=float16
SWE_PRUNER_EMPTY_CACHE=1
SWE_PRUNER_MAX_DOCUMENTS=50
SWE_PRUNER_MAX_DOCUMENT_CHARS=500000
SWE_PRUNER_MAX_TOTAL_CHARS=1000000
SWE_PRUNER_MAX_RENDERED_DOCUMENTS=10
SWE_PRUNER_MAX_RENDERED_CHARS=20000
```

Scripts:

```text
SWE_PRUNER_VENV=/workspace/swe-pruner-venv
SWE_PRUNER_PROJECT_DIR=/workspace/pi-prune-swe-pruner-provider
SWE_PRUNER_LOG=/workspace/swe_pruner_provider.log
SWE_PRUNER_TMUX_SESSION=swe-pruner-provider
SWE_PRUNER_SSH_HOST=<host>
SWE_PRUNER_SSH_PORT=<port>
SWE_PRUNER_LOCAL_PORT=8765
SWE_PRUNER_REMOTE_PORT=8766
SWE_PRUNER_TUNNEL_SESSION=swe-pruner-tunnel
```

## Creating another backend/provider

For a different model or service, keep the router contract and replace only the provider implementation.

Checklist:

1. Create a new Pi extension package.
2. Register with `prune:register-provider`.
3. Implement `prune(request, signal)` returning `PruneResult`.
4. If using a remote model, expose `/health` and `/prune` with the normalized request shape above.
5. Keep local filesystem expansion out of the remote backend.
6. Add size limits, timeout handling, and no-raw-fallback behavior.
7. Add deploy/run/tunnel scripts.
8. Add a `scan_files` smoke test to the README.

Examples of future providers:

- Cohere rerank provider
- RunPod serverless SWE-Pruner worker
- local heuristic/text pruner
- Hetzner persistent router + disposable GPU worker
