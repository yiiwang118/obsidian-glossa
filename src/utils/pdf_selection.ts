const CONTEXT_CHARS = 96;
const MAX_EDGE_CORRECTION = 3;
const WORD_PATTERN = /[\p{L}\p{M}\p{N}]+(?:['’-][\p{L}\p{M}\p{N}]+)*/gu;
const LATIN_PATTERN = /\p{Script=Latin}/u;

interface WordSpan {
  start: number;
  end: number;
  text: string;
}

function wordSpans(text: string): WordSpan[] {
  return Array.from(text.matchAll(WORD_PATTERN), match => ({
    start: match.index,
    end: match.index + match[0].length,
    text: match[0],
  }));
}

function boundaryPenalty(words: WordSpan[], start: number, end: number): number {
  let penalty = 0;
  if (words.some(word => word.start < start && start < word.end)) penalty += 1;
  if (words.some(word => word.start < end && end < word.end)) penalty += 1;
  return penalty;
}

/**
 * Correct the small text-layer offset drift that can occur in zoomed PDFs.
 * Only nearby Latin word boundaries are considered, and each edge may move by
 * at most a few characters, so phrase selections and non-Latin text stay intact.
 */
export function refinePdfSelectionText(raw: string, before: string, after: string): string {
  if (!raw.trim() || (!before && !after)) return raw;

  const prefix = before.slice(-CONTEXT_CHARS);
  const suffix = after.slice(0, CONTEXT_CHARS);
  const context = `${prefix}${raw}${suffix}`;
  const selectionStart = prefix.length;
  const selectionEnd = selectionStart + raw.length;
  const words = wordSpans(context);
  const intersecting = words.filter(word => word.end > selectionStart && word.start < selectionEnd);
  if (!intersecting.some(word => LATIN_PATTERN.test(word.text))) return raw;

  const substantiallySelected = intersecting.filter(word => {
    const overlap = Math.min(word.end, selectionEnd) - Math.max(word.start, selectionStart);
    return overlap / (word.end - word.start) >= 0.6;
  });
  if (!substantiallySelected.length) return raw;

  const candidateStart = substantiallySelected[0].start;
  const candidateEnd = substantiallySelected[substantiallySelected.length - 1].end;
  const startCorrection = candidateStart - selectionStart;
  const endCorrection = candidateEnd - selectionEnd;
  if (Math.abs(startCorrection) > MAX_EDGE_CORRECTION || Math.abs(endCorrection) > MAX_EDGE_CORRECTION) {
    return raw;
  }
  if (boundaryPenalty(words, candidateStart, candidateEnd) >= boundaryPenalty(words, selectionStart, selectionEnd)) {
    return raw;
  }

  const candidate = context.slice(candidateStart, candidateEnd);
  return candidate.trim() ? candidate : raw;
}

function selectionScope(range: Range): HTMLElement | null {
  const start = range.startContainer.nodeType === Node.ELEMENT_NODE
    ? range.startContainer as HTMLElement
    : range.startContainer.parentElement;
  const end = range.endContainer.nodeType === Node.ELEMENT_NODE
    ? range.endContainer as HTMLElement
    : range.endContainer.parentElement;
  if (!start || !end) return null;

  const textLayer = start.closest<HTMLElement>('.textLayer');
  if (textLayer?.contains(end)) return textLayer;
  const page = start.closest<HTMLElement>('.page[data-page-number]');
  return page?.contains(end) ? page : null;
}

/** Read a PDF selection without changing its native browser Range or highlight. */
export function refinedPdfDomSelectionText(selection: Selection, raw: string): string {
  if (selection.rangeCount === 0) return raw;
  const range = selection.getRangeAt(0);
  const scope = selectionScope(range);
  if (!scope) return raw;

  try {
    const beforeRange = range.cloneRange();
    beforeRange.selectNodeContents(scope);
    beforeRange.setEnd(range.startContainer, range.startOffset);
    const afterRange = range.cloneRange();
    afterRange.selectNodeContents(scope);
    afterRange.setStart(range.endContainer, range.endOffset);
    return refinePdfSelectionText(raw, beforeRange.toString(), afterRange.toString());
  } catch {
    return raw;
  }
}
