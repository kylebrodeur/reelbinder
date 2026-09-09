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

## License and planning study

ReelBinder software and original ReelBinder identity artwork are distributed under the MIT License. Third-party dependencies retain their own licenses and notices.

The source-only Project at `public/demo/bounty-hunter-planning-study.slate.zip` contains screenplay, planning and reference material for evaluation and import use. It contains no generated takes or finished film. Rights are retained by Kyle Brodeur; screenplay by Bradley Weatherholt. The archive and its contents are not covered by the software MIT License, and no additional redistribution or adaptation rights are granted.

## Publication status

This public repository is the curated ReelBinder source release. Private development history, production records, credentials, provider records, contact sheets, notes, and film media are not included.
