// Supercut: everything but the key sentences folds into small pills, so the
// piece reads as its own spine. A pill can carry a bridge, a short line in the
// author's voice that says what it hides. Resting on a pill opens it in place;
// a click pins it open. The rules for what folds come from Reading Long Form:
//
// - only blocks of text fold: a stretch under 30 words between kept sentences
//   stays, since a pill would save little
// - a paragraph with no key sentence folds whole, and a paragraph like that
//   right after another joins its pill
// - a list item with no key sentence keeps its first sentence, so a bullet is
//   never left on its own
import { fingerprint, squash } from './text.js';

// The smallest stretch worth a pill. Reading Long Form uses 30 words; writers
// of short paragraphs leave many shorter stretches between key sentences, so
// when the supercut would still keep most of the piece, shorter ones fold too.
const MIN_COLLAPSE_WORDS = [30, 18, 10];
const KEEP_AT_MOST = 0.6;

export function computeRuns(article, keys, folds) {
  const total = article.sections.reduce(
    (sum, section) => sum + section.blocks.reduce((n, block) => n + block.sentences.reduce((m, s) => m + s.words, 0), 0),
    0,
  );
  let runs = [];
  for (const min of MIN_COLLAPSE_WORDS) {
    runs = runsAt(article, keys, folds, min);
    const hidden = runs.reduce((sum, run) => sum + run.words, 0);
    if (!total || (total - hidden) / total <= KEEP_AT_MOST) break;
  }
  return runs;
}

// The runs that fold, given the key sentences, the ones that fold anyway, and
// the smallest stretch worth folding.
function runsAt(article, keys, folds, minWords) {
  const cut = new Set([...keys].filter(id => !folds.has(id)));
  const kept = sentence => sentence.lead || cut.has(sentence.id);
  const runs = [];
  for (const section of article.sections) {
    let hidden = null;
    for (const block of section.blocks) {
      const keyed = block.sentences.filter(kept);
      if (
        !keyed.length &&
        hidden &&
        block.kind !== 'li' &&
        hidden.el.nextElementSibling === block.el
      ) {
        hidden.run.follow.push(block);
        hidden.el = block.el;
        continue;
      }
      const keep = block.kind === 'li' && !keyed.length ? new Set([block.sentences[0]]) : new Set(keyed);
      const whole = keep.size === 0;
      const groups = [];
      let group = null;
      for (const sentence of block.sentences) {
        if (keep.has(sentence)) {
          group = null;
          continue;
        }
        if (!group) groups.push((group = []));
        group.push(sentence);
      }
      const rests = groups.filter(
        g => whole || g.reduce((sum, sentence) => sum + sentence.words, 0) >= minWords,
      );
      for (const sentences of rests) {
        runs.push({ id: String(runs.length + 1), block, sentences, follow: [] });
      }
      hidden = whole && rests.length && block.kind !== 'li' ? { run: runs.at(-1), el: block.el } : null;
    }
  }
  for (const run of runs) {
    run.hidden = [...run.sentences, ...run.follow.flatMap(block => block.sentences)];
    run.text = squash(run.hidden.map(sentence => sentence.text).join(' '));
    run.key = fingerprint(run.text);
    run.words = run.hidden.reduce((sum, sentence) => sum + sentence.words, 0);
  }
  return runs;
}

// Puts a pill just before its run's first words. Never inside a link: there it
// goes before or after the link, whichever keeps the visible words in order.
function place(pill, run) {
  const block = run.block.el;
  const first = run.sentences[0].frags[0];
  if (!first) return;
  let link = null;
  for (let element = first.parentElement; element && element !== block; element = element.parentElement) {
    if (element.nodeName === 'A') link = element;
  }
  if (!link) {
    first.before(pill);
    return;
  }
  const visibleBefore = [...link.querySelectorAll('.s:not(.h)')].some(
    span => span.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
  if (visibleBefore) link.after(pill);
  else link.before(pill);
}

function makePill(run) {
  const pill = document.createElement('span');
  pill.className = 'pill';
  pill.setAttribute('role', 'button');
  pill.tabIndex = 0;
  pill.dataset.run = run.id;
  pill.dataset.key = run.key;
  pill.setAttribute('aria-expanded', 'false');
  pill.setAttribute('aria-label', 'Show hidden text');
  const dots = document.createElement('span');
  dots.className = 'dots';
  dots.textContent = '…';
  pill.append(dots);
  return pill;
}

export function applyRuns(runs) {
  for (const run of runs) {
    for (const sentence of run.sentences) {
      for (const element of [...sentence.frags, ...sentence.refs]) {
        element.classList.add('h');
        element.dataset.run = run.id;
      }
    }
    for (const block of run.follow) {
      block.el.classList.add('hb');
      block.el.dataset.run = run.id;
    }
  }
  for (const run of runs) {
    run.pill = makePill(run);
    place(run.pill, run);
    if (run.sentences.length === run.block.sentences.length) run.block.el.classList.add('whole');
  }
}

export function clearRuns(runs, scope) {
  for (const run of runs) run.pill?.remove();
  for (const element of scope.querySelectorAll('.pill')) element.remove();
  for (const element of scope.querySelectorAll('.h, .hb, .whole, [data-run]')) {
    element.classList.remove('h', 'hb', 'whole', 'open');
    delete element.dataset.run;
  }
}

// Puts each run's bridge inside its pill, as text only.
export function applyBridges(runs, bridges, { on = true, fresh = false } = {}) {
  for (const run of runs) {
    const pills = run.pill ? [run.pill] : [];
    for (const pill of pills) setBridge(pill, on ? bridges[run.key] : null, fresh);
  }
}

export function setBridge(pill, text, fresh = false) {
  pill.querySelector('.bridge')?.remove();
  if (!text) {
    pill.setAttribute('aria-label', 'Show hidden text');
    return;
  }
  const bridge = document.createElement('span');
  bridge.className = fresh ? 'bridge fresh' : 'bridge';
  bridge.textContent = text;
  pill.prepend(bridge);
  pill.setAttribute('aria-label', `${text} Show the full text`);
}

// What a bridge needs to see: the visible text on either side of each run.
export function bridgeRequests(article, runs) {
  const hidden = new Set(runs.flatMap(run => run.hidden.map(sentence => sentence.id)));
  const visible = article.sentences.filter(sentence => !hidden.has(sentence.id));
  const index = new Map(visible.map((sentence, at) => [sentence.n, at]));
  const near = (n, direction) => {
    // The visible sentences nearest to sentence number n, in one direction.
    const out = [];
    for (let k = n + direction; k >= 1 && k <= article.sentences.length && out.length < 2; k += direction) {
      const sentence = article.sentences[k - 1];
      if (index.has(sentence.n)) out.push(sentence.text);
    }
    return direction < 0 ? out.reverse() : out;
  };
  return runs.map(run => {
    const first = run.hidden[0].n;
    const last = run.hidden.at(-1).n;
    return {
      key: run.key,
      before: near(first, -1).join(' ').slice(-400),
      hidden: run.text.slice(0, 4000),
      after: near(last, 1).join(' ').slice(0, 400),
    };
  });
}

// How long the piece takes to read with its runs folded.
export function supercutWords(article, runs, bridges, bridgesOn) {
  const hidden = runs.reduce((sum, run) => sum + run.words, 0);
  const added = bridgesOn
    ? runs.reduce((sum, run) => sum + (bridges[run.key] ? bridges[run.key].split(/\s+/).length : 0), 0)
    : 0;
  return article.words - hidden + added;
}

// How long the pointer rests on a pill before it opens, and how long after the
// pointer leaves the run's paragraphs it closes again.
const HOVER_MS = 120;
const LEAVE_MS = 400;

// Opens a run when the pointer rests on its pill, and closes it once the pointer
// has left the run's paragraphs. A click pins a run open until the next click
// elsewhere, a click on its pill, or Escape.
export function expandOnHover(scope, active) {
  let open = null;
  let pinned = false;
  let enter;
  let leave;
  const hide = () => {
    if (!open) return;
    for (const element of [...open.parts, ...open.pills]) element.classList.remove('open');
    for (const pill of open.pills) pill.setAttribute('aria-expanded', 'false');
    open = null;
    pinned = false;
  };
  const show = (pill, pin) => {
    const run = pill.dataset.run;
    if (open?.run !== run || !open.pills.every(p => p.isConnected)) {
      hide();
      const all = [...scope.querySelectorAll(`[data-run="${run}"]`)];
      const parts = all.filter(element => !element.classList.contains('pill'));
      const pills = all.filter(element => element.classList.contains('pill'));
      const blocks = new Set(parts.map(part => part.closest('p, li') ?? part).filter(Boolean));
      blocks.add(pill.closest('p, li') ?? pill);
      open = { run, parts, pills, blocks };
      for (const element of parts) element.classList.add('open');
      for (const element of pills) {
        element.classList.add('open');
        element.setAttribute('aria-expanded', 'true');
      }
    }
    pinned = pin;
  };
  const close = hide;
  const toggle = pill => (open?.run === pill.dataset.run && pinned ? close() : show(pill, true));
  const within = target => Boolean(open) && [...open.blocks].some(block => block.contains(target));
  const pillAt = target => target.closest?.('.pill') ?? null;
  // The page moving under a still pointer (a lens change, a pill opening) fires
  // pointerover too; only a pointer that moved counts as resting on something.
  let moved = 0;
  const onMove = () => (moved = performance.now());
  const onOver = event => {
    if (!active() || performance.now() - moved > 120) return;
    clearTimeout(enter);
    const pill = pillAt(event.target);
    if (pill) {
      clearTimeout(leave);
      enter = setTimeout(() => show(pill, pinned), HOVER_MS);
    } else if (open && !pinned) {
      clearTimeout(leave);
      if (!within(event.target)) leave = setTimeout(close, LEAVE_MS);
    }
  };
  const onClick = event => {
    if (!active()) return;
    const pill = pillAt(event.target);
    if (pill) {
      clearTimeout(enter);
      event.preventDefault();
      toggle(pill);
    } else if (pinned && !within(event.target)) close();
  };
  const onKey = event => {
    if (!active()) return;
    if (event.key === 'Escape' && open) {
      close();
      event.stopPropagation();
      return;
    }
    const pill = pillAt(event.target);
    if (pill && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      toggle(pill);
    }
  };
  scope.addEventListener('pointermove', onMove, { passive: true });
  scope.addEventListener('pointerover', onOver);
  scope.addEventListener('click', onClick);
  scope.addEventListener('keydown', onKey);
  return {
    close,
    get isOpen() {
      return Boolean(open);
    },
    stop() {
      scope.removeEventListener('pointermove', onMove);
      scope.removeEventListener('pointerover', onOver);
      scope.removeEventListener('click', onClick);
      scope.removeEventListener('keydown', onKey);
      clearTimeout(enter);
      clearTimeout(leave);
      close();
    },
  };
}

// Opens or closes every run at once.
export function toggleAll(scope) {
  const parts = [...scope.querySelectorAll('.h, .hb')];
  const opening = parts.some(part => !part.classList.contains('open'));
  for (const part of parts) part.classList.toggle('open', opening);
  for (const pill of scope.querySelectorAll('.pill')) {
    pill.classList.toggle('open', opening);
    pill.setAttribute('aria-expanded', String(opening));
  }
  return opening;
}
