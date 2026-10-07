// Text helpers that don't touch the page: splitting a block's text into
// sentences, counting words, and the fingerprint that ties stored notes to an
// article's exact text. The splitting rules come from Tareq Ismail's Reading
// Long Form (MIT), extended for articles in the wild.

const segmenters = new Map();
function segmenterFor(lang) {
  const key = lang || 'en';
  if (!segmenters.has(key)) {
    let segmenter;
    try {
      segmenter = new Intl.Segmenter(key, { granularity: 'sentence' });
    } catch {
      segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
    }
    segmenters.set(key, segmenter);
  }
  return segmenters.get(key);
}

const count = (text, pattern) => text.match(pattern)?.length ?? 0;
const unclosedQuote = text => count(text, /[“«]/g) > count(text, /[”»]/g);
// Abbreviations a sentence can't end on when the next word is capitalized:
// initials ("Iain M. Banks", "U.S."), titles, and Latin shorthands.
const ABBREVIATION = /(?:^|[\s(“"'.])(?:\p{Lu}|Mr|Mrs|Ms|Dr|Prof|St|Jr|Sr|vs|e\.g|i\.e|cf|Fig|approx)\.$/u;
// A list marker on its own, like "1." or "(b)", belongs to the sentence after it.
const MARKER = /^\(?(?:\d{1,3}|[A-Za-z]|[ivxIVX]{2,4})[.)]$/;

// Sentence ranges in a block's text: { start, end, text }, with whitespace
// trimmed from each range and runs of whitespace in text as single spaces. A
// fragment with no letters or digits joins the sentence before it, and so does
// the rest of a sentence the splitter broke too early: after an initial or a
// title, before a lowercase word, or inside a quotation.
export function splitSentences(text, lang) {
  const sentences = [];
  let carry = null;
  for (const { segment, index } of segmenterFor(lang).segment(text)) {
    const body = segment.trim();
    if (!body) continue;
    let start = index + segment.length - segment.trimStart().length;
    const end = start + body.length;
    if (MARKER.test(body)) {
      carry ??= start;
      continue;
    }
    if (carry !== null) {
      start = carry;
      carry = null;
    }
    const previous = sentences.at(-1);
    if (
      previous &&
      (!/[\p{L}\p{N}]/u.test(body) ||
        /^\p{Ll}/u.test(body) ||
        unclosedQuote(previous.text) ||
        ABBREVIATION.test(previous.text))
    ) {
      previous.end = end;
      previous.text = squash(text.slice(previous.start, end));
    } else sentences.push({ start, end, text: squash(text.slice(start, end)) });
  }
  if (carry !== null) {
    const previous = sentences.at(-1);
    if (previous) {
      previous.end = text.trimEnd().length;
      previous.text = squash(text.slice(previous.start, previous.end));
    } else {
      const end = text.trimEnd().length;
      sentences.push({ start: carry, end, text: squash(text.slice(carry, end)) });
    }
  }
  return sentences;
}

// Splits sentences so that one ends exactly at `at` (a bold lead-in's end),
// and returns the index of the first sentence after it.
export function breakAt(sentences, text, at) {
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    if (at <= sentence.start) return i;
    if (at >= sentence.end) continue;
    const rest = text.slice(at, sentence.end);
    const restStart = at + rest.length - rest.trimStart().length;
    if (!/[\p{L}\p{N}]/u.test(rest)) return i + 1;
    const head = { start: sentence.start, end: at, text: squash(text.slice(sentence.start, at)) };
    const tail = { start: restStart, end: sentence.end, text: squash(text.slice(restStart, sentence.end)) };
    sentences.splice(i, 1, head, tail);
    return i + 1;
  }
  return sentences.length;
}

export const squash = text =>
  String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();

export const wordCount = text => {
  const words = squash(text);
  if (!words) return 0;
  // Scripts without spaces (Chinese, Japanese) count about two characters a word.
  const cjk = count(words, /[぀-ヿ㐀-鿿가-힯]/g);
  return words.split(' ').length + Math.round(cjk / 2);
};

// About how long a stretch takes to read, in minutes, at an unhurried pace for
// nonfiction.
export const WORDS_PER_MINUTE = 238;
export const minutes = words => Math.max(1, Math.round(words / WORDS_PER_MINUTE));

// FNV-1a, enough to tell whether stored notes belong to this text.
export function fingerprint(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

// A page's address without its fragment and tracking parameters, so the same
// article shared from different places finds the same notes.
const TRACKING = /^(utm_\w+|fbclid|gclid|dclid|mc_cid|mc_eid|ref|ref_src|ref_url|s|igshid|si|smid|cmpid|_hsenc|_hsmi|mkt_tok|source)$/i;
export function canonicalUrl(href) {
  try {
    const url = new URL(href);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.toString().replace(/\?$/, '');
  } catch {
    return String(href);
  }
}
