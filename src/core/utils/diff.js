// Word diff for revision compare — dependency-free, browser + Node.
// Strategy: split text into blocks (lines), LCS-match blocks, then word-diff only
// inside changed block pairs. Keeps memory bounded for long articles while still
// showing word-level changes where they happened.
import { escapeHtml, stripTags } from './utils.js';

const MAX_CELLS = 2_000_000; // LCS DP cap per comparison (~8 MB); beyond it, degrade gracefully

function lcsOps(a, b) {
  // Returns op list: { t: 'same'|'del'|'add', x } over indices into a/b.
  const n = a.length, m = b.length;
  if (n * m > MAX_CELLS) {
    // Degrade: treat whole span as replaced rather than allocating a huge matrix.
    const ops = [];
    if (n || m) {
      if (n) ops.push({ t: 'del', ax: 0, bx: -1, n });
      if (m) ops.push({ t: 'add', ax: -1, bx: 0, n: m });
    }
    return { ops, capped: true };
  }
  const w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = a[i] === b[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ t: 'same', ax: i, bx: j, n: 1 }); i++; j++; }
    else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) { ops.push({ t: 'del', ax: i, bx: -1, n: 1 }); i++; }
    else { ops.push({ t: 'add', ax: -1, bx: j, n: 1 }); j++; }
  }
  while (i < n) { ops.push({ t: 'del', ax: i, bx: -1, n: 1 }); i++; }
  while (j < m) { ops.push({ t: 'add', ax: -1, bx: j, n: 1 }); j++; }
  return { ops, capped: false };
}

function splitBlocks(text) {
  return String(text ?? '').split(/\n+/).map((s) => s.trim()).filter(Boolean);
}

function splitWords(text) {
  return String(text ?? '').split(/(\s+)/).filter((s) => s.length > 0);
}

export function diffRevision(oldContent, newContent) {
  // Compares rendered text (tags stripped — formatting churn is not content churn).
  const oldBlocks = splitBlocks(stripTags(oldContent));
  const newBlocks = splitBlocks(stripTags(newContent));
  const { ops, capped } = lcsOps(oldBlocks, newBlocks);
  const segments = []; // { type: 'same'|'add'|'del', text }
  let added = 0, removed = 0;
  let i = 0;
  const flushWordDiff = (delBlocks, addBlocks) => {
    const ow = splitWords(delBlocks.join('\n'));
    const nw = splitWords(addBlocks.join('\n'));
    const { ops: wops } = lcsOps(ow, nw);
    for (const o of wops) {
      const slice = (arr, at, n) => arr.slice(at, at + n).join('');
      if (o.t === 'same') segments.push({ type: 'same', text: slice(ow, o.ax, o.n) });
      else if (o.t === 'del') { segments.push({ type: 'del', text: slice(ow, o.ax, o.n) }); removed += o.n; }
      else { segments.push({ type: 'add', text: slice(nw, o.bx, o.n) }); added += o.n; }
    }
  };
  while (i < ops.length) {
    const o = ops[i];
    if (o.t === 'same') { segments.push({ type: 'same', text: oldBlocks[o.ax] + '\n' }); i++; continue; }
    const dels = [], adds = [];
    while (i < ops.length && ops[i].t !== 'same') {
      const q = ops[i];
      if (q.t === 'del') dels.push(oldBlocks[q.ax]);
      else adds.push(newBlocks[q.bx]);
      i++;
    }
    // Whitespace-only runs of same text would false-positive; word-diff handles the rest.
    flushWordDiff(dels, adds);
  }
  return { segments, added, removed, capped, empty: segments.length === 0 };
}

export function renderDiff(segments) {
  // Renders segments to safe HTML: additions green, deletions red-strike. All
  // source text is escaped — diff output can never inject markup.
  return segments.map((s) => {
    const t = escapeHtml(s.text).replace(/\n/g, '<br>');
    if (s.type === 'add') return `<ins>${t}</ins>`;
    if (s.type === 'del') return `<del>${t}</del>`;
    return `<span>${t}</span>`;
  }).join('');
}
