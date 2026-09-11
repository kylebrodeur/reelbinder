#!/usr/bin/env node
/**
 * gen-changelog-docs — regenerate docs-site/content/docs/changelog.mdx from the
 * canonical root CHANGELOG.md. Deterministic: same input, same output bytes.
 *
 * Run automatically by docs-site's `check` and `build` scripts; run manually with
 *   node scripts/gen-changelog-docs.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(`${repoRoot}/CHANGELOG.md`, "utf8");

// MDX treats { } as JSX expressions — escape them so prose stays prose.
const escapeMdx = (text) => text.replace(/([{}])/g, "\\$1");

// Strip the leading `# Changelog` H1 (the page supplies its own title) and the
// canonical-source note (the page states it inline). Keep everything else verbatim.
const body = source
  .replace(/^#\s+Changelog\s*\n/, "")
  .replace(
    /\n`CHANGELOG\.md` at the repository root is the canonical source[\s\S]*?never the generated page\.\n/,
    "\n",
  )
  .trimStart();

const page = `---
title: Changelog
description: Release notes for ReelBinder — every public deploy of the app and docs.
---

This page is generated from the repository's canonical \`CHANGELOG.md\`
([view source](https://github.com/kylebrodeur/reelbinder/blob/main/CHANGELOG.md)).
Each section corresponds to a public deploy of the app or docs.

${escapeMdx(body)}
`;

const out = `${repoRoot}/docs-site/content/docs/changelog.mdx`;
writeFileSync(out, page);
console.log(`changelog docs page regenerated: ${out}`);