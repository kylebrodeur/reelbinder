# ReelBinder

ReelBinder is a filmmaking workspace for moving from screenplay and production review through frames, takes, editing, rendering, and portable project archives.

This repository contains the public ReelBinder frontend. Hosted API services, deployment infrastructure, provider operations, and private film-production records are maintained separately and are not included.

## Try ReelBinder

Use the hosted product at [studio.reelbinder.app](https://studio.reelbinder.app).

Each visitor supplies their own supported provider connections at runtime. Do not place API keys or tokens in source, browser bundles, screenshots, archives, or shared logs.

## Run the frontend locally

Requirements:

- Node.js 22
- npm

    npm ci
    npm run typecheck
    npm test
    npm run build
    npm run dev

The interface is available at <http://localhost:8080>. The repository includes the thin same-origin frontend middleware used by production builds, but not the Cinema API service behind it. Provider-backed generation and rendering require a compatible service configured with CINEMA_BACKEND_URL.

## Project archives

ReelBinder exports portable .reelbinder.zip project archives and continues to accept legacy .slate.zip archives. Archive contents, internal filenames, schemas, IDs, and media remain compatible.

## License

ReelBinder software and original ReelBinder identity artwork are distributed under the MIT License. Third-party dependencies retain their own licenses and notices.

## Documentation

Public product documentation lives in [`docs-site/`](docs-site/) and is published at [docs.reelbinder.app](https://docs.reelbinder.app). The Slate interchange reference is available at [`docs/slate-format-contract.md`](docs/slate-format-contract.md).

## Planning study and rights

The source-only Project at [`public/demo/bounty-hunter-planning-study.slate.zip`](public/demo/bounty-hunter-planning-study.slate.zip) contains screenplay, planning, and reference material for evaluation and import use. It contains no generated takes or finished film.

Rights are retained by Kyle Brodeur; screenplay by Bradley Weatherholt. The archive and its contents are not covered by the software MIT License, and no additional redistribution or adaptation rights are granted. See [`CREDITS.md`](CREDITS.md).

## Publication scope

This is a curated public source release. Hosted service code, deployment infrastructure, private development history, production records, credentials, provider records, contact sheets, notes, and film media are not included.
