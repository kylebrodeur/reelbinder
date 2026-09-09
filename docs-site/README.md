# ReelBinder Docs

Public ReelBinder documentation site using [Shiso](https://github.com/umami-software/shiso).

Write product pages in `content/docs/` and organize the sidebar in `docs.json`.
The standard Shiso UI provides local search, page outlines, Markdown actions, and
system-aware light/dark themes.

## Install and validate

Use Node.js 22 and pnpm 12.3.4, matching the GitHub Pages workflow.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
```

Dependencies are pinned in `package.json`; `pnpm-lock.yaml` records the exact
resolved dependency tree. The scaffold came from `create-shiso-app@0.5.0` with
`--disable-git`. No Git repository was initialized for this folder.

## Preview locally

```sh
pnpm preview
```

Open <http://127.0.0.1:8767> for a local preview. The preview uses Python 3’s standard static server,
binds only to the loopback interface, and serves only `dist/client/`. Directory
routes redirect to a trailing slash so each direct link receives its prerendered
page. No Python packages are needed.

For live content editing, stop the preview before running `pnpm dev`, which uses
the same local port. Rebuild with `pnpm build` when content changes should appear
in the static preview.

The running preview's log and process record are in `.local-preview/`.
The published site is <https://docs.reelbinder.app>.
