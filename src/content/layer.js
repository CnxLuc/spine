// The layer Spine reads in: a sheet over the page, in the browser's top layer
// so nothing on the page can sit above it, with its own scroll, a top bar that
// slides away while you read, a dock for the lenses, panels, notes and a
// lightbox. It knows nothing about articles; the reader fills it in.
import css from './styles.css';
import { HOST_ID } from './extract.js';
import { icon } from './icons.js';

const REST_MS = 150;

const html = (strings, ...values) => strings.reduce((out, string, i) => out + string + (values[i] ?? ''), '');

export class Layer {
  constructor() {
    const host = document.createElement('div');
    host.id = HOST_ID;
    host.setAttribute('popover', 'manual');
    const lock = [
      'position: fixed',
      'inset: 0',
      'width: 100vw',
      'height: 100vh',
      'max-width: none',
      'max-height: none',
      'margin: 0',
      'padding: 0',
      'border: 0',
      'background: transparent',
      'overflow: hidden',
      'z-index: 2147483647',
      'opacity: 1',
      'transform: none',
      'filter: none',
      'color-scheme: normal',
    ];
    host.style.cssText = lock.map(rule => `${rule} !important`).join('; ');
    this.host = host;
    this.shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = css;
    this.shadow.append(style);

    const root = document.createElement('div');
    root.className = 'spine';
    root.dataset.lens = 'read';
    root.innerHTML = html`
      <div class="backdrop"></div>
      <div class="progress" aria-hidden="true"><i></i></div>
      <header class="bar">
        <div class="bar-left">
          <div class="bar-site">
            <img alt="" referrerpolicy="no-referrer" />
            <span class="bar-name"></span>
            <span class="bar-title"></span>
          </div>
        </div>
        <div class="bar-right">
          <span class="bar-meter"></span>
          <button class="tool" data-panel="appearance" aria-label="Appearance" aria-expanded="false" title="Appearance">
            <span class="aa">A<small>a</small></span>
          </button>
          <button class="tool" data-panel="intelligence" aria-label="Reading notes" aria-expanded="false" title="Reading notes">
            ${icon('sparkles')}<span class="spark-state"></span>
          </button>
          <button class="tool" data-panel="share" aria-label="Copy and save" aria-expanded="false" title="Copy and save">
            ${icon('share')}
          </button>
          <button class="tool close" aria-label="Close Spine" title="Close (Esc)">${icon('x')}</button>
        </div>
      </header>
      <nav class="rail" aria-label="Outline" hidden></nav>
      <div class="rail-note" aria-hidden="true"></div>
      <main class="scroller" tabindex="-1"></main>
      <div class="dock">
        <div class="status" role="status" hidden></div>
        <div class="lens" role="radiogroup" aria-label="How much to show">
          <span class="lens-thumb" aria-hidden="true"></span>
        </div>
      </div>
      <div class="panel" data-for="appearance" hidden></div>
      <div class="panel" data-for="intelligence" hidden></div>
      <div class="panel" data-for="share" hidden></div>
      <div class="toast" role="status" aria-live="polite"></div>
      <div class="lightbox" hidden><figure><img alt="" /><figcaption></figcaption></figure></div>
      <div class="help" hidden></div>
    `;
    this.shadow.append(root);
    this.root = root;
    const $ = selector => root.querySelector(selector);
    this.scroller = $('.scroller');
    this.bar = $('.bar');
    this.rail = $('.rail');
    this.railNote = $('.rail-note');
    this.dock = $('.dock');
    this.lensGroup = $('.lens');
    this.lensThumb = $('.lens-thumb');
    this.status = $('.status');
    this.toastEl = $('.toast');
    this.lightbox = $('.lightbox');
    this.help = $('.help');
    this.panels = Object.fromEntries([...root.querySelectorAll('.panel')].map(panel => [panel.dataset.for, panel]));
    this.meter = $('.bar-meter');
    this.progressBar = $('.progress');

    this.handlers = { key: () => false, scroll: () => {}, rest: () => {}, close: () => {}, panel: () => {} };
    this.isOpen = false;
    this.scrolling = false;
    this.lastTop = 0;

    $('.close').addEventListener('click', () => this.handlers.close());
    for (const button of root.querySelectorAll('[data-panel]')) {
      button.addEventListener('click', () => this.togglePanel(button.dataset.panel));
    }
    root.addEventListener('pointerdown', event => {
      const path = event.composedPath();
      for (const [name, panel] of Object.entries(this.panels)) {
        if (panel.hidden) continue;
        const button = root.querySelector(`[data-panel="${name}"]`);
        if (!path.includes(panel) && !path.includes(button)) this.closePanels();
      }
    });
    // The chrome comes back when you reach for the top or bottom edge.
    root.addEventListener('pointermove', event => {
      if (event.clientY < 72 || event.clientY > window.innerHeight - 120) this.chrome(true);
    });

    let restTimer = 0;
    let frame = 0;
    this.scroller.addEventListener(
      'scroll',
      () => {
        if (!this.scrolling) {
          this.scrolling = true;
          this.handlers.scroll(true);
        }
        clearTimeout(restTimer);
        restTimer = setTimeout(() => {
          this.scrolling = false;
          this.handlers.scroll(false);
          this.handlers.rest();
        }, REST_MS);
        if (!frame) {
          frame = requestAnimationFrame(() => {
            frame = 0;
            this.onScrollFrame();
          });
        }
      },
      { passive: true },
    );

    // Links to places in the article scroll there instead of leaving it.
    this.scroller.addEventListener('click', event => {
      const jump = event.target.closest?.('a[data-jump]');
      if (jump) {
        event.preventDefault();
        const target = this.find(jump.dataset.jump);
        if (target) this.scrollToElement(target, { flash: true });
        return;
      }
      const img = event.target.closest?.('figure img');
      if (img && !img.closest('a')) this.openLightbox(img);
    });

    this.lightbox.addEventListener('click', () => this.closeLightbox());
    this.help.addEventListener('click', event => {
      if (event.target === this.help) this.toggleHelp(false);
    });

    // Keys: shortcuts work wherever focus is, and the page never sees them.
    this.onWindowKey = event => {
      if (!this.isOpen) return;
      if (event.composedPath().includes(this.host)) return;
      // Focus is outside the layer; bring it in and handle the key here.
      this.focus();
      if (this.handlers.key(event)) event.preventDefault();
      event.stopImmediatePropagation();
    };
    this.onHostKey = event => {
      if (this.handlers.key(event)) event.preventDefault();
      event.stopPropagation();
    };
    for (const type of ['keyup', 'keypress']) {
      host.addEventListener(type, event => event.stopPropagation());
    }
    host.addEventListener('keydown', this.onHostKey);
    this.onWindowKeyUp = event => {
      if (this.isOpen && !event.composedPath().includes(this.host)) {
        this.handlers.keyup?.(event);
        event.stopImmediatePropagation();
      }
    };
    host.addEventListener('keyup', event => this.handlers.keyup?.(event));
    window.addEventListener('blur', () => this.handlers.blur?.());
  }

  on(name, handler) {
    this.handlers[name] = handler;
  }

  find(anchor) {
    const escaped = CSS.escape(anchor);
    return this.scroller.querySelector(`[data-anchor="${escaped}"], #${escaped}`);
  }

  // Where an element sits in the scrolling article.
  offsetOf(element) {
    return element.getBoundingClientRect().top - this.scroller.getBoundingClientRect().top + this.scroller.scrollTop;
  }

  scrollTo(top, smooth = true) {
    this.scroller.scrollTo({ top, behavior: smooth ? 'smooth' : 'instant' });
  }

  scrollToElement(element, { flash = false, offset = 96 } = {}) {
    this.scrollTo(Math.max(0, this.offsetOf(element) - offset));
    if (flash) {
      element.animate(
        [{ backgroundColor: 'color-mix(in srgb, var(--accent) 18%, transparent)' }, { backgroundColor: 'transparent' }],
        { duration: 1600, easing: 'ease-out' },
      );
    }
  }

  onScrollFrame() {
    const top = this.scroller.scrollTop;
    const height = this.scroller.scrollHeight - this.scroller.clientHeight;
    const read = height > 0 ? Math.min(1, top / height) : 0;
    this.progressBar.style.setProperty('--read', read.toFixed(4));
    this.root.classList.toggle('scrolled', top > 8);
    const delta = top - this.lastTop;
    this.lastTop = top;
    if (top < 120 || height - top < 40) this.chrome(true);
    else if (delta > 6 && !this.anyPanelOpen()) this.chrome(false);
    else if (delta < -10) this.chrome(true);
    this.handlers.frame?.(top, this.scroller.clientHeight, read);
  }

  // The top bar and dock: away while you read down, back when you scroll up.
  chrome(shown) {
    if (this.chromeLocked && !shown) return;
    this.root.classList.toggle('bar-away', !shown);
    this.root.classList.toggle('dock-away', !shown);
  }

  anyPanelOpen() {
    return Object.values(this.panels).some(panel => !panel.hidden);
  }

  togglePanel(name, force) {
    const panel = this.panels[name];
    const opening = force ?? panel.hidden;
    this.closePanels();
    if (!opening) return;
    this.handlers.panel(name, panel);
    panel.hidden = false;
    this.root.querySelector(`[data-panel="${name}"]`)?.setAttribute('aria-expanded', 'true');
    this.chrome(true);
  }

  closePanels() {
    let closed = false;
    for (const [name, panel] of Object.entries(this.panels)) {
      if (panel.hidden) continue;
      panel.hidden = true;
      closed = true;
      this.root.querySelector(`[data-panel="${name}"]`)?.setAttribute('aria-expanded', 'false');
    }
    return closed;
  }

  toast(message, { action, label, duration = 3200 } = {}) {
    clearTimeout(this.toastTimer);
    this.toastEl.replaceChildren(message);
    if (action) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', () => {
        action();
        this.toastEl.classList.remove('shown');
      });
      this.toastEl.append(button);
    }
    this.toastEl.classList.add('shown');
    this.toastTimer = setTimeout(() => this.toastEl.classList.remove('shown'), duration);
  }

  openLightbox(img) {
    const box = this.lightbox;
    const image = box.querySelector('img');
    image.src = img.dataset.full || img.currentSrc || img.src;
    image.alt = img.alt;
    const caption = img.closest('figure')?.querySelector('figcaption');
    box.querySelector('figcaption').textContent = caption?.textContent ?? '';
    box.hidden = false;
    // Grow from where the image sits in the text.
    const from = img.getBoundingClientRect();
    requestAnimationFrame(() => {
      box.classList.add('shown');
      const to = image.getBoundingClientRect();
      if (to.width && from.width) {
        image.animate(
          [
            {
              transform: `translate(${from.left + from.width / 2 - (to.left + to.width / 2)}px, ${
                from.top + from.height / 2 - (to.top + to.height / 2)
              }px) scale(${from.width / to.width})`,
            },
            { transform: 'none' },
          ],
          { duration: 320, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
        );
      }
    });
  }

  closeLightbox() {
    if (this.lightbox.hidden) return false;
    this.lightbox.classList.remove('shown');
    setTimeout(() => (this.lightbox.hidden = true), 220);
    return true;
  }

  toggleHelp(force) {
    const show = force ?? this.help.hidden;
    this.help.hidden = !show;
    return show;
  }

  focus() {
    this.scroller.focus({ preventScroll: true });
  }

  show() {
    if (!this.host.isConnected) document.documentElement.append(this.host);
    try {
      if (!this.host.matches(':popover-open')) this.host.showPopover();
    } catch {
      // Without popovers the host is still fixed over the page at the top z-index.
    }
    this.isOpen = true;
    this.previousFocus = document.activeElement;
    // The page stops scrolling underneath.
    this.savedOverflow = [document.documentElement.style.overflow, document.body?.style.overflow];
    document.documentElement.style.setProperty('overflow', 'hidden', 'important');
    document.body?.style.setProperty('overflow', 'hidden', 'important');
    window.addEventListener('keydown', this.onWindowKey, true);
    window.addEventListener('keyup', this.onWindowKeyUp, true);
    requestAnimationFrame(() => {
      this.root.classList.add('shown');
      this.focus();
    });
  }

  hide() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.closePanels();
    this.root.classList.remove('shown');
    window.removeEventListener('keydown', this.onWindowKey, true);
    window.removeEventListener('keyup', this.onWindowKeyUp, true);
    const [htmlOverflow, bodyOverflow] = this.savedOverflow ?? ['', ''];
    document.documentElement.style.overflow = htmlOverflow;
    if (document.body) document.body.style.overflow = bodyOverflow;
    setTimeout(() => {
      if (this.isOpen) return;
      try {
        this.host.hidePopover();
      } catch {}
      this.host.style.setProperty('display', 'none', 'important');
      this.previousFocus?.focus?.({ preventScroll: true });
    }, 200);
  }

  reveal() {
    this.host.style.removeProperty('display');
  }

  destroy() {
    window.removeEventListener('keydown', this.onWindowKey, true);
    window.removeEventListener('keyup', this.onWindowKeyUp, true);
    if (this.isOpen) {
      const [htmlOverflow, bodyOverflow] = this.savedOverflow ?? ['', ''];
      document.documentElement.style.overflow = htmlOverflow;
      if (document.body) document.body.style.overflow = bodyOverflow;
    }
    this.isOpen = false;
    this.host.remove();
  }
}
