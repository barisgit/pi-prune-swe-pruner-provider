# SPEC: Pi SWE-Pruner Provider

## 1. Purpose

`pi-prune-swe-pruner-provider` is the SWE-Pruner-backed provider for Pi's future first-class `context.prune(...)` capability.

It provides a generic, goal-driven pruning backend that can reduce large already-selected content before it enters model context, while preserving the details that matter for the current task.

The provider is not the context-pruning system itself. A neutral context-prune runtime/service owns the public primitive, artifact lifecycle, policy, and context insertion behavior. That service must be available to all Pi surfaces that admit large content into context: `read`, `bash`, `fetch`, web search, MCP, subagents, DCP, and other extensions. This project owns only the SWE-Pruner implementation/provider and deployable remote model backend.

## 2. Product direction

The desired Pi primitive is:

```ts
context.prune({
  input,
  goal,
  preserve,
  budget,
  metadata,
});
```

This should become a first-tier capability available to all Pi tools/extensions through a shared service contract, comparable in ergonomics to reading files, managing artifacts, and managing context. It may live in Pi core or in a neutral dedicated extension, but it must not be owned by one consumer such as DCP.

`scan_files` is owned by `pi-prune-router`; this provider only registers the SWE-Pruner backend.

## 3. Core distinction

Auggie/codebase retrieval and pruning solve different problems:

```text
Auggie/codebase retrieval:
  Finds what content might matter.

context.prune(...):
  Shrinks already-selected content so it fits context while preserving goal-relevant details.
```

Examples of already-selected content:

- large file contents
- directory scan candidates
- test logs
- bash output
- web fetches
- grep/search results
- MCP tool responses
- subagent output
- generated reports
- docs pages

## 4. Non-goals

This provider must not become:

- Pi's full context-pruning runtime/service
- an MCP-first project
- a local filesystem API on the remote server
- an artifact retrieval service
- a Pi session-state service
- a rigid `kind: "code" | "logs" | "web"` classifier
- a replacement for codebase retrieval

## 5. Naming

Repository name:

```text
pi-prune-swe-pruner-provider
```

External package/CLI naming uses hyphens:

```text
pi-prune-swe-pruner-provider
pi-swe-pruner-local
pi-swe-pruner-remote
```

Python module naming uses underscores:

```py
pi_swe_pruner_provider
```

Temporary MCP tool name may remain identifier-like:

```text
scan_files
```

## 6. Target repository location

```text
/Users/blaz/Programming_local/Projects/pi-extensions/pi-prune-swe-pruner-provider
```

This project should replace the earlier prototype location:

```text
/Users/blaz/Programming_local/Projects/swe-pruner-mcp
```

The old name should not remain as the canonical source of truth because the project is no longer MCP-centered.

## 7. Repository structure

The project is a Pi extension/provider package with a Python remote inference service and deployment scripts.

Current implementation structure:

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
    types.ts            # shared TypeScript request/result types
    *.test.ts

  python/src/pi_prune_swe_pruner_provider/
    __init__.py
    remote_cli.py       # CLI entrypoint for FastAPI backend
    remote_server.py    # /health and /prune implementation

  scripts/
    install_remote_vast.sh
    run_remote_server.sh
    start_tunnel.sh

  examples/
    pi-extensions.json
```

`README.md` is the operational source of truth for recreating the current backend. This SPEC records design intent and should not describe files that do not exist.

## 8. Architecture

Final architecture:

```text
Pi content-producing surfaces (`read`, `bash`, `fetch`, web search, MCP, subagents, DCP, extensions)
  -> pi-prune-router context.prune(...) service or equivalent event contract
    -> service-side provider selection
      -> pi-prune-swe-pruner-provider TypeScript provider
        -> local input normalization and artifact handling
        -> HTTP request to remote Python backend
          -> SWE-Pruner model inference on GPU
        <- structured prune result
      -> context-facing rendered text
  -> only pruned text enters model context
  -> full raw content remains available as artifact
```

Temporary compatibility architecture:

```text
Pi tool: scan_files
  -> pi-prune-router
    -> local path/glob expansion
    -> local file reads
    -> provider.prune(...)
      -> remote Python /prune
```

Remote Python backend:

```text
Generic HTTP API only.
No MCP.
No local filesystem reading.
No Pi-specific artifact logic.
```

## 9. Responsibility split

### 9.1 Pi / TypeScript extension owns

The TypeScript layer owns Pi-local/runtime concerns:

- local path expansion
- directory traversal
- include/exclude globs
- `.gitignore`-style filtering if needed
- local file reads
- artifact creation and retention
- artifact references in model-facing output
- deciding when pruning is needed
- creating the task-specific `goal`
- preserve hints
- budget selection
- provider config
- retries/fallbacks
- output rendering for model context
- optional MCP compatibility shim
- eventual integration with neutral `context.prune(...)` service

### 9.2 Remote Python backend owns

The Python backend owns model-native pruning:

- model loading
- tokenizer/model-specific chunking
- sparse/SWE-Pruner scoring
- GPU batching
- dtype and CUDA memory management
- model-safe input limits
- reconstructing preserved spans/lines
- returning scores/token stats/spans
- `/health`
- `/prune`

### 9.3 Remote Python backend must not own

The remote backend must not know about:

- Pi sessions
- DCP compression blocks
- local filesystem paths as readable paths
- artifacts as readable files
- MCP
- tool names
- subagent state
- cwd/session ids except opaque optional text metadata if truly useful
- user-specific Pi config

## 10. Artifact strategy

When `context.prune(...)` receives large raw input, Pi should save the full raw content as an artifact before pruning.

Default artifact location:

```text
~/.pi/prune-artifacts/
```

This lives outside the agent configuration tree. It can be overridden with `PI_PRUNE_ARTIFACT_DIR`.

Avoid `/tmp` as the default for important prune artifacts because:

- `/tmp` may be cleaned by OS/session policies
- artifacts should survive long enough for follow-up investigation
- model context should be able to refer to recoverable content

`/tmp` is acceptable for short-lived debug experiments, but not the default runtime path.

Artifact layout should be deterministic enough for debugging and safe enough to avoid collisions:

```text
~/.pi/prune-artifacts/
  YYYY-MM-DD/
    <timestamp-id>.txt
    <timestamp-id>.json
```

Example:

```text
~/.pi/prune-artifacts/2026-04-29/2026-04-29T12-00-00-000Z-a1b2c3.txt
~/.pi/prune-artifacts/2026-04-29/2026-04-29T12-00-00-000Z-a1b2c3.json
```

The model-facing pruned output should include the artifact reference:

```text
Full raw content saved at: ~/.pi/prune-artifacts/2026-04-29/2026-04-29T12-00-00-000Z-a1b2c3.txt
```

The pruner backend does not need a retrieval API for full artifacts. If the agent needs the full content later, it can use normal Pi tools such as `read`, `grep`, or future artifact tools.

## 11. Why artifact refs should not be sent to backend

The backend only needs content, goal, optional preserve hints, budget, and model-relevant hints.

Backend does not need:

```json
{
  "artifactRef": "/tmp/pi-artifacts/bun-test-full.log",
  "metadata": {
    "command": "bun test"
  }
}
```

Those are Pi/runtime concerns.

Pi should keep artifact refs locally and reattach them when rendering final context output.

Backend may receive only model-relevant hints:

```json
{
  "id": "doc-1",
  "source": "bun test",
  "text": "...",
  "hints": {
    "mimeType": "text/plain",
    "language": null,
    "lineOffset": 0
  }
}
```

Even `source` is only a human-readable label for grouping output; it is not a path the backend should open.

## 12. No required `kind`

Do not add:

```ts
kind: "code" | "logs" | "web" | "docs"
```

Reason:

- Caller should not need to classify content.
- Same content may need different pruning depending on goal.
- The important input is the task-specific `goal`.
- Tool-specific behavior can be expressed through preserve hints and metadata.

Soft hints are allowed as metadata/hints:

```ts
hints?: {
  mimeType?: string;
  language?: string;
  lineOffset?: number;
}
```

These hints may affect formatting/chunking, but should not become rigid semantic routing.

## 13. Pi-facing `context.prune(...)` API

Target TypeScript API:

```ts
export type ContextPruneRequest = {
  input: ContextPruneInput;
  goal: string;
  preserve?: string[];
  budget?: PruneBudget;
  metadata?: Record<string, unknown>;
};

export type ContextPruneInput =
  | string
  | ContextPruneDocument
  | ContextPruneDocument[];

export type ContextPruneDocument = {
  text: string;
  source?: string;
  artifactRef?: string;
  metadata?: Record<string, unknown>;
};

export type PruneBudget = {
  tokens?: number;
  chars?: number;
  ratio?: number;
};

export type ContextPruneResult = {
  text: string;
  artifacts?: Array<{
    ref: string;
    description?: string;
  }>;
  stats?: {
    inputTokens?: number;
    outputTokens?: number;
    compressionRatio?: number;
    provider?: string;
    latencyMs?: number;
  };
  warnings?: string[];
};
```

### 13.1 Expected runtime behavior

```text
large raw content
  -> save full raw content as artifact
  -> call context.prune(...) with current goal
  -> provider sends content to remote backend
  -> put only pruned output into model context
  -> include artifact ref so full content is recoverable
```

### 13.2 Example

```ts
await context.prune({
  input: rawOutput,
  goal: "Keep failing test names, assertion errors, stack traces, and relevant source file paths",
  preserve: ["errors", "paths", "line numbers", "stack traces", "test names"],
  budget: { tokens: 4000 },
  metadata: {
    source: "bun test",
    lineNumbers: true,
  },
});
```

## 14. Backend HTTP API

The backend is a generic pruning HTTP API.

### 14.1 Endpoints

```http
GET /health
POST /prune
```

No `/mcp` endpoint is required long-term.

### 14.2 Backend request schema

```ts
export type BackendPruneRequest = {
  goal: string;
  documents: BackendPruneDocument[];
  preserve?: string[];
  budget?: PruneBudget;
  options?: BackendPruneOptions;
};

export type BackendPruneDocument = {
  id?: string;
  source?: string;
  text: string;
  hints?: {
    mimeType?: string;
    language?: string;
    lineOffset?: number;
  };
};

export type BackendPruneOptions = {
  threshold?: number;
  lineNumbers?: boolean;
  chunkOverlapTokens?: number;
  includeScores?: boolean;
  includeSpans?: boolean;
  maxOutputDocuments?: number;
  maxOutputTokensPerDocument?: number;
};
```

### 14.3 Backend response schema

```ts
export type BackendPruneResponse = {
  text: string;
  documents: BackendPrunedDocument[];
  stats: {
    inputTokens?: number;
    outputTokens?: number;
    compressionRatio?: number;
    latencyMs?: number;
    backend: "swe-pruner";
    model: string;
  };
  warnings?: string[];
};

export type BackendPrunedDocument = {
  id?: string;
  source?: string;
  text: string;
  score?: number;
  spans?: Array<{
    startLine?: number;
    endLine?: number;
    startChar?: number;
    endChar?: number;
    score?: number;
  }>;
  stats?: {
    inputTokens?: number;
    outputTokens?: number;
    compressionRatio?: number;
  };
};
```

### 14.4 Multiple files example

```json
{
  "goal": "Find workflow runtime, registry, scheduler, and queue execution logic",
  "documents": [
    {
      "id": "runtime",
      "source": "src/workflows/core/runtime.ts",
      "text": "...",
      "hints": {
        "language": "typescript",
        "mimeType": "text/typescript"
      }
    },
    {
      "id": "registry",
      "source": "src/workflows/registry.ts",
      "text": "...",
      "hints": {
        "language": "typescript",
        "mimeType": "text/typescript"
      }
    }
  ],
  "preserve": ["function names", "type names", "line numbers", "control flow"],
  "budget": {
    "tokens": 4000
  },
  "options": {
    "threshold": 0.5,
    "lineNumbers": true,
    "includeSpans": true
  }
}
```

### 14.5 Multiple web fetches example

```json
{
  "goal": "Keep claims about API authentication, rate limits, request schema, and error responses",
  "documents": [
    {
      "id": "docs-auth",
      "source": "https://example.com/docs/auth",
      "text": "...",
      "hints": {
        "mimeType": "text/markdown"
      }
    },
    {
      "id": "docs-errors",
      "source": "https://example.com/docs/errors",
      "text": "...",
      "hints": {
        "mimeType": "text/markdown"
      }
    }
  ],
  "preserve": ["endpoints", "headers", "JSON fields", "status codes", "rate limits"],
  "budget": {
    "tokens": 3000
  },
  "options": {
    "lineNumbers": false,
    "includeScores": true
  }
}
```

### 14.6 Test log example

Pi keeps the artifact ref. Backend receives only content and pruning hints:

```json
{
  "goal": "Keep failing test names, assertion errors, stack traces, and relevant source file paths",
  "documents": [
    {
      "id": "bun-test",
      "source": "bun test",
      "text": "... huge test output ...",
      "hints": {
        "mimeType": "text/plain"
      }
    }
  ],
  "preserve": ["errors", "paths", "line numbers", "stack traces", "test names"],
  "budget": {
    "tokens": 4000
  }
}
```

Pi reattaches artifact information in rendered output:

```text
Full raw output saved at: ~/.pi/prune-artifacts/2026-04-29/2026-04-29T12-00-00-000Z-a1b2c3.txt
```

## 15. Backend implementation details

The Python backend should be moderately thin:

```text
thin enough:
  generic /prune API, no Pi concepts

smart enough:
  owns SWE-Pruner model-native chunking/scoring/reconstruction
```

Server should do:

- load `ayanami-kitasan/code-pruner`
- use `torch.float16` by default
- disable generation/model cache where supported
- run under `torch.inference_mode()` and CUDA autocast
- serialize prune calls with a single-flight lock unless concurrency has been measured safe
- enforce request size limits before model inference
- return `413` for oversized requests/documents
- return `507` for CUDA OOM after cleanup
- clear CUDA cache after requests unless disabled
- batch documents safely within GPU constraints
- cap rendered output for multi-document requests
- return per-document scores/stats
- preserve/reconstruct exact original lines where possible

Server should not be just raw model logits, because that would force the TypeScript extension to understand SWE-Pruner internals.

## 16. Recreating a remote deployment

The backend should be reproducible from this repository on a fresh GPU instance.

Operational contract:

```text
Pi/provider config -> http://127.0.0.1:8765
local tunnel        -> remote 127.0.0.1:<backend port>
remote backend      -> FastAPI /health and /prune
```

Recommended remote backend port is `8766` so local port `8765` can stay stable across providers/backends:

```bash
# remote GPU instance
cd /workspace/pi-prune-swe-pruner-provider
SWE_PRUNER_PORT=8766 bash scripts/run_remote_server.sh

# local machine
SWE_PRUNER_SSH_HOST=<host> \
SWE_PRUNER_SSH_PORT=<port> \
SWE_PRUNER_LOCAL_PORT=8765 \
SWE_PRUNER_REMOTE_PORT=8766 \
  bash scripts/start_tunnel.sh
```

Validation:

```bash
curl http://127.0.0.1:8765/health
curl -X POST http://127.0.0.1:8765/prune \
  -H 'content-type: application/json' \
  -d '{"goal":"Find auth gate logic","documents":[{"source":"demo.ts","text":"function authGate(user) { return user?.role === '\''admin'\'' }"}]}'
```

Then reload Pi and run `scan_files` on a small source directory.

## 17. Migration status

The old `swe-pruner-mcp` prototype is no longer the canonical source of truth. The canonical provider repo is:

```text
/Users/blaz/Programming_local/Projects/pi-extensions/pi-prune-swe-pruner-provider
```

Completed migration decisions:

1. Public tool ownership moved to `pi-prune-router` as `scan_files`.
2. Provider-specific direct tools were removed from the provider responsibility.
3. Remote backend is generic HTTP (`GET /health`, `POST /prune`), not MCP.
4. Local filesystem expansion lives in `pi-prune-router`.
5. Stale local wrapper `/Users/blaz/.pi/agent/mcp/swe_pruner_local.py` was removed.
6. The stable local backend URL is `http://127.0.0.1:8765`.

## 18. Temporary MCP compatibility shim

Until Pi has first-class `context.prune(...)`, the router exposes:

```text
scan_files
```

This shim should be implemented in TypeScript because it needs local filesystem access.

It should accept a simplified input shape:

```ts
type SwePrunerScanInput = {
  query: string;
  input: string | string[] | { path: string; content: string } | Array<{ path: string; content: string }>;
  baseDir?: string;
  threshold?: number;
  maxFiles?: number;
  maxFileBytes?: number;
  lineNumbers?: boolean;
};
```

It should:

```text
expand local paths/globs
read local files
save artifacts if input is large enough
call provider.prune(...)
return plain text only
```

MCP output should remain model-friendly:

```text
# src/file.ts
score: 0.9504 | tokens: 2045 -> 241 | ratio: 0.12

   82 | relevant code
```

## 19. First implementation pass boundaries

The first implementation pass should include:

- repo rename/migration
- TypeScript scaffold
- Python generic HTTP backend
- TS remote client
- TS provider function
- temporary TS MCP shim if needed for current Pi usage
- updated deployment scripts
- updated Pi config example
- validation against the existing 5060 Ti server

The first pass should not include full context-prune runtime integration unless discovery confirms the exact service contract and insertion points.

## 20. Cross-extension API and global context-prune service

`context.prune(...)` should be treated as a neutral shared service API available to every Pi surface that may produce large context-bound content. DCP is only one possible caller, the same as `read`, `bash`, `fetch`, web search, MCP, subagents, or any other extension.

Recommended ownership:

```text
pi-prune-router
  owns public context.prune(...) semantics
  owns artifact creation/retention
  owns provider selection and fallback
  owns model-facing rendering
  is callable from read/bash/fetch/web/MCP/subagents/DCP/extensions

pi-prune-swe-pruner-provider
  registers the SWE-Pruner provider
  exposes a TypeScript provider implementation
  deploys/clients the remote Python /prune backend
```

Short-term event contract:

```ts
pi.events.emit("prune:request", {
  request,
  resolve,
  reject,
});
```

Provider/service listener shape:

```ts
pi.events.on("prune:request", async (event) => {
  try {
    const result = await prune(event.request);
    event.resolve(result);
  } catch (error) {
    event.reject(error);
  }
});
```

Longer-term provider registration shape:

```ts
pi.events.emit("prune:register-provider", {
  name: "swe-pruner",
  priority: 100,
  prune: async (request) => swePrunerProvider.prune(request),
});
```

Other extensions should not import `pi-prune-swe-pruner-provider` directly. They should call the shared service API/event contract. The provider extension should not own the universal API; it should only register/provide the SWE-Pruner backend.

Integration points to investigate in the neutral context-prune service:

- where tool outputs are admitted to model context
- where full tool outputs/artifacts are persisted
- whether DCP should call the same service for its own compression/pruning needs
- how extensions expose internal APIs to other tools/extensions/subagents through `pi.events`
- where provider registration and fallback should live

Adoption should start with one high-value path:

1. large `bash` output/test logs
2. large `fetch` output
3. large `read` file output
4. MCP tool responses
5. subagent outputs

## 21. Validation checklist

After migration:

```bash
cd /Users/blaz/Programming_local/Projects/pi-extensions/pi-prune-swe-pruner-provider

# TypeScript
bun install
bun test
bun run typecheck

# Python
python3 -m py_compile python/src/pi_swe_pruner_provider/*.py
python3 -m json.tool examples/pi-mcp.json
```

Remote API validation:

```bash
curl http://127.0.0.1:8765/health
curl -X POST http://127.0.0.1:8765/prune \
  -H 'content-type: application/json' \
  -d '{
    "goal": "Find auth gate logic",
    "documents": [{"id":"demo","source":"demo.ts","text":"function authGate(user) { return user?.role === '\''admin'\'' }"}],
    "options": {"lineNumbers": true}
  }'
```

Local provider validation:

```text
Call local shim/provider with a directory path and confirm:
- local files are read locally
- backend receives document text, not paths
- output is plain text with real newlines
- artifact ref is included only in Pi-rendered output, not backend request
```

## 22. Open decisions

1. Whether artifact retention should be global default `7` days forever, or configurable per request/session.

2. Whether temporary MCP shim remains in this repo or in Pi dev tooling.

3. Whether backend should be FastAPI or a lighter HTTP stack.
   - Recommended: FastAPI + uvicorn for clear schemas and deployment simplicity.

4. Whether backend response includes both aggregate `text` and structured `documents`.
   - Recommended: yes.
   - TS provider decides what enters model context.

5. How provider selection works once multiple pruning backends exist.
   - Future providers could include Cohere Rerank, local heuristics, or LLM summarizers.

## 23. Final design summary

```text
pi-prune-swe-pruner-provider
  is not MCP-first
  is not the global context.prune API owner
  is the SWE-Pruner provider/backend for generic context pruning

TypeScript side
  is Pi-aware
  reads local content
  saves artifacts
  calls remote backend
  renders model-facing output

Python server
  is generic HTTP
  receives documents + goal
  runs SWE-Pruner
  returns pruned text/spans/stats

pi-prune-router context.prune(...) service
  is the future first-class Pi context-pruning primitive
  saves raw content as artifact
  selects a provider such as pi-prune-swe-pruner-provider
  inserts only pruned output into context
  lets agents recover full content through normal read/grep tools
```
