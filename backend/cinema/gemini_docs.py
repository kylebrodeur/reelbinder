"""Bounded, read-only client for Google's official Gemini Docs MCP server."""

import asyncio
import datetime
import hashlib
import json
import pathlib
from urllib.parse import quote

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

_ENDPOINT = "https://gemini-api-docs-mcp.dev"
_DOCS_ROOT = "https://ai.google.dev/gemini-api/docs"
_CACHE: dict[str, tuple[dict, float]] = {}
_CIRCUIT_BREAKER_FAILURES = 0
_CIRCUIT_BREAKER_TRIPPED_UNTIL = 0.0
_TECHNICAL_TERMS = (
    "adk",
    "api",
    "function calling",
    "gemini",
    "google gen ai",
    "imagen",
    "lyria",
    "model",
    "sdk",
    "vertex",
    "veo",
)


def _guide_url(filepath: str, source: str) -> str:
    if source != "gemini-api-guides" or not filepath.startswith("gemini-api-guides/"):
        return _DOCS_ROOT
    path = filepath.removeprefix("gemini-api-guides/").removesuffix(".md")
    if path.startswith("generate-content/"):
        path = path.removeprefix("generate-content/")
    return f"{_DOCS_ROOT}/{quote(path, safe='/-')}"


async def _mcp_search(query: str) -> list[dict]:
    async with asyncio.timeout(8.0):
        async with streamablehttp_client(_ENDPOINT) as (read, write, _):
            async with ClientSession(read, write) as session:
                await session.initialize()
                result = await session.call_tool(
                    "gemini_search_docs",
                    {"query": query, "limit": 5},
                )
    if result.isError:
        raise RuntimeError("Gemini Docs MCP rejected the search")
    texts = [getattr(block, "text", "") for block in result.content]
    if sum(len(text) for text in texts) > 50_000:
        raise ValueError("Gemini Docs MCP response exceeds 50 KB")
    for text in texts:
        if not text:
            continue
        parsed = json.loads(text)
        if isinstance(parsed, dict) and isinstance(parsed.get("hits"), list):
            return parsed["hits"]
    raise ValueError("Gemini Docs MCP returned no searchable result set")


async def search_gemini_documentation(query: str) -> dict:
    """Search current official Gemini documentation without forwarding project data or credentials."""
    global _CIRCUIT_BREAKER_FAILURES, _CIRCUIT_BREAKER_TRIPPED_UNTIL

    normalized = " ".join(query.split())
    if not normalized or len(normalized) > 400:
        return {"error": "Use one technical query of 1-400 characters.", "results": []}
    lowered = normalized.lower()
    if not any(term in lowered for term in _TECHNICAL_TERMS):
        return {
            "error": "Gemini Docs searches must name a Gemini, Vertex, model, API, SDK, or ADK topic.",
            "results": [],
        }

    now = datetime.datetime.now(datetime.timezone.utc).timestamp()
    if now < _CIRCUIT_BREAKER_TRIPPED_UNTIL:
        return _fallback_result(
            normalized,
            "Gemini Docs MCP is temporarily unavailable; using the local model map.",
        )

    cache_key = hashlib.sha256(normalized.lower().encode()).hexdigest()
    cached = _CACHE.get(cache_key)
    if cached and now - cached[1] < 300:
        return cached[0]

    retrieved_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
    try:
        hits = await _mcp_search(normalized)
        results = []
        for hit in hits[:5]:
            if not isinstance(hit, dict):
                continue
            metadata = hit.get("metadata") if isinstance(hit.get("metadata"), dict) else {}
            filepath = hit.get("filepath") if isinstance(hit.get("filepath"), str) else ""
            source = metadata.get("source") if isinstance(metadata.get("source"), str) else ""
            title = hit.get("heading") if isinstance(hit.get("heading"), str) else "Official Gemini Docs"
            snippet = hit.get("snippet") if isinstance(hit.get("snippet"), str) else ""
            chunk_id = hit.get("chunk_id") if isinstance(hit.get("chunk_id"), str) else ""
            results.append(
                {
                    "title": title[:200],
                    "url": _guide_url(filepath, source),
                    "excerpts": [snippet[:1000]] if snippet else [],
                    "chunkId": chunk_id[:500],
                    "retrievedAt": retrieved_at,
                    "source": "official-gemini-docs",
                }
            )
        response = {"query": normalized, "results": results, "fallback": False}
        _CACHE[cache_key] = (response, now)
        _CIRCUIT_BREAKER_FAILURES = 0
        return response
    except Exception:
        _CIRCUIT_BREAKER_FAILURES += 1
        if _CIRCUIT_BREAKER_FAILURES >= 3:
            _CIRCUIT_BREAKER_TRIPPED_UNTIL = now + 60
        return _fallback_result(
            normalized,
            "Gemini Docs MCP is unavailable or exceeded bounds; using the local model map.",
        )


def _fallback_result(query: str, warning: str) -> dict:
    retrieved_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
    results = []
    try:
        model_map = pathlib.Path(__file__).parent.parent.parent / "docs" / "google-model-map.md"
        content = model_map.read_text(encoding="utf-8")
        results.append(
            {
                "title": "Slate Google model map (offline fallback)",
                "url": _DOCS_ROOT,
                "excerpts": [content[:1000]],
                "retrievedAt": retrieved_at,
                "source": "local-fallback-model-map",
            }
        )
    except Exception:
        pass
    return {
        "query": query,
        "results": results,
        "fallback": True,
        "warning": warning,
    }
