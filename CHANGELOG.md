# Changelog

All notable changes to ReelBinder are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); each section
corresponds to a public deploy of the app or docs.

`CHANGELOG.md` at the repository root is the canonical source. The
[docs-site changelog page](https://reelbinder.app/changelog) is generated from
it by `scripts/gen-changelog-docs.mjs` — edit this file, never the generated page.

## [2026-09-24] Quota remediation: retained job history no longer blocks submissions

### Changed
- The hosted Studio release `20260924-957017c` removes the retained-job-row
  admission check. Terminal job records remain visible for recovery and audit,
  but only the pending queue limit (2 per session / 8 global) and real
  storage, asset, and disk headroom can block a new submission.
- The Cinema service exposes a read-only, session-scoped
  `/api/cinema/jobs/usage` endpoint. The Connections panel shows the pending
  queue count and terminal history by kind, with an explicit **Check job usage**
  control. The endpoint does not delete, reset, or retry jobs.
- Submission error surfaces now include the actual Cinema error code
  (for example `QUEUE_FULL`, `STORAGE_LIMIT`) so a blocked request is
  reported accurately instead of as a generic failure.

### Fixed
- Stage clamping and connection probes repaired so agent navigation and
  provider access checks stay bounded and safe.
- Frame item cleanup and shot-timeline sync guarded against unsafe mutations
  while preserving non-picture tracks and clip metadata.

### Notes
- Hosted verification used bounded checks and did not admit a paid provider job.
- No automatic retry, cleanup, archive, purge, or data deletion was added.


## [2026-09-11] Docs and demo refresh

### Changed
- Docs and product copy use ReelBinder-first naming throughout.
- The demo pack ships as `bounty-hunter-planning-study.reelbinder.zip`, and
  docs reference the portable Project archive consistently.

### Fixed
- Error boundaries render non-`Error` throws safely (display the value
  instead of crashing).

### Added
- Pinned Node 22 in `.nvmrc` for reproducible builds.

## [2026-09-10] Guided onboarding and visitor auth

### Added
- Guided cinema onboarding: connection setup now walks a visitor through
  provider connection from end to end.
- Safe portable import: importing `.reelbinder.zip` Projects validates
  contents and fails closed on malformed archives.
- Refreshable visitor auth: visitor provider connections refresh access
  tokens server-side (offline access + refresh grants), with connection
  state surfaced in the UI.
- Test coverage for cinema connections and portable import
  (`scripts/cinema-connections.test.mjs`, `scripts/portable-import.test.mjs`).

## [2026-09-09] Initial public release

### Added
- ReelBinder frontend: screenplay, coverage, staging, editing and render
  review in one Project workspace.
- Public documentation site with workflow, project-format, architecture and
  deployment guides.
- Approved planning study and credits for the public presentation project.
- Downloadable presentation project and film, plus starter planning project
  download links.
- Optional public walkthrough seams for guided product tours.
- Deployment operator templates for Google Cloud VM and Cloudflare Pages.

### Changed
- Clarified provider research setup documentation.
- Pinned dependency lock for reproducible docs builds.