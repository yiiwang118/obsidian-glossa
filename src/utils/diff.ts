/**
 * Tiny line-level diff for the approval modal preview.
 * Uses LCS for modest files and falls back to a bounded preview for large edits.
 */

export type DiffOp =
  | { type: 'eq';  text: string; line: number }
  | { type: 'del'; text: string; line: number }
  | { type: 'add'; text: string; line: number };

const EXACT_DIFF_MAX_LINES = 2_000;
const EXACT_DIFF_MAX_CELLS = EXACT_DIFF_MAX_LINES * EXACT_DIFF_MAX_LINES;
const FALLBACK_PREVIEW_LINES = 160;

export function lineDiff(a: string, b: string): DiffOp[] {
  const A = a.split('\n');
  const B = b.split('\n');
  const n = A.length, m = B.length;

  if (!exactDiffFeasible(n, m)) return largeDiffPreview(A, B);
  const Acap = A, Bcap = B;
  const NA = Acap.length, NB = Bcap.length;

  const lcs: Uint16Array[] = Array.from({ length: NA + 1 }, () => new Uint16Array(NB + 1));
  for (let i = NA - 1; i >= 0; i--) {
    for (let j = NB - 1; j >= 0; j--) {
      lcs[i][j] = Acap[i] === Bcap[j] ? lcs[i + 1][j + 1] + 1
                                      : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0, j = 0;
  while (i < NA && j < NB) {
    if (Acap[i] === Bcap[j]) { ops.push({ type: 'eq', text: Acap[i], line: i }); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { ops.push({ type: 'del', text: Acap[i], line: i }); i++; }
    else { ops.push({ type: 'add', text: Bcap[j], line: j }); j++; }
  }
  while (i < NA) { ops.push({ type: 'del', text: Acap[i], line: i }); i++; }
  while (j < NB) { ops.push({ type: 'add', text: Bcap[j], line: j }); j++; }
  return ops;
}


export function diffToHtml(a: string, b: string): string {
  const ops = lineDiff(a, b);
  const html: string[] = [];
  for (const op of ops) {
    const escaped = escapeHtml(op.text);
    if (op.type === 'add') html.push(`<div class="nc-diff-line add">+ ${escaped || '&nbsp;'}</div>`);
    else if (op.type === 'del') html.push(`<div class="nc-diff-line del">- ${escaped || '&nbsp;'}</div>`);
    else html.push(`<div class="nc-diff-line eq">  ${escaped || '&nbsp;'}</div>`);
  }
  return html.join('');
}

/** Apply diff with per-line selection: accepted=true rebuilds the new content using only
 *  approved adds + rejected dels (rejected dels stay as eq). */
export function applySelectedDiff(a: string, b: string, accepts: Map<number, boolean>): string {
  const oldLines = a.split('\n').length;
  const newLines = b.split('\n').length;
  if (!exactDiffFeasible(oldLines, newLines)) return b;
  const ops = lineDiff(a, b);
  const out: string[] = [];
  let opIdx = 0;
  for (const op of ops) {
    const idx = opIdx++;
    const accepted = accepts.get(idx) ?? true;
    if (op.type === 'eq') out.push(op.text);
    else if (op.type === 'add') { if (accepted) out.push(op.text); }
    else if (op.type === 'del') { if (!accepted) out.push(op.text); /* keep if rejected */ }
  }
  return out.join('\n');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string)
  );
}

function exactDiffFeasible(oldLines: number, newLines: number): boolean {
  return oldLines <= EXACT_DIFF_MAX_LINES &&
    newLines <= EXACT_DIFF_MAX_LINES &&
    oldLines * newLines <= EXACT_DIFF_MAX_CELLS;
}

function largeDiffPreview(oldLines: string[], newLines: string[]): DiffOp[] {
  const out: DiffOp[] = [{
    type: 'eq',
    text: `[diff too large for exact preview: ${oldLines.length.toLocaleString()} -> ${newLines.length.toLocaleString()} lines; showing first ${FALLBACK_PREVIEW_LINES} removed and added lines]`,
    line: 0,
  }];
  const oldShown = oldLines.slice(0, FALLBACK_PREVIEW_LINES);
  for (let i = 0; i < oldShown.length; i++) out.push({ type: 'del', text: oldShown[i], line: i });
  if (oldLines.length > oldShown.length) {
    out.push({ type: 'eq', text: `[${(oldLines.length - oldShown.length).toLocaleString()} removed lines hidden]`, line: oldShown.length });
  }
  const newShown = newLines.slice(0, FALLBACK_PREVIEW_LINES);
  for (let i = 0; i < newShown.length; i++) out.push({ type: 'add', text: newShown[i], line: i });
  if (newLines.length > newShown.length) {
    out.push({ type: 'eq', text: `[${(newLines.length - newShown.length).toLocaleString()} added lines hidden]`, line: newShown.length });
  }
  return out;
}
