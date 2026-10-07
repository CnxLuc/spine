// Spine's entry on a page. The background worker adds this script when you
// first open Spine on a tab and then asks it to toggle the reader.
import { Reader } from './reader.js';

// Newsreader, loaded from the extension into this page's font set, under a name
// no page uses. Fonts from buffers aren't fetched, so a page's content security
// policy can't block them.
async function loadFonts() {
  if ([...document.fonts].some(face => face.family === 'Spine Newsreader')) return;
  const faces = [
    ['fonts/Newsreader.ttf', 'normal'],
    ['fonts/Newsreader-Italic.ttf', 'italic'],
  ];
  await Promise.all(
    faces.map(async ([file, style]) => {
      try {
        const buffer = await (await fetch(chrome.runtime.getURL(file))).arrayBuffer();
        const face = new FontFace('Spine Newsreader', buffer, { style, weight: '200 800', display: 'swap' });
        await face.load();
        document.fonts.add(face);
      } catch (error) {
        console.warn('Spine couldn’t load its font', error);
      }
    }),
  );
}

if (!globalThis.__spineReader) {
  // A Spine left on the page by an earlier version of the extension (after an
  // update or a reload) can no longer reach the extension; ask it to go.
  document.dispatchEvent(new CustomEvent('spine:shutdown'));
  document.getElementById('spine-reader-host')?.remove();
  const reader = new Reader();
  globalThis.__spineReader = reader;
  const shutdown = () => {
    document.removeEventListener('spine:shutdown', shutdown);
    reader.destroy();
  };
  // Registered after the event above, so it only hears newer versions.
  setTimeout(() => document.addEventListener('spine:shutdown', shutdown), 0);
  const fonts = loadFonts();
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.type === 'spine:toggle') {
      fonts
        .finally(() => reader.toggle())
        .then(
          () => reply({ ok: true }),
          error => {
            console.error('Spine', error);
            reply({ ok: false });
          },
        );
      return true;
    }
    // The ChatGPT sign-in this reader started has finished.
    if (message?.type === 'spine:connected') reader.onboard.connected(message);
    return false;
  });
  if (SPINE_TEST) globalThis.__spineTest = reader;
}
