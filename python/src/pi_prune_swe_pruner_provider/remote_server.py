from __future__ import annotations

import gc
import os
import threading
import time
from contextlib import nullcontext
from typing import Any

import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from swe_pruner.prune_wrapper import PruneRequest as SwePruneRequest
from swe_pruner.prune_wrapper import SwePrunerForCodePruning

MODEL_PATH = os.environ.get("SWE_PRUNER_MODEL_PATH", "/workspace/models/code-pruner")
DEFAULT_THRESHOLD = float(os.environ.get("SWE_PRUNER_THRESHOLD", "0.5"))
MODEL_DTYPE_NAME = os.environ.get("SWE_PRUNER_DTYPE", "float16")
MODEL_DTYPE = getattr(torch, MODEL_DTYPE_NAME)
MAX_DOCUMENTS = int(os.environ.get("SWE_PRUNER_MAX_DOCUMENTS", "50"))
MAX_DOCUMENT_CHARS = int(os.environ.get("SWE_PRUNER_MAX_DOCUMENT_CHARS", "500000"))
MAX_TOTAL_CHARS = int(os.environ.get("SWE_PRUNER_MAX_TOTAL_CHARS", "1000000"))

app = FastAPI(title="pi-prune-swe-pruner-provider", version="0.1.0")
_model = None
_model_lock = threading.Lock()
_prune_lock = threading.Lock()
_loaded_at: float | None = None


class PruneDocument(BaseModel):
    id: str | None = None
    source: str | None = None
    text: str
    hints: dict[str, Any] | None = None
    metadata: dict[str, Any] | None = None


class PruneOptions(BaseModel):
    threshold: float = DEFAULT_THRESHOLD
    lineNumbers: bool = True
    chunkOverlapTokens: int = 50
    maxOutputDocuments: int | None = None
    includeScores: bool = True
    includeSpans: bool = True
    timeoutMs: int | None = None


class RouterPruneRequest(BaseModel):
    goal: str
    documents: list[PruneDocument] = Field(min_length=1)
    preserve: list[str] | None = None
    budget: dict[str, Any] | None = None
    metadata: dict[str, Any] | None = None
    options: PruneOptions = Field(default_factory=PruneOptions)


def get_model():
    global _model, _loaded_at
    with _model_lock:
        if _model is None:
            t0 = time.time()
            _model = SwePrunerForCodePruning.from_pretrained(MODEL_PATH, torch_dtype=MODEL_DTYPE)
            _model.eval()
            _disable_generation_cache(_model)
            _loaded_at = time.time() - t0
        return _model


@app.get("/health")
def health() -> dict[str, Any]:
    gpu = None
    if torch.cuda.is_available():
        gpu = {
            "name": torch.cuda.get_device_name(0),
            "allocated_bytes": torch.cuda.memory_allocated(0),
            "reserved_bytes": torch.cuda.memory_reserved(0),
        }
    return {
        "ok": True,
        "model_path": MODEL_PATH,
        "model_dtype": MODEL_DTYPE_NAME,
        "model_loaded": _model is not None,
        "model_load_sec": _loaded_at,
        "cuda_available": torch.cuda.is_available(),
        "gpu": gpu,
        "limits": {
            "max_documents": MAX_DOCUMENTS,
            "max_document_chars": MAX_DOCUMENT_CHARS,
            "max_total_chars": MAX_TOTAL_CHARS,
        },
    }


@app.post("/prune")
def prune(request: RouterPruneRequest) -> dict[str, Any]:
    _validate_request_size(request)
    t0 = time.time()
    with _prune_lock:
        try:
            results = [_prune_document(request, document) for document in request.documents]
        except torch.cuda.OutOfMemoryError as error:
            _cleanup_cuda()
            raise HTTPException(status_code=507, detail=f"SWE-Pruner CUDA out of memory: {error}") from error
        finally:
            _cleanup_cuda()
    results.sort(key=lambda item: item.get("score") or 0.0, reverse=True)
    if request.options.maxOutputDocuments:
        results = results[: request.options.maxOutputDocuments]

    text = "\n\n---\n\n".join(_format_document_result(result) for result in results)
    input_tokens = sum((item.get("stats") or {}).get("inputTokens") or 0 for item in results)
    output_tokens = sum((item.get("stats") or {}).get("outputTokens") or 0 for item in results)
    return {
        "ok": True,
        "text": text,
        "documents": results,
        "stats": {
            "inputTokens": input_tokens,
            "outputTokens": output_tokens,
            "compressionRatio": (output_tokens / input_tokens) if input_tokens else None,
            "latencyMs": round((time.time() - t0) * 1000),
            "backend": "swe-pruner",
            "model": MODEL_PATH,
            "provider": "swe-pruner",
        },
        "provider": "swe-pruner",
    }


def _validate_request_size(request: RouterPruneRequest) -> None:
    if len(request.documents) > MAX_DOCUMENTS:
        raise HTTPException(status_code=413, detail=f"Too many documents: {len(request.documents)} > {MAX_DOCUMENTS}")
    total_chars = 0
    for document in request.documents:
        char_count = len(document.text)
        source = document.source or document.id or "input"
        if char_count > MAX_DOCUMENT_CHARS:
            raise HTTPException(status_code=413, detail=f"Document too large: {source} has {char_count} chars > {MAX_DOCUMENT_CHARS}")
        total_chars += char_count
    if total_chars > MAX_TOTAL_CHARS:
        raise HTTPException(status_code=413, detail=f"Request too large: {total_chars} chars > {MAX_TOTAL_CHARS}")


def _disable_generation_cache(model: Any) -> None:
    for candidate in (model, getattr(model, "model", None), getattr(getattr(model, "model", None), "backbone", None)):
        config = getattr(candidate, "config", None)
        if config is not None and hasattr(config, "use_cache"):
            config.use_cache = False


def _cleanup_cuda() -> None:
    gc.collect()
    if torch.cuda.is_available() and os.environ.get("SWE_PRUNER_EMPTY_CACHE", "1") != "0":
        torch.cuda.empty_cache()
        if hasattr(torch.cuda, "ipc_collect"):
            torch.cuda.ipc_collect()


def _prune_document(request: RouterPruneRequest, document: PruneDocument) -> dict[str, Any]:
    model = get_model()
    query = _build_query(request)
    req = SwePruneRequest(
        query=query,
        code=document.text,
        threshold=request.options.threshold,
        always_keep_first_frags=False,
        chunk_overlap_tokens=request.options.chunkOverlapTokens,
    )
    t0 = time.time()
    autocast = torch.autocast("cuda", dtype=MODEL_DTYPE) if torch.cuda.is_available() else nullcontext()
    with torch.inference_mode(), autocast:
        resp = model.prune(req)
    kept_lines = list(resp.kept_frags)
    result = {
        "id": document.id,
        "source": document.source or document.id,
        "text": _exact_pruned_code(document.text, kept_lines, request.options.lineNumbers),
        "score": float(resp.score) if request.options.includeScores else None,
        "spans": _line_spans(kept_lines, float(resp.score)) if request.options.includeSpans else None,
        "stats": {
            "inputTokens": int(resp.origin_token_cnt),
            "outputTokens": int(resp.left_token_cnt),
            "compressionRatio": (float(resp.left_token_cnt) / float(resp.origin_token_cnt)) if resp.origin_token_cnt else None,
            "latencyMs": round((time.time() - t0) * 1000),
        },
    }
    del req, resp
    _cleanup_cuda()
    return result


def _build_query(request: RouterPruneRequest) -> str:
    parts = [request.goal]
    if request.preserve:
        parts.append("Preserve: " + "; ".join(request.preserve))
    if request.budget:
        parts.append("Budget: " + ", ".join(f"{key}={value}" for key, value in request.budget.items()))
    return "\n".join(parts)


def _format_document_result(result: dict[str, Any]) -> str:
    source = result.get("source") or result.get("id") or "input"
    score = result.get("score")
    stats = result.get("stats") or {}
    metadata = []
    if isinstance(score, int | float):
        metadata.append(f"score: {score:.4f}")
    if stats.get("inputTokens") is not None and stats.get("outputTokens") is not None:
        metadata.append(f"tokens: {stats['inputTokens']} -> {stats['outputTokens']}")
    if isinstance(stats.get("compressionRatio"), int | float):
        metadata.append(f"ratio: {stats['compressionRatio']:.2f}")
    lines = [f"# {source}"]
    if metadata:
        lines.append(" | ".join(metadata))
    lines.extend(["", result.get("text") or ""])
    return "\n".join(lines).rstrip()


def _exact_pruned_code(code: str, kept_lines: list[int], include_line_numbers: bool) -> str:
    lines = code.splitlines()
    kept = {line for line in kept_lines if 1 <= line <= len(lines)}
    out: list[str] = []
    filtered = 0

    def flush_filtered() -> None:
        nonlocal filtered
        if filtered:
            out.append(f"(filtered {filtered} lines)")
            filtered = 0

    for line_no, line in enumerate(lines, start=1):
        if line_no in kept:
            flush_filtered()
            out.append(f"{line_no:>5} | {line}" if include_line_numbers else line)
        else:
            filtered += 1
    flush_filtered()
    return "\n".join(out)


def _line_spans(kept_lines: list[int], score: float) -> list[dict[str, Any]]:
    if not kept_lines:
        return []
    spans: list[dict[str, Any]] = []
    sorted_lines = sorted(set(kept_lines))
    start = prev = sorted_lines[0]
    for line in sorted_lines[1:]:
        if line == prev + 1:
            prev = line
            continue
        spans.append({"startLine": start, "endLine": prev, "score": score})
        start = prev = line
    spans.append({"startLine": start, "endLine": prev, "score": score})
    return spans
