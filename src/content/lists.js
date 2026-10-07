// Lists, two ways. Ported from Reading Long Form's regroup-lists.js and
// list-carousels.js (MIT).
//
// Regroup: authors order every list by some principle, usually without naming
// it. A sentence above the list names it in a dropdown, "These limits are
// organized [one at a time].", and the dropdown offers other principles. Picking
// one shows the same items under new headings, with a few words changed where
// the new order would leave them wrong (dotted underline; hover shows the
// original). Nothing animates.
//
// Cards: the chunkiest lists show as a row of cards you slide through, one item
// per card, each with an icon. When a list is regrouped, each group becomes its
// own row.
//
// Both show copies of the author's items, with the marks the other ideas put on
// them, made again whenever those marks change. The author's list stays in the
// page, hidden, so the other ideas keep working on it.
import { cardIcon, icon } from './icons.js';

let controls = 0;

function copyItem(item, tag) {
  const copy = item.cloneNode(true);
  for (const part of copy.querySelectorAll('.open')) part.classList.remove('open');
  for (const pill of copy.querySelectorAll('.pill')) pill.setAttribute('aria-expanded', 'false');
  for (const element of copy.querySelectorAll('[data-anchor]')) delete element.dataset.anchor;
  copy.dataset.copy = tag;
  return copy;
}

const announce = (list, name) => list.dispatchEvent(new CustomEvent(name, { bubbles: true }));

// What a list shows now: the list itself, or, while it's regrouped, the list
// under each group heading, with the heading as its label.
function shownLists(list) {
  if (!list.classList.contains('regroup-away')) return [{ list, label: null }];
  const view = list.nextElementSibling;
  if (!view?.matches('.regrouped')) return [];
  return [...view.querySelectorAll(':scope > ul, :scope > ol')].map(group => ({
    list: group,
    label: group.previousElementSibling.textContent.replace(/:$/, ''),
  }));
}

// Swaps the first place the author's words appear for the new words, marked so
// you can tell, with the original on hover.
function edit(item, from, to) {
  const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT, {
    acceptNode: node =>
      node.parentElement.closest('.pill') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const at = node.data.indexOf(from);
    if (at < 0) continue;
    const rest = node.splitText(at);
    rest.data = rest.data.slice(from.length);
    const changed = document.createElement('span');
    changed.className = 'regroup-edit';
    changed.title = `Originally: “${from}”`;
    changed.textContent = to;
    rest.before(changed);
    return;
  }
}

export class Regroup {
  constructor(article, groupings) {
    this.article = article;
    this.found = article.lists
      .filter(list => groupings[list.index])
      .map((list, index) => ({ ...list, notes: groupings[list.index], tag: `g${index + 1}`, principle: null, view: null }));
    for (const found of this.found) {
      found.control = this.control(found);
      found.el.before(found.control.line);
    }
    this.onPointer = event => {
      for (const { control } of this.found) {
        if (!control.picker.contains(event.composedPath()[0])) control.close(false);
      }
    };
    this.recopy = () => {
      for (const found of this.found) if (found.principle) this.show(found, found.principle);
    };
    article.root.addEventListener('pointerdown', this.onPointer);
    article.root.addEventListener('spine:marks', this.recopy);
  }

  view(found, principle) {
    const view = document.createElement('div');
    view.className = 'regrouped';
    for (const [name, numbers] of principle.groups) {
      const heading = document.createElement('h3');
      heading.className = 'regroup-heading';
      heading.textContent = `${name}:`;
      const group = document.createElement(found.el.localName);
      for (const number of numbers) {
        const item = found.items[number - 1];
        if (!item) continue;
        const copy = copyItem(item, found.tag);
        copy.dataset.item = number;
        if (found.el.localName === 'ol') copy.value = number;
        for (const [at, from, to] of principle.edits ?? []) if (at === number) edit(copy, from, to);
        group.append(copy);
      }
      view.append(heading, group);
    }
    return view;
  }

  restore(found) {
    found.view?.remove();
    found.view = null;
    found.el.classList.remove('regroup-away');
  }

  show(found, principle) {
    announce(found.el, 'list:regrouping');
    this.restore(found);
    found.principle = principle;
    if (principle) {
      found.view = this.view(found, principle);
      found.el.classList.add('regroup-away');
      found.el.after(found.view);
    }
    announce(found.el, 'list:regrouped');
  }

  // The sentence above a list, finished by a dropdown and a period. Resting on
  // the dropdown stacks every option with the chosen one right over it, like a
  // vertical segmented control. Hovering an option says what it means.
  control(found) {
    const id = `regroup-${++controls}`;
    const choices = [
      { name: found.notes.asWritten, about: 'How the author ordered it', principle: null },
      ...found.notes.by.map(principle => ({ ...principle, principle })),
    ];
    let chosen = 0;
    const line = document.createElement('div');
    line.className = 'regroup';
    const start = document.createElement('span');
    start.id = id;
    start.textContent = found.notes.sentence;
    const picker = document.createElement('span');
    picker.className = 'regroup-picker';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'regroup-trigger';
    trigger.id = `${id}-value`;
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-labelledby', `${id} ${id}-value`);
    const value = document.createElement('span');
    value.textContent = choices[0].name;
    trigger.append(value);
    trigger.insertAdjacentHTML('beforeend', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>');
    const menu = document.createElement('span');
    menu.className = 'regroup-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-labelledby', id);
    menu.hidden = true;
    const options = choices.map((choice, index) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'regroup-option';
      option.setAttribute('role', 'menuitemradio');
      option.setAttribute('aria-checked', String(index === chosen));
      option.tabIndex = -1;
      option.title = choice.about;
      option.textContent = choice.name;
      option.addEventListener('click', () => pick(index));
      return option;
    });
    menu.append(...options);
    picker.append(trigger, menu);
    const end = document.createElement('span');
    end.className = 'regroup-end';
    end.append(picker, '.');
    line.append(start, ' ', end);

    const place = () => {
      const option = options[chosen];
      menu.style.left = `${-option.offsetLeft}px`;
      menu.style.top = `${-option.offsetTop}px`;
      const over = menu.getBoundingClientRect().right - (window.innerWidth - 8);
      if (over > 0) menu.style.left = `${-option.offsetLeft - over}px`;
    };
    const open = focus => {
      if (menu.hidden) {
        menu.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        place();
      }
      if (focus) options[chosen].focus();
    };
    const close = refocus => {
      if (menu.hidden) return;
      if (refocus) trigger.focus();
      menu.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
    };
    const pick = index => {
      chosen = index;
      for (const [at, option] of options.entries()) option.setAttribute('aria-checked', String(at === index));
      value.textContent = choices[index].name;
      close(menu.contains(menu.getRootNode().activeElement));
      this.show(found, choices[index].principle);
    };
    let enter;
    let leave;
    picker.addEventListener('pointerenter', event => {
      clearTimeout(leave);
      if (event.pointerType === 'mouse') enter = setTimeout(() => open(false), 100);
    });
    picker.addEventListener('pointerleave', event => {
      clearTimeout(enter);
      if (event.pointerType === 'mouse' && !menu.contains(menu.getRootNode().activeElement)) {
        leave = setTimeout(() => close(false), 200);
      }
    });
    trigger.addEventListener('click', () => (menu.hidden ? open(false) : close(false)));
    trigger.addEventListener('keydown', event => {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
        open(true);
      }
    });
    menu.addEventListener('keydown', event => {
      const at = options.indexOf(menu.getRootNode().activeElement);
      const move = { ArrowDown: 1, ArrowUp: -1 }[event.key];
      if (move) {
        event.preventDefault();
        options[(at + move + options.length) % options.length].focus();
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        options.at(event.key === 'Home' ? 0 : -1).focus();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close(true);
      } else if (event.key === 'Tab') close(false);
    });
    picker.addEventListener('focusout', event => {
      if (!picker.contains(event.relatedTarget)) close(false);
    });
    return { line, picker, close };
  }

  stop() {
    this.article.root.removeEventListener('pointerdown', this.onPointer);
    this.article.root.removeEventListener('spine:marks', this.recopy);
    for (const found of this.found) {
      announce(found.el, 'list:regrouping');
      this.restore(found);
      found.control.line.remove();
      announce(found.el, 'list:regrouped');
    }
  }
}

export class Cards {
  constructor(article, carousels) {
    this.article = article;
    this.found = article.lists
      .filter(list => carousels[list.index])
      .map((list, index) => ({ ...list, notes: carousels[list.index], tag: `c${index + 1}`, rows: [] }));
    for (const found of this.found) this.show(found);
    const of = event => this.found.find(found => found.el === event.target);
    this.before = event => of(event) && this.hide(of(event));
    this.after = event => of(event) && this.show(of(event));
    this.recopy = () => {
      for (const found of this.found) if (!found.el.classList.contains('regroup-away')) this.show(found);
    };
    article.root.addEventListener('list:regrouping', this.before);
    article.root.addEventListener('list:regrouped', this.after);
    article.root.addEventListener('spine:marks', this.recopy);
  }

  row(found, { list, label }, tag) {
    const items = [...list.children].filter(child => child.nodeName === 'LI');
    const row = document.createElement('div');
    row.className = 'carousel';
    row.setAttribute('role', 'region');
    row.setAttribute('aria-roledescription', 'carousel');
    row.setAttribute('aria-label', label ?? found.notes.label);
    const track = document.createElement(list.localName);
    track.className = 'carousel-track';
    track.tabIndex = 0;
    for (const [index, item] of items.entries()) {
      const number = Number(item.dataset.item) || index + 1;
      const card = copyItem(item, tag);
      card.classList.add('carousel-card');
      const corner = document.createElement('span');
      corner.className = 'carousel-icon';
      corner.innerHTML = cardIcon(found.notes.icons[number - 1]);
      card.prepend(corner);
      track.append(card);
    }
    const cards = [...track.children];
    let heading = null;
    const current = () => {
      if (heading !== null) return heading;
      const left = track.getBoundingClientRect().left;
      const offsets = cards.map(card => Math.abs(card.getBoundingClientRect().left - left));
      return offsets.indexOf(Math.min(...offsets));
    };
    const go = index => {
      heading = Math.max(0, Math.min(cards.length - 1, index));
      track.scrollTo({ left: cards[heading].offsetLeft - cards[0].offsetLeft });
    };
    track.addEventListener('keydown', event => {
      if (event.target !== track) return;
      const to = { ArrowLeft: current() - 1, ArrowRight: current() + 1, Home: 0, End: cards.length - 1 }[event.key];
      if (to === undefined) return;
      event.preventDefault();
      go(to);
    });
    // Buttons for a mouse without sideways scrolling.
    const nav = document.createElement('div');
    nav.className = 'carousel-nav';
    const back = document.createElement('button');
    back.type = 'button';
    back.setAttribute('aria-label', 'Previous card');
    back.innerHTML = icon('chevron-left');
    const next = document.createElement('button');
    next.type = 'button';
    next.setAttribute('aria-label', 'Next card');
    next.innerHTML = icon('chevron-right');
    back.addEventListener('click', () => go(current() - 1));
    next.addEventListener('click', () => go(current() + 1));
    const sync = () => {
      const left = track.scrollLeft;
      back.disabled = left <= 2;
      next.disabled = left >= track.scrollWidth - track.clientWidth - 2;
    };
    track.addEventListener('scroll', sync, { passive: true });
    track.addEventListener('scrollend', () => {
      heading = null;
      sync();
    });
    for (const type of ['pointerdown', 'wheel', 'touchstart']) {
      track.addEventListener(type, () => (heading = null), { passive: true });
    }
    nav.append(back, next);
    row.append(track, nav);
    requestAnimationFrame(sync);
    list.classList.add('carousel-away');
    list.after(row);
    return { list, row };
  }

  show(found) {
    this.hide(found);
    found.rows = shownLists(found.el).map((shown, index) => this.row(found, shown, `${found.tag}-${index + 1}`));
  }

  hide(found) {
    for (const { list, row } of found.rows) {
      row.remove();
      list.classList.remove('carousel-away');
    }
    found.rows = [];
  }

  stop() {
    this.article.root.removeEventListener('list:regrouping', this.before);
    this.article.root.removeEventListener('list:regrouped', this.after);
    this.article.root.removeEventListener('spine:marks', this.recopy);
    for (const found of this.found) this.hide(found);
  }
}
