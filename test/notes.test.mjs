import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkBridges, checkLists, checkNotes, smarten } from '../src/content/notes.js';
import { computeRuns } from '../src/content/supercut.js';

// A small article shape, as shapeOf builds it from a page.
const shape = {
  curly: true,
  ids: new Set(['s1', 's2', 's3', 's4', 's5', 's6']),
  order: id => Number(id.slice(1)),
  first: 's1',
  sections: [
    { index: 0, heading: 'Opening', hasHeading: false },
    { index: 1, heading: '1. Biology and health', hasHeading: true },
  ],
  // Two paragraphs: s1–s3 and s4–s6.
  snap: id => (Number(id.slice(1)) <= 3 ? 's1' : Number(id.slice(1)) <= 6 ? 's4' : null),
  lists: [{ index: 0, items: ['First item text', 'Second item text', 'Third item with the previous point'] }],
};

test('keeps only key sentences the article has, in order, and folds among them', () => {
  const notes = checkNotes(
    { keySentences: ['s4', 's1', 's9', 's1'], collapseFolds: ['s4', 's2'], sections: [], chapters: [] },
    shape,
  );
  assert.deepEqual(notes.keySentences, ['s1', 's4']);
  assert.deepEqual(notes.collapseFolds, ['s4']);
});

test('matches section notes to headings and sets their quotes like the article', () => {
  const notes = checkNotes(
    {
      keySentences: [],
      collapseFolds: [],
      sections: [
        { heading: '1. biology and health', summary: "I think it's the area with the most potential." },
        { heading: 'A heading that isn’t there', summary: 'Lost.' },
      ],
      chapters: [],
    },
    shape,
  );
  assert.deepEqual(notes.sections, { 1: 'I think it’s the area with the most potential.' });
});

test('chapters only for articles without headings, starting at paragraphs, in order', () => {
  const headless = { ...shape, sections: [{ index: 0, heading: 'Opening', hasHeading: false }] };
  const notes = checkNotes(
    {
      keySentences: [],
      collapseFolds: [],
      sections: [{ heading: 'Opening', summary: 'Dropped once there are chapters.' }],
      chapters: [
        { start: 's2', title: 'How it starts', summary: 'The start.' },
        { start: 's5', title: 'Where it goes', summary: 'The rest.' },
        { start: 's4', title: 'Out of order', summary: 'Skipped.' },
      ],
    },
    headless,
  );
  assert.deepEqual(
    notes.chapters.map(chapter => [chapter.start, chapter.title]),
    [
      ['s1', 'How it starts'],
      ['s4', 'Where it goes'],
    ],
  );
  assert.deepEqual(notes.sections, {});
  // An article with headings gets no chapters.
  assert.deepEqual(checkNotes({ chapters: [{ start: 's1', title: 'x', summary: 'y' }, { start: 's4', title: 'z', summary: 'w' }] }, shape).chapters, []);
});

test('a grouping must place every item exactly once', () => {
  const good = { name: 'by how sure I am', about: 'x', groups: [{ name: 'Sure', items: [1, 3] }, { name: 'Unsure', items: [2] }], edits: [{ item: 3, from: 'the previous point', to: 'the point above' }] };
  const missing = { name: 'by who acts', about: 'x', groups: [{ name: 'Us', items: [1] }, { name: 'Them', items: [2] }], edits: [] };
  const lists = checkLists(
    { groupings: [{ list: 0, sentence: 'These items are organized', asWritten: 'one at a time', by: [good, missing] }], carousels: [] },
    shape,
    new Set(['brain']),
  );
  assert.equal(lists.groupings[0].by.length, 1);
  assert.deepEqual(lists.groupings[0].by[0].groups, [['Sure', [1, 3]], ['Unsure', [2]]]);
  assert.deepEqual(lists.groupings[0].by[0].edits, [[3, 'the previous point', 'the point above']]);
});

test('cards get a known icon for every item', () => {
  const lists = checkLists({ groupings: [], carousels: [{ list: 0, label: 'Things', icons: ['brain', 'nope'] }] }, shape, new Set(['brain']));
  assert.deepEqual(lists.carousels[0].icons, ['brain', 'bookmark', 'bookmark']);
});

test('bridges are keyed by the text they stand in for, and kept short', () => {
  const runs = [{ key: 'aa' }, { key: 'bb' }];
  const bridges = checkBridges(
    { bridges: [{ run: 0, text: 'A short bridge in my voice.' }, { run: 1, text: 'word '.repeat(30) }, { run: 7, text: 'Nowhere.' }] },
    runs,
  );
  assert.deepEqual(bridges, { aa: 'A short bridge in my voice.' });
});

test('smart quotes', () => {
  assert.equal(smarten(`I'm "sure" it's the '90s.`), 'I’m “sure” it’s the ’90s.');
});

// Folding: blocks of text fold, short stretches stay, list items keep their first sentence.
function article(blocks) {
  let n = 0;
  const els = [];
  const made = blocks.map(([kind, lengths]) => {
    const el = { nextElementSibling: null };
    els.at(-1) && (els.at(-1).nextElementSibling = el);
    els.push(el);
    return {
      kind,
      el,
      sentences: lengths.map(words => {
        n++;
        return { id: `s${n}`, n, words, lead: false, text: `Sentence ${n}.` };
      }),
    };
  });
  return { sections: [{ blocks: made }] };
}

test('a paragraph without key sentences folds whole, and the next one joins it', () => {
  const a = article([
    ['p', [12, 12]],
    ['p', [20]],
    ['p', [15]],
  ]);
  const runs = computeRuns(a, new Set(['s1', 's2']), new Set());
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0].hidden.map(s => s.id), ['s3', 's4']);
});

test('a short stretch between key sentences stays; a long one folds', () => {
  const a = article([['p', [10, 12, 10, 25, 20, 10]]]);
  // s2 (12 words) sits between keys: too short to fold. s4+s5 (45 words) fold.
  const runs = computeRuns(a, new Set(['s1', 's3', 's6']), new Set());
  assert.deepEqual(runs.map(run => run.hidden.map(s => s.id)), [['s4', 's5']]);
});

test('a list item with no key sentence keeps its first sentence', () => {
  const a = article([['li', [8, 30]]]);
  const runs = computeRuns(a, new Set(), new Set());
  assert.deepEqual(runs.map(run => run.hidden.map(s => s.id)), [['s2']]);
});

test('folded key sentences let their block fold whole', () => {
  const a = article([['p', [10, 10, 10]]]);
  const runs = computeRuns(a, new Set(['s2']), new Set(['s2']));
  assert.deepEqual(runs[0].hidden.map(s => s.id), ['s1', 's2', 's3']);
});

test('short stretches fold too when the supercut would keep most of the piece', () => {
  // Long key sentences with short asides between them: at 30 words nothing
  // folds, so shorter stretches fold until at most 60% of the words remain.
  const a = article([['p', [20, 12, 20, 12, 20, 12]]]);
  const runs = computeRuns(a, new Set(['s1', 's3', 's5']), new Set());
  assert.deepEqual(runs.map(run => run.hidden.map(s => s.id)), [['s2'], ['s4'], ['s6']]);
  // With long asides, the 30-word rule alone is enough.
  const b = article([['p', [20, 40, 20, 12]]]);
  assert.deepEqual(computeRuns(b, new Set(['s1', 's3']), new Set()).map(run => run.hidden.map(s => s.id)), [['s2']]);
});
