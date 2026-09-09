/** Build-only sibling config: retain root config, plugins and middleware. */
import { readFile, writeFile, unlink, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const source = await readFile('vite.config.ts', 'utf8');
const needle = 'preset: "vercel"';
if (source.split(needle).length !== 2) {
  throw new Error('Expected exactly one Vercel preset. Review deployment config against current source.');
}
const config = 'vite.deploy.config.ts';
let created = false;
try {
  await writeFile(config, source.replace(needle, 'preset: "node-server"'), { flag: 'wx' });
  created = true;
  const env = { ...process.env };
  // Never inherit a developer database connection into the build.
  delete env.DATABASE_URL;
  const result = spawnSync('./node_modules/.bin/vite', ['build', '--config', config], { stdio: 'inherit', env });
  if (result.error || result.status !== 0) throw result.error || new Error(`Frontend build exited ${result.status}`);
  await access('.output/server/index.mjs');
} finally {
  // This helper must run in the isolated image/build copy, never a live checkout.
  if (created) await unlink(config).catch(() => {});
}
