import { lineDiff } from './diff';

export interface FileChangeSummary {
  kind: 'created' | 'modified' | 'deleted';
  adds: number | null;
  dels: number | null;
}

function lines(text: string): string[] {
  if (!text) return [];
  const value = text.replace(/\r\n/g, '\n').split('\n');
  if (value[value.length - 1] === '') value.pop();
  return value;
}

/** Large previews are truncated; never present their counts as a complete diff. */
export function summarizeFileChange(before: string | null, after: string | null): FileChangeSummary | null {
  if (before === after) return null;
  const oldLines = lines(before ?? ''), newLines = lines(after ?? '');
  const kind = before === null ? 'created' : after === null ? 'deleted' : 'modified';
  if (!oldLines.length || !newLines.length) return { kind, adds: newLines.length, dels: oldLines.length };
  if (oldLines.length > 2_000 || newLines.length > 2_000) return { kind, adds: null, dels: null };
  const ops = lineDiff(oldLines.join('\n'), newLines.join('\n'));
  return { kind, adds: ops.filter(op => op.type === 'add').length, dels: ops.filter(op => op.type === 'del').length };
}
