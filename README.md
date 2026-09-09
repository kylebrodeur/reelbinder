# ReelBinder

ReelBinder is a filmmaking workspace for moving from screenplay and production review through frames, takes, editing, rendering, and portable project archives.

The application uses React, TanStack Start, TypeScript, Zustand, and a Python FastAPI service. Optional visitor-supplied connections support Google models and Parallel research. The repository does not include provider credentials, private productions, or licensed film assets.

## Run locally

Requirements:

- Node.js 22
- Python 3.12
- `uv`
- FFmpeg and FFprobe for rendering

```sh
npm ci
npm run typecheck
npm test
npm run build

cd backend
uv sync --frozen
uv run uvicorn cinema.app:create_app --factory --host 127.0.0.1 --port 8090
```

In another terminal:

```sh
CINEMA_BACKEND_URL=http://127.0.0.1:8090 npm run dev
```

Provider connections are entered by each visitor at runtime. Do not place API keys or tokens in source, browser bundles, screenshots, archives, or shared logs.

## Project formats

ReelBinder preserves stable Slate-format identifiers for screenplay, lining, project snapshots, media provenance, and portable `.slate.zip` archives.

## Publication status

This is a sanitized release candidate. Distribution remains pending an approved license and final credits.
