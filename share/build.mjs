// Builds the page a shared article opens in, into share/public/reader: Spine's
// reader for a plain web page (src/share/main.js), its font and its icons, and
// lib/build.js, which tells pages which build to load. Run it before deploying
// the share server, and before the share tests.
//
//   node share/build.mjs           build once, minified
//   node share/build.mjs --test    a readable build the tests can reach into
import * as esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const out = join(here, 'public/reader');
const test = process.argv.includes('--test');

await rm(out, { recursive: true, force: true });
await mkdir(join(out, 'fonts'), { recursive: true });
await esbuild.build({
  entryPoints: [join(root, 'src/share/main.js')],
  outfile: join(out, 'share.js'),
  bundle: true,
  format: 'iife',
  target: ['chrome120', 'safari16', 'firefox125'],
  minify: !test,
  loader: { '.css': 'text' },
  legalComments: 'none',
  logLevel: 'warning',
  define: { SPINE_TEST: String(test) },
});
for (const file of ['Newsreader.ttf', 'Newsreader-Italic.ttf', 'OFL.txt']) {
  await cp(join(root, 'static/fonts', file), join(out, 'fonts', file));
}
await cp(join(root, 'static/icons/icon-32.png'), join(out, 'icon-32.png'));
await cp(join(root, 'store/assets/icon-512.png'), join(out, 'icon-512.png'));
await cp(join(root, 'static/LICENSE.txt'), join(out, 'LICENSE.txt'));

const version = createHash('sha256').update(await readFile(join(out, 'share.js'))).digest('hex').slice(0, 12);
await writeFile(join(here, 'lib/build.js'), `// Written by share/build.mjs: the build of the reader that pages load.\nexport const VERSION = '${version}';\n`);
console.log(`Shared page built into ${out} (${version})`);
