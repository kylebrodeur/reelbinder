# ReelBinder WebMCP — Agent Interaction Log

Purpose: record how an AI agent actually drives the ReelBinder app during the Bounty
Hunter production demo, so the WebMCP toolset can be improved. Every entry notes the
goal, what the agent had to do, and the gap it exposed. Newest entries at the bottom.

Sessions: 2026-09-21/22, agent `t-72d6`, working surface `studio.reelbinder.app`
(headless omp browser tab `live` + headed Chrome via CDP `kyle-review`).

## Gaps observed (summary — detail below)

| # | Gap | Workaround used |
|---|-----|-----------------|
| 1 | No tool to load/open a `.reelbinder.zip` project archive | Injected project JSON into `localStorage["slate-board-v13"]` via CDP, reloaded |
| 2 | No connection test ("Access untested" with no verify path) | Direct curl probes + a real failed image job (feature now being built: `POST /connections/{cid}/test`) |
| 3 | No tool for connection setup (provider/mode/project/token) | DOM-level form filling with React native-setter hacks |
| 4 | No tool for floor-camera edits (angle/fov/target) | Edited `project.snapshot.json` offline, re-injected |
| 5 | No tool for frame composition (sketch stamps: props/boxes; annotations: arrows/notes/continuity) | Offline JSON edit + re-inject |
| 6 | No tool to run image/storyboard generation | DOM click through Capture → review checkbox → Draft Storyboard |
| 7 | No tool for job status/polling | Raw `fetch('/api/cinema/jobs/{id}')` from page context |
| 8 | Generation gating UX: failures block the button until "Enable a new image" is clicked; error surfaced only as panel text | DOM scraping for error lines |
| 9 | `patch_shot` (notes only) exists — good — but cast, action, sketch, camera are not patchable | Offline JSON edit |
| 10 | View-cone math is aspect-corrected (160×90) and invisible to agents; gate errors only appear in panel text after failure | Reproduced gate math offline |

## Timeline

- Loaded the corrected planning-study project. The archive import path needs a native
  file chooser; automated browsers cannot serve it (CDP `Page.fileChooser` interception
  no longer fires in current Chromium). Injected the project into
  `localStorage["slate-board-v13"]` (zustand persist v13, `{state:{project,...}}`) and
  reloaded. **Gap 1.** A WebMCP `load_project_archive` (bytes → project) or an
  agent-safe `/import` endpoint would remove the riskiest hack in this workflow.
- Walked all 14 setups on Stage (filmstrip buttons `aria-label "Stage <setup>"`), read
  the Frame viewfinder + floor for each. Read-only; `get_shot`/`get_studio_state`
  WebMCP tools now cover part of this.
- Verified floor cameras against the script/production book. The app's view-cone gate
  uses `atan2(dy*90, dx*160)` (16:9 room), documented nowhere agent-visible; the gate
  message appears only in the Frame panel after a failure. **Gaps 8, 10.** Suggest:
  expose `stageReadiness(shotId)` as a WebMCP tool returning gate issues without
  needing a capture attempt.
- Edited floor cameras (1A angle/fov, 1M target, 1N fov) — **Gap 4**. A
  `patch_floor_camera(setup, {angle, fov, targetId})` would keep agents from editing
  raw snapshots.
- Composed frames: sketch stamps (`figure`/`box` + label) and annotations
  (`arrow`/`note`/`continuity` with points, label, color) — **Gap 5**. A
  `stamp_frame(shotId, {kind, x, y, label})` + `annotate_frame(shotId, {...})` pair
  (mirroring the People/Prop/Move/Hold/Change/Continuity toolbar) would make frames
  agent-authorable.
- Connection setup: the Connections dialog needed provider select → mode fields
  (express key vs standard token + project id) — **Gap 3**. An
  `connect({provider, mode, ...secret})` WebMCP tool that returns the session
  connection row (never the secret) would help.
- Connection auth: first real image job failed `PROVIDER_FAILED` because Express
  Cloud keys are rejected by this project's Vertex endpoint; only surfaced by burning
  an attempt. **Gap 2** — `testConnection` feature in progress (backend
  `backend-api-product-improvement` agent; auth-only probe, 400/404 ⇒ verified,
  401/403 ⇒ failed).
- Image generation flow: Capture current plan (free) → check "I compared this captured
  Frame plan with the source overhead…" → Draft Storyboard. All DOM-level — **Gap 6**.
  Suggest `capture_frame_plan(shotId)` and `draft_storyboard(shotId, {reviewed: true})`
  WebMCP tools, plus `get_job(jobId)` — **Gap 7** — returning `{status, error}` from
  the backend job row.
- `patch_shot` WebMCP tool (notes) worked as designed and is the right pattern to
  extend (action, characters, camera fields) — **Gap 9**. A
  `stamp_frame(shotId, {kind, x, y, label})` + `annotate_frame(shotId, {...})` pair
  (mirroring the People/Prop/Move/Hold/Change/Continuity toolbar) would make frames
  agent-authorable.
- Frame-composition iteration (pass 2-4 on 1A): the composition guide (paper render of
  stamps + annotations, checksummed) IS sent as the generation reference and
  converges — props/directions/continuity marks materially change the render. Known
  framing-tool issues found while directing it:
  1. **Box stamps (props) are not draggable** — figure stamps can be repositioned via
     the People tool, but Prop boxes ("coin flick", "tankard") cannot be selected or
     moved after placement; they must be erased and re-stamped. (Kyle hit this.)
  2. The Prop tool creates unlabeled boxes; labels require the Detail/pencil flow —
     so "a thing the camera must see" can't be named in-frame without extra steps.
  3. `capturePlanComposition` fingerprints the ENTIRE project
     (`JSON.stringify(snapshot)`): any unrelated project edit (a note elsewhere,
     autosave drift) invalidates the review checkbox and forces a recapture. A
     per-shot composition fingerprint would decouple this.
  4. No numeric position/size entry for stamps — hand-drag only; agents must compute
     positions from the aspect-corrected cone math themselves.
  5. Injecting project state while the app page is alive races the autosave flush —
     the old page overwrote the injected project on reload (fixed by inject +
     `location.reload()` in the same tick). An agent-safe project import tool removes
     the whole class of race (see Gap 1).
  6. The wardrobe/personality locks live in `characters[].look` and the prompt chain,
     but storyboard renders still drift (Rusty went sleeveless, Noodles de-aged)
     unless the wardrobe text is ALSO in the shot's Image direction field at request
     time. Consider a persistent "consistency block" the app auto-prepends to every
     image request from `characters[].look` + `world`.
  7. **Prop labels have no independent anchor** — the label is rendered below the prop box at a fixed offset. For a tankard held in Rusty's hand, the text can appear detached or in the wrong visual spot even when the box is near the hand. The label should support an explicit anchor/offset or render inside/adjacent to the selected prop.
  8. **Readiness gate reports a generic unlinked-frame error** — setup 1H was blocked because its blocking list still contained Noodles while the shot cast was only Rusty and The Bounty Hunter. The message did not identify the offending figure; inspecting the shot data was required.
  9. **Provider failure has no actionable detail** — setup 1Q returned `PROVIDER_FAILED` after a new storyboard submission, while neighboring standard-token jobs succeeded. The UI only exposed a generic failure and offered a new paid attempt, so the failed shot is held for review rather than retried automatically.
  10. **Storyboard model can add unwanted title text** — setup 1NN inserted “Crusty Rusty’s Tavern” into the image despite the project’s no-captions/no-subtitles direction. A visible negative-text constraint or post-generation review gate is needed.
  11. **Storyboard style is not deterministic** — the same “Draft Storyboard · Marker / Graphite” control produced marker/graphite frames for 1A/1E/1H/1K/1Q but photoreal-looking frames for 1EE/1F/1J/1N/1NN/1R/1U. The control label and model output can disagree; the contact sheet is required to catch this before motion generation.
  12. **Product route versus operator surface must be distinguished** — the successful storyboard jobs used the live Studio page and its own `/api/cinema/jobs` route, but setup selection, Capture, approval, and Draft clicks were driven by CDP/browser scripts. The project was also injected through `localStorage`, and job polling/assets were fetched from page context. This is not equivalent to a human-only Studio session.
  13. The repeatable draft route was: select setup → Capture current plan → check the overhead-review confirmation → Draft Storyboard · Marker / Graphite → wait for the saved request/result → restore the result → Enable a new image before another paid request.
  14. A first-class WebMCP workflow should expose those same product actions and return explicit evidence: captured-plan asset/hash, review state, connection ID/mode (without secrets), job ID/status/error, generated asset ID/hash, and whether the result was restored into Frame history.
15. 1Q correction was driven through the live headed Studio UI, not an MCP call: changed Move from Tracking / follow to Pan left; added Rusty to Characters on camera; removed stale Drunk Cameo and Sultry Woman from setup blocking; selected the interactive overhead figure nodes (ghost markers were non-interactive duplicates) and moved Rusty to the camera-side foreground position; cleared and re-authored Frame stamps. Setup planning notes were then edited after enabling a new image state. The authored correction is: Noodles screen-left behind the bar with the rail between camera and Noodles; Rusty large foreground OTS; Bounty Hunter reaches the back corner; static with a slight left pan. This exposed two agent-control gaps: no numeric blocking/stamp coordinates or reliable figure-id targeting, and no visible cast picker in BlockingStudio's frame pane. The latter is being fixed in the app so an agent/operator can place the intended cast member without moving an unrelated stamp.
16. The filmmaker then corrected 1Q directly in the headed Studio UI. The visible result places Rusty as the large foreground OTS at screen-right, Noodles on the left behind the bar, and the Bounty Hunter in the back corner. Page readback after the manual edit showed project `proj_goal1b_corrected_source_v2_20260908`, `pan-left`, cast `The Bounty Hunter`, `Noodles`, `Rusty`, revised setup notes, frame stamps for all three, and the UI `Saved` state. No provider request or Production Assistant preflight was run after this correction.
17. The app fix adds a visible `Frame cast` toolbar to `BlockingStudio` before the frame canvas in both Frame and Split panes. Each linked figure exposes `Place … in frame` or `Select … in frame`; the control reuses `pickCast`, so an unplaced cast member is explicitly selected before the next canvas click. The delegated app agent verified this route with Noodles and The Bounty Hunter and reported `npm run typecheck` passing. This is an app-surface fix, not a WebMCP/provider call.
18. Filmmaker correction to the tavern geography: the swinging doors are on the north wall. When looking toward the doors from inside as the Bounty Hunter enters, the bar must read on frame-left, not frame-right. The 1A contact-sheet frame therefore cannot be accepted as a geography pass; re-establish the canonical overhead/world orientation before reviewing or generating further frames.
19. Ordered storyboard continuity review (read-only): 1A is held for geography because its room reads with the bar on frame-right while looking toward the entrance; 1H is a hard fail for the same reason and also still carries stale “south entrance/east bar” direction. 1E, 1EE, 1F, 1J, 1K, 1N, 1NN, 1R and 1U are visually usable only conditionally: identity/wardrobe/props generally read, but their east/right or doorway/corner relationships must be re-derived from the corrected overhead before approval. 1Q remains filmmaker-corrected in the headed UI, but its saved snapshot still contains stale tracking/prompt text and must be synchronized before generation. 1L/1M remain non-generating punch-ins. No photoreal or motion generation is approved until the canonical overhead/world orientation is reconciled.
20. Independent script-supervisor review returned 0.95 confidence and `overall_correctness: incorrect`. Hard blocker: the floor plan and every geography-dependent direction still encode south entrance/east-right bar, while the filmmaker correction is north doors/frame-left bar. Required paired flips include 1E/1F/1K/1L/1N/1NN/1R screen sides and eyelines, 1F coin travel, 1N pour entry, 1H door label, and 1J/1Q movement/facing. The reviewer could not visually inspect additional frames because model quota was exhausted, so the existing storyboard candidates remain reference-only until the corrected overhead is authoritative. 1L/1M non-generating status is confirmed intentional; 1U cigar remains isolated to that shot.
21. Applied the continuity repair in the active project `proj_goal1b_corrected_source_v2_20260908`: rotated the canonical floor/cameras/homes/path to the corrected north-door/west-bar orientation; labeled the north swinging doors and west bar; retained the rotated source overhead with corrected provenance caption; updated the world law and shot direction blocks; synchronized 1Q to pan-left while preserving the filmmaker-authored three frame stamps; corrected stale frame labels (north doors, northeast cameo table, left-side Rusty pour); invalidated the 12 old generating frame URLs while retaining their histories. No provider or paid generation was started.
22. User-facing frame composition repair: `FrameStudio` and `BlockingStudio` now expose a visible, keyboard-accessible `Frame items` list with per-item `Remove <label> from frame` controls and `Clear frame items`. These actions only update `shot.sketch.stamps` through the existing `setSketch` store route, preserving cast blocking, strokes and annotations. The local browser verification removed `coin flick`, confirmed persisted stamp removal after the save debounce, and confirmed the Rusty cast stamp remained.
23. WebMCP coordination update: `webmcp-backend` reports the smallest semantic frame API on the existing store: `patch_frame` place/remove for cast, prop, and architecture, with separated created/placed/updated/removed readback plus `get_frame_state`; 11 WebMCP tests, typecheck and backend UI-tool tests pass. This remains limited to frame composition and does not start generation.