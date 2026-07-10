export interface NoteReadOptions {
  startLine?: number;
  endLine?: number;
  maxLines?: number;
}

export interface NoteReadLimits {
  maxChars: number;
  maxLines: number;
  defaultRangeLines: number;
}

export const DEFAULT_NOTE_READ_LIMITS: NoteReadLimits = {
  maxChars: 50_000,
  maxLines: 5_000,
  defaultRangeLines: 200,
};

function positiveInteger(value: number | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
  return value;
}

/** Format exact note source, optionally narrowed to a 1-based inclusive line range. */
export function formatNoteRead(
  path: string,
  text: string,
  options: NoteReadOptions = {},
  limits: NoteReadLimits = DEFAULT_NOTE_READ_LIMITS,
): string {
  const totalLines = text.split('\n').length;
  const header = `Path: ${path}  (${totalLines} lines, ${text.length} chars)`;
  const rangeRequested = options.startLine !== undefined || options.endLine !== undefined || options.maxLines !== undefined;
  if (!rangeRequested) return formatFullRead(header, text, totalLines, limits);

  const startLine = positiveInteger(options.startLine, 'start_line') ?? 1;
  const requestedEnd = positiveInteger(options.endLine, 'end_line');
  const requestedMax = positiveInteger(options.maxLines, 'max_lines') ?? limits.defaultRangeLines;
  if (startLine > totalLines) throw new Error(`start_line ${startLine} is beyond the file's ${totalLines} lines.`);
  if (requestedEnd !== undefined && requestedEnd < startLine) {
    throw new Error('end_line must be greater than or equal to start_line.');
  }
  const endLine = Math.min(requestedEnd ?? startLine + requestedMax - 1, totalLines);
  if (endLine - startLine + 1 > limits.maxLines) {
    throw new Error(`Requested range exceeds the ${limits.maxLines}-line limit.`);
  }

  const selected = text.split('\n').slice(startLine - 1, endLine);
  const returnedLines: string[] = [];
  let usedChars = 0;
  let partialLine = false;
  for (const line of selected) {
    const separatorSize = returnedLines.length > 0 ? 1 : 0;
    if (usedChars + separatorSize + line.length <= limits.maxChars) {
      returnedLines.push(line);
      usedChars += separatorSize + line.length;
      continue;
    }
    if (returnedLines.length === 0) {
      returnedLines.push(line.slice(0, limits.maxChars));
      partialLine = true;
    }
    break;
  }
  const body = returnedLines.join('\n');
  const returnedEnd = startLine + returnedLines.length - 1;
  let truncation = '';
  if (returnedLines.length < selected.length || partialLine) {
    truncation = `\n\n[range truncated at ${limits.maxChars.toLocaleString()} chars${partialLine ? ` within line ${startLine}` : ''}]`;
  }
  const hasMore = returnedEnd < totalLines;
  const rangeHeader = `Range: lines ${startLine}-${returnedEnd} of ${totalLines}; has_more_below=${hasMore}` +
    (hasMore ? `; next_start_line=${returnedEnd + 1}` : '');
  return `${header}\n${rangeHeader}\n\n---\n${body}${truncation}`;
}

function formatFullRead(
  header: string,
  text: string,
  totalLines: number,
  limits: NoteReadLimits,
): string {
  let body = text;
  let truncatedNote = '';
  if (body.length > limits.maxChars) {
    body = body.slice(0, limits.maxChars);
    truncatedNote = `\n\n[truncated at ${limits.maxChars.toLocaleString()} chars - file is ${text.length.toLocaleString()} chars total]`;
  }
  const lines = body.split('\n');
  if (lines.length > limits.maxLines) {
    body = lines.slice(0, limits.maxLines).join('\n');
    truncatedNote = `\n\n[truncated at ${limits.maxLines.toLocaleString()} lines - original had ${totalLines.toLocaleString()} lines]`;
  }
  return `${header}\n\n---\n${body}${truncatedNote}`;
}
