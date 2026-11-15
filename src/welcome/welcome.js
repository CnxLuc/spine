// The page Spine opens once, when it's installed: pin it, open it on an
// article, and know who reads.
const $ = id => document.getElementById(id);

// Whether Spine's button is in the toolbar, kept up to date while the page is
// open, so the first step ticks itself off.
async function pinned() {
  try {
    const { isOnToolbar } = await chrome.action.getUserSettings();
    $('pin-step').classList.toggle('done', Boolean(isOnToolbar));
  } catch {
    // Browsers without it keep the step as it is.
  }
}
pinned();
if (chrome.action.onUserSettingsChanged) chrome.action.onUserSettingsChanged.addListener(pinned);
else setInterval(pinned, 1500);

// The shortcut as the browser has it: another extension may have taken it.
const keys = text => {
  const parts = /\+/.test(text) ? text.split('+') : [...text];
  return parts.map(part => `<kbd>${part.replace(/[<&]/g, '')}</kbd>`).join('');
};
const commands = await chrome.commands.getAll().catch(() => []);
const shortcut = commands.find(command => command.name === '_execute_action')?.shortcut;
if (shortcut) $('shortcut').innerHTML = keys(shortcut);
else if (commands.length) {
  $('shortcut').textContent = 'the shortcut you choose';
  $('no-shortcut').hidden = false;
}
$('shortcuts').addEventListener('click', event => {
  event.preventDefault();
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});
