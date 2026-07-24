export type TextMatchMode = 'exact' | 'normalized' | 'fuzzy';

export interface TextEditOperation {
  oldText: string;
  newText: string;
  replaceAll?: boolean;
  anchor?: 'any' | 'end';
}

export interface AppliedTextEdit {
  operationIndex: number;
  mode: TextMatchMode;
  replacements: number;
  confidence?: number;
}

export interface TextDocumentFormat {
  bom: boolean;
  eol: '\n' | '\r\n' | '\r';
  trailingNewlines: number;
}

export type TextEditResult =
  | { ok: true; content: string; edits: AppliedTextEdit[]; fingerprint: string; format: TextDocumentFormat }
  | { ok: false; error: string; operationIndex?: number; candidates?: number };

interface MatchRange {
  start: number;
  end: number;
  mode: TextMatchMode;
  confidence?: number;
}

interface NormalizedText {
  text: string;
  starts: number[];
  ends: number[];
}

const FUZZY_MIN_LENGTH = 24;
const FUZZY_MIN_CONFIDENCE = 0.965;
const FUZZY_MIN_MARGIN = 0.04;

export function inspectTextFormat(source: string): { body: string; format: TextDocumentFormat } {
  const bom = source.startsWith('\uFEFF');
  const raw = bom ? source.slice(1) : source;
  const crlf = (raw.match(/\r\n/g) ?? []).length;
  const withoutCrlf = raw.replace(/\r\n/g, '');
  const lf = (withoutCrlf.match(/\n/g) ?? []).length;
  const cr = (withoutCrlf.match(/\r/g) ?? []).length;
  const eol: TextDocumentFormat['eol'] = crlf >= lf && crlf >= cr && crlf > 0
    ? '\r\n'
    : (cr > lf && cr > 0 ? '\r' : '\n');
  const body = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const trailingNewlines = body.length - body.replace(/\n+$/, '').length;
  return { body, format: { bom, eol, trailingNewlines } };
}

export function restoreTextFormat(body: string, format: TextDocumentFormat): string {
  const withoutTrailing = body.replace(/\n+$/, '');
  const normalized = withoutTrailing + '\n'.repeat(format.trailingNewlines);
  const withEol = format.eol === '\n' ? normalized : normalized.replace(/\n/g, format.eol);
  return `${format.bom ? '\uFEFF' : ''}${withEol}`;
}

/** Deterministic snapshot fingerprint used for stale-content checks. */
export function textFingerprint(text: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    first ^= code;
    first = Math.imul(first, 0x01000193);
    second ^= code + i;
    second = Math.imul(second, 0x85ebca6b);
  }
  return `${text.length.toString(36)}-${(first >>> 0).toString(36)}-${(second >>> 0).toString(36)}`;
}

export function normalizeTextForMatch(value: string): string {
  return normalizeCharacters(value)
    .replace(/[ \t]+(?=\n|$)/g, '');
}

function normalizeCharacters(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ');
}

function normalizeWithMap(value: string): NormalizedText {
  const chars: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  for (let i = 0; i < value.length;) {
    const codePoint = value.codePointAt(i);
    if (codePoint === undefined) break;
    const sourceChar = String.fromCodePoint(codePoint);
    let sourceEnd = i + sourceChar.length;
    while (sourceEnd < value.length) {
      const nextCodePoint = value.codePointAt(sourceEnd);
      if (nextCodePoint === undefined) break;
      const nextChar = String.fromCodePoint(nextCodePoint);
      if (!/\p{M}/u.test(nextChar)) break;
      sourceEnd += nextChar.length;
    }
    const normalized = normalizeCharacters(value.slice(i, sourceEnd));
    for (const outputChar of normalized) {
      chars.push(outputChar);
      starts.push(i);
      ends.push(sourceEnd);
    }
    i = sourceEnd;
  }

  const keptChars: string[] = [];
  const keptStarts: number[] = [];
  const keptEnds: number[] = [];
  for (let i = 0; i < chars.length;) {
    if (chars[i] === ' ' || chars[i] === '\t') {
      let end = i + 1;
      while (end < chars.length && (chars[end] === ' ' || chars[end] === '\t')) end++;
      if (end === chars.length || chars[end] === '\n') {
        i = end;
        continue;
      }
      for (; i < end; i++) {
        keptChars.push(chars[i]);
        keptStarts.push(starts[i]);
        keptEnds.push(ends[i]);
      }
      continue;
    }
    keptChars.push(chars[i]);
    keptStarts.push(starts[i]);
    keptEnds.push(ends[i]);
    i++;
  }
  return { text: keptChars.join(''), starts: keptStarts, ends: keptEnds };
}

function allLiteralMatches(haystack: string, needle: string): MatchRange[] {
  if (!needle) return [];
  const matches: MatchRange[] = [];
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) break;
    matches.push({ start: index, end: index + needle.length, mode: 'exact' });
    from = index + Math.max(1, needle.length);
  }
  return matches;
}

function allNormalizedMatches(haystack: string, needle: string): MatchRange[] {
  const mapped = normalizeWithMap(haystack);
  const normalizedNeedle = normalizeTextForMatch(needle);
  if (!normalizedNeedle) return [];
  const matches: MatchRange[] = [];
  let from = 0;
  while (from <= mapped.text.length - normalizedNeedle.length) {
    const index = mapped.text.indexOf(normalizedNeedle, from);
    if (index < 0) break;
    const last = index + normalizedNeedle.length - 1;
    matches.push({ start: mapped.starts[index], end: mapped.ends[last], mode: 'normalized' });
    from = index + normalizedNeedle.length;
  }
  return dedupeRanges(matches);
}

function dedupeRanges(matches: MatchRange[]): MatchRange[] {
  const seen = new Set<string>();
  return matches.filter(match => {
    const key = `${match.start}:${match.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function lineWindows(text: string, lineCount: number): { start: number; end: number; text: string }[] {
  const lines = text.split('\n');
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  const windows: { start: number; end: number; text: string }[] = [];
  for (let i = 0; i + lineCount <= lines.length; i++) {
    const endLine = i + lineCount - 1;
    const start = starts[i];
    const end = starts[endLine] + lines[endLine].length;
    windows.push({ start, end, text: text.slice(start, end) });
  }
  return windows;
}

function comparableForFuzzy(value: string): string {
  return normalizeTextForMatch(value).replace(/\s+/g, ' ').trim();
}

function bigramDice(left: string, right: string): number {
  if (left === right) return 1;
  if (left.length < 2 || right.length < 2) return 0;
  const counts = new Map<string, number>();
  for (let i = 0; i < left.length - 1; i++) {
    const gram = left.slice(i, i + 2);
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  let intersection = 0;
  for (let i = 0; i < right.length - 1; i++) {
    const gram = right.slice(i, i + 2);
    const count = counts.get(gram) ?? 0;
    if (count > 0) {
      intersection++;
      counts.set(gram, count - 1);
    }
  }
  return (2 * intersection) / (left.length + right.length - 2);
}

function fuzzyMatch(haystack: string, needle: string): MatchRange | null {
  const target = comparableForFuzzy(needle);
  if (target.length < FUZZY_MIN_LENGTH) return null;
  const lineCount = Math.max(1, needle.replace(/\r\n?/g, '\n').split('\n').length);
  const ranked = lineWindows(haystack, lineCount)
    .map(window => ({ ...window, score: bigramDice(comparableForFuzzy(window.text), target) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const second = ranked[1];
  if (!best || best.score < FUZZY_MIN_CONFIDENCE) return null;
  if (second && best.score - second.score < FUZZY_MIN_MARGIN) return null;
  return { start: best.start, end: best.end, mode: 'fuzzy', confidence: best.score };
}

function locate(body: string, operation: TextEditOperation): { matches: MatchRange[]; candidates?: number } {
  const oldBody = operation.oldText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  let matches = allLiteralMatches(body, oldBody);
  if (operation.anchor === 'end') matches = matches.filter(match => match.end === body.replace(/\n+$/, '').length);
  if (matches.length > 0) return { matches };

  matches = allNormalizedMatches(body, oldBody);
  if (operation.anchor === 'end') matches = matches.filter(match => match.end === body.replace(/\n+$/, '').length);
  if (matches.length > 0) return { matches };

  if (operation.replaceAll) return { matches: [] };
  const fuzzy = fuzzyMatch(body, oldBody);
  if (!fuzzy || (operation.anchor === 'end' && fuzzy.end !== body.replace(/\n+$/, '').length)) return { matches: [] };
  return { matches: [fuzzy], candidates: 1 };
}

export function applyTextEdits(source: string, operations: TextEditOperation[]): TextEditResult {
  const { body, format } = inspectTextFormat(source);
  if (operations.length === 0) return { ok: false, error: 'No edits were provided.' };

  const replacements: { start: number; end: number; replacement: string; operationIndex: number; match: MatchRange }[] = [];
  const applied: AppliedTextEdit[] = [];
  for (let operationIndex = 0; operationIndex < operations.length; operationIndex++) {
    const operation = operations[operationIndex];
    if (!operation.oldText) return { ok: false, error: 'Search text must be non-empty.', operationIndex };
    if (operation.oldText === operation.newText) return { ok: false, error: 'Search and replacement text are identical.', operationIndex };
    const located = locate(body, operation);
    if (located.matches.length === 0) {
      return { ok: false, error: 'Search text was not found with a safe match.', operationIndex };
    }
    if (located.matches.length > 1 && !operation.replaceAll) {
      return {
        ok: false,
        error: `Search text matches ${located.matches.length} locations; provide more context or set replaceAll.`,
        operationIndex,
        candidates: located.matches.length,
      };
    }
    const selected = operation.replaceAll ? located.matches : [located.matches[0]];
    const modes = new Set(selected.map(match => match.mode));
    if (modes.size !== 1) return { ok: false, error: 'Edit resolved with inconsistent match modes.', operationIndex };
    const replacement = operation.newText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    for (const match of selected) {
      replacements.push({ start: match.start, end: match.end, replacement, operationIndex, match });
    }
    applied.push({
      operationIndex,
      mode: selected[0].mode,
      replacements: selected.length,
      confidence: selected[0].confidence,
    });
  }

  const ordered = [...replacements].sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i].start < ordered[i - 1].end) {
      return {
        ok: false,
        error: `Edit ${ordered[i].operationIndex + 1} overlaps edit ${ordered[i - 1].operationIndex + 1}; no changes were applied.`,
        operationIndex: ordered[i].operationIndex,
      };
    }
  }

  let next = body;
  for (const item of ordered.sort((a, b) => b.start - a.start)) {
    next = next.slice(0, item.start) + item.replacement + next.slice(item.end);
  }
  return {
    ok: true,
    content: restoreTextFormat(next, format),
    edits: applied,
    fingerprint: textFingerprint(source),
    format,
  };
}

export function describeTextMatches(edits: AppliedTextEdit[]): string {
  return edits.map(edit => {
    const confidence = edit.confidence === undefined ? '' : ` ${(edit.confidence * 100).toFixed(1)}%`;
    return `edit ${edit.operationIndex + 1}: ${edit.mode}${confidence}, ${edit.replacements} replacement${edit.replacements === 1 ? '' : 's'}`;
  }).join('; ');
}

export const TextEditEngine = {
  apply: applyTextEdits,
  describeMatches: describeTextMatches,
  fingerprint: textFingerprint,
  inspectFormat: inspectTextFormat,
  normalizeForMatch: normalizeTextForMatch,
  restoreFormat: restoreTextFormat,
};
