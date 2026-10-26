/** Values from JSON, catch clauses and optional host APIs enter as unknown. */
export function dataRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function errorMessage(error: unknown): string {
  const message = dataRecord(error).message;
  if (typeof message === 'string') return message;
  if (error === null) return 'null';
  if (error === undefined) return 'undefined';
  if (typeof error === 'string') return error;
  if (typeof error === 'number' || typeof error === 'boolean' || typeof error === 'bigint' || typeof error === 'symbol') return String(error);
  // Never dump arbitrary exception objects: they may contain headers or credentials.
  return scalarText(error);
}

/** Compatibility text conversion for YAML scalars/arrays and diagnostic fields.
 * Plain objects used to render as [object Object]; keep that explicit behaviour. */
export function scalarText(value: unknown, seen = new Set<unknown>()): string {
  if (typeof value === 'string') return value;
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint' || typeof value === 'symbol') return String(value);
  if (Array.isArray(value)) {
    if (seen.has(value)) return '';
    seen.add(value);
    const text = value.map((item: unknown) => item == null ? '' : scalarText(item, seen)).join(',');
    seen.delete(value);
    return text;
  }
  if (value instanceof Date) return value.toString();
  if (value instanceof Error) return value.toString();
  return Object.prototype.toString.call(value) as string;
}
export function errorName(error: unknown): string | undefined {
  const name = dataRecord(error).name;
  return typeof name === 'string' ? name : undefined;
}
export function errorStack(error: unknown): string | undefined {
  const stack = dataRecord(error).stack;
  return typeof stack === 'string' ? stack : undefined;
}
