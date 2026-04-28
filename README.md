# pi-prune-swe-pruner-provider

SWE-Pruner provider/backend for `pi-prune-router`.

This package contains:

- a Pi TypeScript extension that registers provider `swe-pruner` via `prune:register-provider`
- a temporary `swe_pruner_scan` tool for local path/directory/glob scanning while the router API is still being integrated everywhere
- a generic remote Python HTTP backend exposing `/health` and `/prune`
- Vast.ai install/run/tunnel scripts

## Architecture

```text
Pi surfaces / pi-prune-router
  -> provider prune(request)
    -> TypeScript SwePrunerClient
      -> HTTP POST /prune
        -> Python SWE-Pruner model on GPU
```

The remote Python backend never reads local paths. Local filesystem expansion happens in the TypeScript extension/tool.

## Extension config

Set the remote backend URL:

```bash
export SWE_PRUNER_REMOTE_URL=http://127.0.0.1:8765
```

The extension registers provider `swe-pruner` at startup and again on session start.

## Temporary scan tool

`swe_pruner_scan` accepts:

```json
{
  "query": "Find workflow runtime and scheduler logic",
  "input": "/path/to/repo/src",
  "threshold": 0.5,
  "maxFiles": 50,
  "maxFileBytes": 500000,
  "lineNumbers": true
}
```

It returns plain text with real newlines.

## Remote deploy

Copy this repo to the Vast instance, then:

```bash
cd /workspace/pi-prune-swe-pruner-provider
bash scripts/install_remote_vast.sh
bash scripts/run_remote_server.sh
```

Start a local tunnel:

```bash
SWE_PRUNER_SSH_HOST=171.248.245.1 \
SWE_PRUNER_SSH_PORT=48185 \
bash scripts/start_tunnel.sh
```

Validate:

```bash
curl http://127.0.0.1:8765/health
curl -X POST http://127.0.0.1:8765/prune \
  -H 'content-type: application/json' \
  -d '{"goal":"Find auth gate logic","documents":[{"source":"demo.ts","text":"function authGate(user) { return user?.role === '"'"'admin'"'"' }"}]}'
```
