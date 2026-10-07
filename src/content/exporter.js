// Taking the reading with you: the supercut, the outline, or the whole article
// as Markdown, to copy or to send to Obsidian as a new note.
import { squash } from './text.js';

const escape = text => text.replace(/([\\`*_[\]])/g, '\\$1');

// Inline content as Markdown, skipping Spine's own pills and footnote markers.
function inline(node, { skipHidden = false } = {}) {
  let out = '';
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      out += escape(child.data.replace(/\s+/g, ' '));
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    if (child.matches('.pill, sup.fn, .anchor, .carousel-icon')) continue;
    if (skipHidden && child.matches('.h, .hb')) continue;
    const content = inline(child, { skipHidden });
    switch (child.nodeName) {
      case 'STRONG':
        out += content.trim() ? `**${content.trim()}**` : content;
        break;
      case 'EM':
        out += content.trim() ? `*${content.trim()}*` : content;
        break;
      case 'CODE':
        out += `\`${child.textContent}\``;
        break;
      case 'A':
        out += child.getAttribute('href')?.startsWith('#') ? content : `[${content.trim()}](${child.href})`;
        break;
      case 'BR':
        out += '  \n';
        break;
      case 'IMG':
        out += child.src ? `![${escape(child.alt || '')}](${child.dataset.full || child.src})` : '';
        break;
      case 'UL':
      case 'OL':
        break;
      default:
        out += content;
    }
  }
  return out;
}

function list(element, depth = 0) {
  const items = [...element.children].filter(child => child.nodeName === 'LI');
  return items
    .map((item, index) => {
      const marker = element.nodeName === 'OL' ? `${(Number(element.getAttribute('start')) || 1) + index}.` : '-';
      const nested = [...item.children]
        .filter(child => child.nodeName === 'UL' || child.nodeName === 'OL')
        .map(child => list(child, depth + 1))
        .join('\n');
      const line = `${'  '.repeat(depth)}${marker} ${inline(item).trim()}`;
      return nested ? `${line}\n${nested}` : line;
    })
    .join('\n');
}

// The whole article, from the reader's own blocks.
export function articleMarkdown(article) {
  const out = [];
  for (const section of article.sections) {
    if (section.headingEl && !section.synthetic) out.push(`## ${squash(section.heading)}`);
    for (const element of section.body.children) out.push(block(element));
  }
  return out.filter(Boolean).join('\n\n');
}

function block(element) {
  switch (element.nodeName) {
    case 'P':
      return inline(element).trim();
    case 'H3':
      return `### ${squash(element.textContent)}`;
    case 'H4':
      return `#### ${squash(element.textContent)}`;
    case 'UL':
    case 'OL':
      return list(element);
    case 'BLOCKQUOTE':
      return [...element.children]
        .map(child => block(child))
        .filter(Boolean)
        .join('\n\n')
        .split('\n')
        .map(line => `> ${line}`)
        .join('\n');
    case 'PRE':
      return `\`\`\`\n${element.textContent}\n\`\`\``;
    case 'FIGURE': {
      const images = [...element.querySelectorAll('img')]
        .map(img => `![${escape(img.alt || '')}](${img.dataset.full || img.src})`)
        .join('\n');
      const caption = element.querySelector('figcaption');
      return [images, caption ? `*${squash(caption.textContent)}*` : ''].filter(Boolean).join('\n');
    }
    case 'HR':
      return '---';
    case 'DIV':
      if (element.classList.contains('table-wrap')) {
        const rows = [...element.querySelectorAll('tr')].map(
          row => `| ${[...row.children].map(cell => squash(cell.textContent).replace(/\|/g, '\\|')).join(' | ')} |`,
        );
        if (rows.length > 1) rows.splice(1, 0, `|${' --- |'.repeat(rows[0].split(' | ').length)}`);
        return rows.join('\n');
      }
      if (element.classList.contains('regroup') || element.classList.contains('regrouped') || element.classList.contains('carousel')) {
        return '';
      }
      return inline(element).trim();
    default:
      return '';
  }
}

// The supercut: the key sentences in order, with each folded run shown as its
// bridge in brackets, or an ellipsis.
export function supercutMarkdown(article, runs, bridges, bridgesOn) {
  const runBySentence = new Map();
  for (const run of runs) for (const sentence of run.hidden) runBySentence.set(sentence.id, run);
  const out = [];
  for (const section of article.sections) {
    if (section.headingEl) out.push(`## ${squash(section.heading)}`);
    let paragraph = [];
    const flush = (prefix = '') => {
      const text = paragraph.join(' ').replace(/\s+/g, ' ').trim();
      if (text) out.push(prefix + text);
      paragraph = [];
    };
    for (const block of section.blocks) {
      const prefix = block.kind === 'li' ? '- ' : block.kind === 'quote' ? '> ' : '';
      let lastRun = null;
      for (const sentence of block.sentences) {
        const run = runBySentence.get(sentence.id);
        if (!run) {
          paragraph.push(sentence.lead ? `**${escape(sentence.text)}**` : escape(sentence.text));
          lastRun = null;
          continue;
        }
        if (run === lastRun) continue;
        lastRun = run;
        // A run that continues from an earlier paragraph was already noted.
        if (run.hidden[0] !== sentence) continue;
        const bridge = bridgesOn && bridges[run.key];
        paragraph.push(bridge ? `*[${escape(bridge)}]*` : '…');
      }
      flush(prefix);
    }
  }
  return out.join('\n\n');
}

export function outlineMarkdown(article, summaries) {
  const out = [];
  for (const section of article.sections) {
    const summary = summaries.get(section.index);
    if (!summary && !section.headingEl) continue;
    out.push(`## ${squash(section.heading)}`);
    if (summary) out.push(summary);
  }
  return out.join('\n\n');
}

export function header(meta) {
  const lines = [`# ${meta.title}`, ''];
  const by = [meta.byline, meta.siteName, meta.published].filter(Boolean).join(' · ');
  if (by) lines.push(`*${by}*`);
  lines.push(`Source: ${meta.url}`);
  return lines.join('\n');
}

export function obsidianNote(article, { outline, supercut }) {
  const meta = article.meta;
  const quote = value => `"${String(value ?? '').replace(/"/g, '\\"')}"`;
  const today = new Date().toISOString().slice(0, 10);
  const front = [
    '---',
    `title: ${quote(meta.title)}`,
    meta.byline ? `author: ${quote(meta.byline)}` : null,
    `source: ${quote(meta.url)}`,
    `site: ${quote(meta.siteName)}`,
    meta.published ? `published: ${quote(meta.published)}` : null,
    `clipped: ${today}`,
    `words: ${article.words}`,
    'tags: [clippings, spine]',
    '---',
  ].filter(Boolean);
  const parts = [front.join('\n'), header(meta)];
  if (outline) parts.push('## Outline', outline.replace(/^## /gm, '### '));
  if (supercut) parts.push('## Supercut', supercut.replace(/^## /gm, '### '));
  if (!outline && !supercut) parts.push(articleMarkdown(article));
  return parts.join('\n\n');
}

export function openInObsidian(markdown, title, { vault, folder }) {
  const name = squash(title)
    .replace(/[\\/:*?"<>|#^[\]]/g, '')
    .slice(0, 120)
    .trim() || 'Spine clipping';
  const file = folder ? `${folder.replace(/\/+$/, '')}/${name}` : name;
  const params = new URLSearchParams();
  if (vault) params.set('vault', vault);
  params.set('file', file);
  params.set('content', markdown);
  const url = `obsidian://new?${params.toString().replace(/\+/g, '%20')}`;
  const link = document.createElement('a');
  link.href = url;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
}
