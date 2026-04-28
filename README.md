# pi-prune-swe-pruner-provider

SWE-Pruner provider/backend for `pi-prune-router`.

This package contains:

- a Pi TypeScript extension that registers provider `swe-pruner` via `prune:register-provider`
- a generic remote Python HTTP backend exposing `/health` and `/prune`
- Vast.ai install/run/tunnel scripts

It does **not** expose user-facing pruning tools. Public tools such as `prune_context` are owned by `pi-prune-router`.

## Architecture

```text
Pi prune_context tool / prune:request event
  -> pi-prune-router
    -> provider prune(request)
      -> TypeScript SwePrunerClient
        -> HTTP POST /prune
          -> Python SWE-Pruner model on GPU
```

The remote Python backend never reads local paths. Local filesystem expansion happens in `pi-prune-router` before provider invocation.

## Extension config

Set the remote backend URL:

```bash
export SWE_PRUNER_REMOTE_URL=http://127.0.0.1:8765
```

The extension registers provider `swe-pruner` at startup and again on session start.

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
  -d '{"goal":"Find auth gate logic","documents":[{"source":"demo.ts","text":"function authGate(user) { return user?.role === '\''admin'\'' }"}]}'
```
