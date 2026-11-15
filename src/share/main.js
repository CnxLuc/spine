// A shared article's page: Spine's own reader on a plain web page, opened on
// the article and the notes its link carries. The share server puts them in
// the page as JSON.
import { Reader } from '../content/reader.js';
import { loadFonts } from '../content/fonts.js';

const data = document.getElementById('spine-share');
if (data) {
  const shared = JSON.parse(data.textContent);
  // The fonts sit next to this script.
  const here = document.currentScript?.src ?? location.href;
  const fonts = loadFonts(file => new URL(file, here).href);
  const reader = new Reader({ shared });
  // The text waits a moment for its font, so it doesn't jump, but not long.
  Promise.race([fonts, new Promise(done => setTimeout(done, 1200))])
    .then(() => reader.openShared())
    .catch(error => console.error('Spine', error));
  if (SPINE_TEST) globalThis.__spineTest = reader;
}
