// Builds the extension into dist/, the folder you load unpacked in Aside (or any
// Chromium browser).
//
//   node build.mjs            build once
//   node build.mjs --watch    rebuild on change
//   node build.mjs --test     a build for the end-to-end tests, in .test-build/,
//                             whose background script can open Spine on any tab
//                             without a click. Never load it in your browser.
//   node build.mjs --release  also zips dist/ for the Chrome Web Store, into
//                             releases/spine-<version>.zip, without the
//                             development key (the store gives Spine its own id)
import * as esbuild from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const watch = process.argv.includes('--watch');
const test = process.argv.includes('--test');
const release = process.argv.includes('--release');
const out = test ? '.test-build' : 'dist';

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp('static', out, { recursive: true });

const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
if (test) manifest.host_permissions = [...manifest.host_permissions, '<all_urls>'];
await writeFile(`${out}/manifest.json`, JSON.stringify(manifest, null, 2));

const options = {
  entryPoints: {
    background: 'src/background.js',
    content: 'src/content/main.js',
    options: 'src/options/options.js',
  },
  outdir: out,
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  loader: { '.css': 'text' },
  legalComments: 'none',
  logLevel: 'info',
  define: { SPINE_TEST: String(test) },
};

// The content script runs as a classic script, so it can't be a module.
const content = { ...options, entryPoints: { content: 'src/content/main.js' }, format: 'iife' };
const rest = {
  ...options,
  entryPoints: { background: 'src/background.js', options: 'src/options/options.js' },
};

if (watch) {
  for (const config of [content, rest]) await (await esbuild.context(config)).watch();
} else {
  await Promise.all([esbuild.build(content), esbuild.build(rest)]);
}

if (release && !test) {
  const staging = await mkdtemp(join(tmpdir(), 'spine-release-'));
  await cp(out, staging, { recursive: true });
  const shipped = JSON.parse(await readFile(join(staging, 'manifest.json'), 'utf8'));
  delete shipped.key;
  await writeFile(join(staging, 'manifest.json'), JSON.stringify(shipped, null, 2));
  await mkdir('releases', { recursive: true });
  const zip = resolve(`releases/spine-${shipped.version}.zip`);
  await rm(zip, { force: true });
  execFileSync('zip', ['-r', '-X', '-q', zip, '.', '-x', '.DS_Store'], { cwd: staging });
  await rm(staging, { recursive: true, force: true });
  // The same file as spine.zip, so the latest release always has one link.
  await cp(zip, resolve('releases/spine.zip'));
  console.log(`Release: ${zip}`);
}
