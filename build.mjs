// Builds the extension into dist/, the folder you load unpacked in Aside (or any
// Chromium browser).
//
//   node build.mjs            build once
//   node build.mjs --watch    rebuild on change
//   node build.mjs --test     a build for the end-to-end tests, in .test-build/,
//                             whose background script can open Spine on any tab
//                             without a click. Never load it in your browser.
//   node build.mjs --release  also zips dist/ into releases/: spine.zip and
//                             spine-<version>.zip to download, and
//                             spine-store-<version>.zip for the Chrome Web Store
import * as esbuild from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { extensionIds, installer, windowsInstaller } from './tools/installer.mjs';

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
  entryPoints: { background: 'src/background.js', options: 'src/options/options.js', welcome: 'src/welcome/welcome.js' },
};

if (watch) {
  for (const config of [content, rest]) await (await esbuild.context(config)).watch();
} else {
  await Promise.all([esbuild.build(content), esbuild.build(rest)]);
}

// The connector installer the website serves, with the connector inside it
// and the ids of every Spine allowed to use it.
if (!test) {
  const ids = await extensionIds();
  await writeFile('docs/connect.sh', await installer(ids), { mode: 0o755 });
  // Windows PowerShell reads a script without a byte order mark as the local
  // code page, not UTF-8; keep the installer's own text plain ASCII.
  const windows = await windowsInstaller(ids);
  if (/[^\x00-\x7f]/.test(windows.replace(/@'[\s\S]*?\n'@/, ''))) throw new Error('tools/connect.ps1 must be plain ASCII outside the connector source');
  await writeFile('docs/connect.ps1', windows);
}

// Two zips: spine.zip to download and load unpacked, which keeps the
// manifest's key so every copy has the id the Claude Code and Codex connector
// allows; and one for the Chrome Web Store, which gives Spine its own id and
// refuses a key.
async function zipUp(name, { keepKey }) {
  const staging = await mkdtemp(join(tmpdir(), 'spine-release-'));
  await cp(out, staging, { recursive: true });
  const shipped = JSON.parse(await readFile(join(staging, 'manifest.json'), 'utf8'));
  if (!keepKey) delete shipped.key;
  await writeFile(join(staging, 'manifest.json'), JSON.stringify(shipped, null, 2));
  const zip = resolve(`releases/${name}`);
  await rm(zip, { force: true });
  execFileSync('zip', ['-r', '-X', '-q', zip, '.', '-x', '.DS_Store'], { cwd: staging });
  await rm(staging, { recursive: true, force: true });
  return zip;
}
if (release && !test) {
  await mkdir('releases', { recursive: true });
  const download = await zipUp(`spine-${manifest.version}.zip`, { keepKey: true });
  await cp(download, resolve('releases/spine.zip'));
  const store = await zipUp(`spine-store-${manifest.version}.zip`, { keepKey: false });
  console.log(`Release: ${download}\nStore: ${store}`);
}
