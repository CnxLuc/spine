// Spine's entry on a page. The background worker adds this script when you
// first open Spine on a tab and then asks it to toggle the reader.
import { Reader } from './reader.js';
import { loadFonts } from './fonts.js';

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
  const fonts = loadFonts(file => chrome.runtime.getURL(file));
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
