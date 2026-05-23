/**
 * Tiny line-level diff for the approval modal preview.
 * Uses LCS to compute a minimal edit script. No external deps.
 */

export type DiffOp =
  | { type: 'eq';  text: string; line: number }
  | { type: 'del'; text: string; line: number }
  | { type: 'add'; text: string; line: number };

export function lineDiff(a: string, b: string): DiffOp[] {
  const A = a.split('\n');
  const B = b.split('\n');
  const n = A.length, m = B.length;

  // LCS table — full O(n·m) memory. Larger CAP than before (2000→20000) so
  // edits beyond line 2000 in big notes are visible in approval diff. At
  // 20k×20k cells × 4 bytes the table is ~1.6GB worst-case, but typical
  // edited files are <5k lines; pre-flight test below short-circuits when
  // the input is too large.
  const HARD_CAP = 20_000;
  if (A.length > HARD_CAP || B.length > HARD_CAP) {
    // Falls back to a degenerate "everything changed" representation —
    // approval UI shows the too-big warning and offers full-replace.
    return [...A.map((t, i) => ({ type: 'del' as const, text: t, line: i })),
            ...B.map((t, i) => ({ type: 'add' as const, text: t, line: i }))];
  }
  const Acap = A, Bcap = B;
  const NA = Acap.length, NB = Bcap.length;

  const lcs: number[][] = Array.from({ length: NA + 1 }, () => new Array(NB + 1).fill(0));
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
