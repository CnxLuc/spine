// Choosing who reads, right in the reader, the first time Spine has no one to
// read with. A card above the dock offers the two ways to read on a plan the
// reader already pays for: ChatGPT signs in, in a small window; Claude Code
// needs Spine's connector once, which the card shows how to add and watches
// for. Either way, reading starts as soon as it's connected. The card says what
// Spine sends, so choosing is agreeing to it.
import { giveConsent } from './settings.js';
import { icon } from './icons.js';
import { CHATGPT_LOGO } from '../shared/brands.js';

export const COMMAND = 'curl -fsSL https://cnxluc.github.io/spine/connect.sh | bash';
export const MANAGE_USAGE = 'https://chatgpt.com/settings/usage';
const CLAUDE_CODE = 'https://claude.com/claude-code';
// How long the card watches for Claude Code before it asks to be told.
const WATCH_FOR = 15 * 60 * 1000;

const el = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
const button = (className, html, action) => {
  const b = el('button', className);
  b.type = 'button';
  b.innerHTML = html;
  b.addEventListener('click', action);
  return b;
};
const windows = () => /^win/i.test(navigator.userAgentData?.platform ?? navigator.platform ?? '');
const visit = url => window.open(url, '_blank', 'noopener');

export class Onboard {
  constructor(reader) {
    this.reader = reader;
    this.card = reader.layer.card;
    this.mode = null;
    this.detail = {};
  }

  // Whether to offer the card without being asked: until the reader says not now.
  async wanted() {
    try {
      const { onboardLater } = await chrome.storage.local.get('onboardLater');
      return !onboardLater;
    } catch {
      return true;
    }
  }

  show(mode, detail = {}) {
    clearTimeout(this.timer);
    this.mode = mode;
    this.detail = detail;
    this.card.dataset.mode = mode;
    this.card.replaceChildren(...this[mode]());
    this.card.hidden = false;
    // The welcome sits above the reading status; the rest replace it.
    if (mode !== 'welcome') this.reader.layer.status.hidden = true;
  }

  hide() {
    clearTimeout(this.timer);
    this.mode = null;
    this.card.hidden = true;
  }

  /* What the card shows */

  heading(glyph, text) {
    const head = el('p', 'ob-head');
    head.innerHTML = glyph;
    head.append(text);
    return head;
  }

  choose() {
    const parts = [
      this.heading(icon('sparkles'), 'Let Spine read this for you'),
      el(
        'p',
        'ob-text',
        'Spine picks out the sentences that carry the piece and folds the rest, on a plan you already pay for. Choose who reads: Spine sends them the text of the articles you open, and nothing else.',
      ),
    ];
    if (this.detail.error) parts.push(el('p', 'ob-error', this.detail.error));
    const choices = el('div', 'ob-choices');
    const chatgpt = el('div', 'ob-choice');
    chatgpt.append(
      button('siwc', `${CHATGPT_LOGO}<span>Continue with ChatGPT</span>`, () => this.chatgpt()),
      el('small', null, 'On your ChatGPT Plus or Pro plan'),
    );
    const claude = el('div', 'ob-choice');
    claude.append(
      button('ob-alt', `${icon('terminal')}<span>Use Claude Code</span>`, () => this.claude()),
      el('small', null, 'On your Claude plan, through Claude Code'),
    );
    choices.append(chatgpt, claude);
    const foot = el('p', 'ob-foot');
    foot.append(
      button('ob-link', 'Use an API key instead', () => chrome.runtime.sendMessage({ type: 'spine:options' })),
      button('ob-link', 'Not now', () => this.later()),
    );
    parts.push(choices, foot);
    return parts;
  }

  chatgptWaiting() {
    const actions = el('p', 'ob-foot');
    actions.append(
      button('ob-link', 'Open it again', () => this.chatgpt()),
      button('ob-link', 'Back', () => this.show('choose')),
    );
    return [
      this.heading(icon('loader-circle', 'icon spin'), 'Signing in to ChatGPT'),
      el('p', 'ob-text', 'Finish in the window that opened. Spine starts reading as soon as you’re back.'),
      actions,
    ];
  }

  claudeWaiting() {
    const { reason } = this.detail;
    const parts = [this.heading(icon('terminal'), 'Connect Claude Code')];
    const command = () => {
      const row = el('div', 'ob-command');
      const code = el('code', null, COMMAND);
      const copy = button('ob-copy', `${icon('copy')}<span>Copy</span>`, async () => {
        try {
          await navigator.clipboard.writeText(COMMAND);
          copy.querySelector('span').textContent = 'Copied';
          setTimeout(() => (copy.querySelector('span').textContent = 'Copy'), 1600);
        } catch {
          // Pages that don't allow the clipboard: select it to copy by hand.
          const range = document.createRange();
          range.selectNodeContents(code);
          const selection = this.reader.layer.shadow.getSelection?.() ?? getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        }
      });
      row.append(code, copy);
      return row;
    };
    if (reason === 'windows') {
      parts.push(el('p', 'ob-text', 'Claude Code connects to Spine on Mac and Linux for now. On Windows, continue with ChatGPT or use an API key.'));
    } else if (reason === 'install') {
      const text = el('p', 'ob-text', 'Spine is connected, but can’t find Claude Code on this computer. ');
      const link = el('a', null, 'Install Claude Code');
      link.href = CLAUDE_CODE;
      link.target = '_blank';
      link.rel = 'noopener';
      text.append(link, ', run claude in Terminal once to sign in, then run this again:');
      parts.push(text, command());
    } else if (reason === 'sign-in') {
      parts.push(el('p', 'ob-text', 'Claude Code isn’t signed in. Run claude in Terminal and sign in to your Claude account.'));
    } else if (reason === 'connect') {
      parts.push(el('p', 'ob-text', 'Paste this into Terminal, once. Spine starts reading as soon as it’s connected.'), command());
    } else {
      parts.push(el('p', 'ob-text', 'Looking for Claude Code on this computer…'));
    }
    const foot = el('p', 'ob-foot');
    if (reason !== 'windows') {
      const watching = el('span', 'ob-watch');
      if (this.detail.stopped) {
        foot.append(button('ob-link', 'Check again', () => this.claude()));
      } else {
        watching.innerHTML = `${icon('loader-circle', 'icon spin')}<span>Waiting for Claude Code</span>`;
        foot.append(watching);
      }
    }
    foot.append(button('ob-link', 'Back', () => this.show('choose')));
    parts.push(foot);
    return parts;
  }

  welcome() {
    const actions = el('p', 'ob-foot');
    actions.append(
      button('ob-got', 'Got it', () => this.hide()),
      button('ob-link', `Manage usage ${icon('external-link')}`, () => visit(MANAGE_USAGE)),
    );
    return [
      this.heading(CHATGPT_LOGO, 'You’re using your ChatGPT plan'),
      el('p', 'ob-text', 'Spine’s reading uses your ChatGPT plan and counts toward its limits. Manage usage in your ChatGPT settings.'),
      actions,
    ];
  }

  /* What the choices do */

  async chatgpt() {
    await giveConsent();
    this.show('chatgptWaiting');
    const reply = await chrome.runtime.sendMessage({ type: 'spine:sign-in' }).catch(error => ({ started: false, message: error.message }));
    if (!reply?.started) this.show('choose', { error: reply?.message || 'Spine couldn’t open the ChatGPT sign-in. Try again.' });
  }

  // From the worker, when the ChatGPT window closes.
  async connected(message) {
    if (message.engine !== 'chatgpt' || this.mode !== 'chatgptWaiting') return;
    if (!message.ok) {
      this.show('choose', { error: message.message });
      return;
    }
    // OpenAI asks apps to say so, once, the first time.
    const { chatgptWelcomed } = await chrome.storage.local.get('chatgptWelcomed');
    if (chatgptWelcomed) this.hide();
    else {
      this.show('welcome');
      chrome.storage.local.set({ chatgptWelcomed: true });
    }
    this.reader.read(false);
  }

  async claude() {
    await giveConsent();
    await chrome.storage.local.set({ engine: 'claude-code' });
    this.show('claudeWaiting', { reason: windows() ? 'windows' : null });
    this.since = Date.now();
    if (!windows()) this.watch();
  }

  // Checks for Claude Code every few seconds while the card waits, and reads
  // as soon as it's connected and signed in.
  async watch() {
    if (this.mode !== 'claudeWaiting') return;
    if (Date.now() - this.since > WATCH_FOR) {
      this.show('claudeWaiting', { ...this.detail, stopped: true });
      return;
    }
    if (this.reader.layer.isOpen) {
      const state = await chrome.runtime.sendMessage({ type: 'spine:engine', fresh: true }).catch(() => null);
      if (this.mode !== 'claudeWaiting') return;
      if (state?.kind === 'claude-code' && state.ready) {
        this.hide();
        this.reader.read(false);
        return;
      }
      const here = state?.local;
      const reason = !here?.available ? 'connect' : !here.claude ? 'install' : !here.claude.signedIn ? 'sign-in' : 'connect';
      // Drawn again only when something changed, so Copy keeps its feedback.
      if (reason !== this.detail.reason) this.show('claudeWaiting', { reason });
    }
    this.timer = setTimeout(() => this.watch(), 2500);
  }

  async later() {
    this.hide();
    await chrome.storage.local.set({ onboardLater: true }).catch(() => {});
  }
}
