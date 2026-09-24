import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceDir = join(repoRoot, "node_modules", "@mcp-b", "webmcp-local-relay", "dist", "browser");
const destDir = join(repoRoot, "public", "webmcp");
const files = ["embed.js", "widget.html"];

const pkgJson = JSON.parse(readFileSync(join(repoRoot, "node_modules", "@mcp-b", "webmcp-local-relay", "package.json"), "utf8"));

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

mkdirSync(destDir, { recursive: true });

const provenance = {
  package: pkgJson.name,
  version: pkgJson.version,
  sourceDir,
  files: {},
  note: "Vendored from the installed @mcp-b/webmcp-local-relay package to avoid a third-party CDN dependency. Copied by scripts/vendor-webmcp-relay.mjs.",
};

for (const name of files) {
  const src = join(sourceDir, name);
  const dst = join(destDir, name);
  const sourceHash = sha256(src);

  if (existsSync(dst)) {
    const destHash = sha256(dst);
    if (destHash !== sourceHash) {
      throw new Error(
        `Destination ${dst} exists with a different hash (${destHash}) than source ${src} (${sourceHash}). Refusing to overwrite mismatched vendored file; delete it manually if you want to refresh.`,
      );
    }
    console.log(`Skipping ${name}: already up to date.`);
  } else {
    writeFileSync(dst, readFileSync(src));
    console.log(`Copied ${name} -> public/webmcp/${name}`);
  }

  provenance.files[name] = { source: src, sha256: sourceHash };
}

writeFileSync(join(destDir, "PROVENANCE.json"), JSON.stringify(provenance, null, 2));
console.log("Wrote public/webmcp/PROVENANCE.json");
