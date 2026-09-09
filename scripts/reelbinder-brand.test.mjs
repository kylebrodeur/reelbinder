import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function filesUnder(relativeDirectory, extensions) {
  const found = [];
  const visit = (absoluteDirectory) => {
    for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
      const absolute = join(absoluteDirectory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (extensions.some((extension) => entry.name.endsWith(extension))) found.push(absolute);
    }
  };
  visit(join(ROOT, relativeDirectory));
  return found;
}

function pngSize(path) {
  const bytes = readFileSync(join(ROOT, path));
  assert.deepEqual(
    [...bytes.subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
    `${path} is a PNG`,
  );
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

test("approved ReelBinder public art is present at its intended dimensions", () => {
  assert.deepEqual(pngSize("public/favicon-16.png"), [16, 16]);
  assert.deepEqual(pngSize("public/favicon-32.png"), [32, 32]);
  assert.deepEqual(pngSize("public/apple-touch-icon.png"), [180, 180]);
  assert.deepEqual(pngSize("public/app-icons/reelbinder-192.png"), [192, 192]);
  assert.deepEqual(pngSize("public/app-icons/reelbinder-512.png"), [512, 512]);
  assert.deepEqual(pngSize("public/app-icons/reelbinder-maskable-192.png"), [192, 192]);
  assert.deepEqual(pngSize("public/app-icons/reelbinder-maskable-512.png"), [512, 512]);
  assert.deepEqual(pngSize("public/og.png"), [1200, 630]);

  const mark = readFileSync(join(ROOT, "public/brand/reelbinder-mark.svg"), "utf8");
  assert.equal((mark.match(/<circle /g) ?? []).length, 3, "mark retains three binder punches");
  assert.match(mark, /height="168" fill="#0D0E11"/);
  assert.match(mark, /transform="translate\(55\.2 54\.4\) scale\(0\.8\)"/);
  assert.match(mark, /y="206" width="92" height="48"/);
  assert.match(mark, /y="290" width="92" height="48"/);
  assert.match(mark, /M210 188h10v5h-10z/);
  assert.match(mark, /M210 267h10v10h-10z/);
  assert.match(mark, /M210 351h10v5h-10z/);
});

test("ReelBinder owns the document metadata and static web app manifest", () => {
  const rootRoute = readFileSync(join(ROOT, "src/routes/__root.tsx"), "utf8");
  assert.match(rootRoute, /APP_NAME = "ReelBinder"/);
  assert.match(rootRoute, /APP_DESCRIPTION = "Plan a film from screenplay to cut\."/);
  assert.match(rootRoute, /APP_URL = "https:\/\/reelbinder\.app\/"/);
  assert.match(rootRoute, /rel: "canonical", href: APP_URL/);
  assert.match(rootRoute, /rel: "manifest", href: "\/manifest\.webmanifest"/);
  assert.match(rootRoute, /rel: "apple-touch-icon"/);
  assert.match(rootRoute, /property: "og:type", content: "website"/);
  assert.match(rootRoute, /property: "og:site_name", content: APP_NAME/);
  assert.match(rootRoute, /property: "og:title", content: APP_NAME/);
  assert.match(rootRoute, /property: "og:description", content: APP_DESCRIPTION/);
  assert.match(rootRoute, /property: "og:url", content: APP_URL/);
  assert.match(rootRoute, /property: "og:image", content: APP_IMAGE/);
  assert.match(rootRoute, /property: "og:image:secure_url", content: APP_IMAGE/);
  assert.match(rootRoute, /property: "og:image:width", content: "1200"/);
  assert.match(rootRoute, /property: "og:image:height", content: "630"/);
  assert.match(rootRoute, /property: "og:image:type", content: "image\/png"/);
  assert.match(rootRoute, /property: "og:image:alt", content: APP_IMAGE_ALT/);
  assert.match(rootRoute, /name: "twitter:card", content: "summary_large_image"/);
  assert.match(rootRoute, /name: "twitter:title", content: APP_NAME/);
  assert.match(rootRoute, /name: "twitter:description", content: APP_DESCRIPTION/);
  assert.match(rootRoute, /name: "twitter:image", content: APP_IMAGE/);
  assert.match(rootRoute, /name: "twitter:image:alt", content: APP_IMAGE_ALT/);
  assert.doesNotMatch(rootRoute, /AuthProvider/);
  assert.equal(existsSync(join(ROOT, "src/lib/auth/provider.tsx")), false);

  const manifest = JSON.parse(
    readFileSync(join(ROOT, "public/manifest.webmanifest"), "utf8"),
  );
  assert.deepEqual(
    {
      id: manifest.id,
      name: manifest.name,
      shortName: manifest.short_name,
      startUrl: manifest.start_url,
      scope: manifest.scope,
      display: manifest.display,
      description: manifest.description,
      backgroundColor: manifest.background_color,
      themeColor: manifest.theme_color,
      categories: manifest.categories,
    },
    {
      id: "/",
      name: "ReelBinder",
      shortName: "ReelBinder",
      startUrl: "/",
      scope: "/",
      display: "standalone",
      description: "Plan a film from screenplay to cut.",
      backgroundColor: "#0D0E11",
      themeColor: "#0D0E11",
      categories: ["photo", "video", "productivity"],
    },
  );
  assert.deepEqual(manifest.icons, [
    {
      src: "/app-icons/reelbinder-192.png",
      sizes: "192x192",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "/app-icons/reelbinder-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "/app-icons/reelbinder-maskable-192.png",
      sizes: "192x192",
      type: "image/png",
      purpose: "maskable",
    },
    {
      src: "/app-icons/reelbinder-maskable-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
  ]);
  for (const { src } of manifest.icons) {
    assert.equal(existsSync(join(ROOT, "public", src.slice(1))), true, `${src} exists`);
  }
  assert.equal(
    existsSync(join(ROOT, "src/lib/og/site.json")),
    false,
    "document metadata has one active source",
  );
});

test("ReelBinder theme tokens preserve screenplay paper and compatibility identifiers", () => {
  const styles = readFileSync(join(ROOT, "src/styles.css"), "utf8");
  assert.match(styles, /--color-background: #0d0e11/);
  assert.match(styles, /--color-steel: #5a9e80/);
  assert.match(styles, /--color-ring: #5a9e80/);
  assert.match(styles, /--color-muted-foreground: #a9afba/);
  assert.match(styles, /--color-script: #f3efe6/);
  assert.match(styles, /--font-display: "IBM Plex Sans"/);
  assert.doesNotMatch(styles, /Instrument Serif/);

  const themes = readFileSync(join(ROOT, "src/lib/ui-theme.ts"), "utf8");
  for (const id of ["cinema-slate", "dark-cinema", "directors-slate", "oled", "slate_ui_theme"]) {
    assert.match(themes, new RegExp(id));
  }
  for (const badge of ["Default", "Deep black", "Graphite"]) {
    assert.match(themes, new RegExp(`badge: "${badge}"`));
  }
  assert.doesNotMatch(themes, /1 & 2 Hybrid|Option 1|Option 2/);
});

test("the install surface stays online-only", () => {
  const applicationFiles = [
    ...filesUnder("src", [".ts", ".tsx", ".js", ".mjs"]),
    ...filesUnder("server", [".ts", ".tsx", ".js", ".mjs"]),
    join(ROOT, "vite.config.ts"),
  ];
  const applicationSource = applicationFiles
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
  assert.doesNotMatch(applicationSource, /serviceWorker\s*(?:\?\.|\.)\s*register\s*\(/);
  assert.doesNotMatch(applicationSource, /beforeinstallprompt/);
  assert.equal(existsSync(join(ROOT, "public/sw.js")), false);
  assert.equal(existsSync(join(ROOT, "public/service-worker.js")), false);
  const publicWorkerSource = filesUnder("public", [".js", ".mjs"])
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
  assert.doesNotMatch(publicWorkerSource, /addEventListener\s*\(\s*["']fetch["']/);
});

test("public archive copy uses ReelBinder while stable Slate format identifiers remain intact", () => {
  const filmEntry = readFileSync(join(ROOT, "src/components/app/film-entry-dialog.tsx"), "utf8");
  const app = readFileSync(join(ROOT, "src/components/app/slate-app.tsx"), "utf8");
  const demo = readFileSync(join(ROOT, "src/lib/demo-pack.ts"), "utf8");
  const archive = readFileSync(join(ROOT, "src/lib/slate-pack.ts"), "utf8");
  assert.match(filmEntry, /plain text, \.slate\.md, or a ReelBinder project archive \(\.reelbinder\.zip or \.slate\.zip\)/);
  assert.match(app, /Could not create the ReelBinder project archive\./);
  assert.match(demo, /import your own ReelBinder project archive/);
  assert.doesNotMatch(`${filmEntry}\n${app}\n${demo}\n${archive}`, /Slate Markdown|Could not pack this script|own pack|pack was opening|Invalid Slate|This pack/);
  assert.match(archive, /format: "slate"/);
  assert.match(archive, /script\.slate\.md/);
});

test("the build keeps the same-origin Cinema gateway", () => {
  const config = readFileSync(join(ROOT, "vite.config.ts"), "utf8");
  assert.match(config, /proxy: \{ "\/api\/cinema":/);
  assert.match(config, /serverDir: "\.\/server"/);
  assert.equal(existsSync(join(ROOT, "server/middleware/cinema.ts")), true);
});
