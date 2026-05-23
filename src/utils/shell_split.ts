/**
 * Minimal POSIX-ish shell argument splitter. Honors:
 * - single quotes (literal, no escapes)
 * - double quotes (allows \" \\ \$)
 * - backslash-escaped characters outside quotes
 * - whitespace as separator
 *
 * Not a full shell — no globbing, no variables, no command substitution.
 * Good enough for MCP server `args` config where users need quoted paths or JSON.
 */
export function shellSplit(input: string): string[] {
  const out: string[] = [];
  let cur = '';
  let i = 0;
  const n = input.length;
  let inSingle = false, inDouble = false;
  while (i < n) {
    const c = input[i];
    if (inSingle) {
      if (c === "'") { inSingle = false; i++; continue; }
      cur += c; i++; continue;
    }
    if (inDouble) {
      if (c === '\\' && i + 1 < n && /["\\$`]/.test(input[i + 1])) { cur += input[i + 1]; i += 2; continue; }
      if (c === '"') { inDouble = false; i++; continue; }
      cur += c; i++; continue;
    }
    if (c === "'") { inSingle = true; i++; continue; }
    if (c === '"') { inDouble = true; i++; continue; }
    if (c === '\\' && i + 1 < n) { cur += input[i + 1]; i += 2; continue; }
    if (/\s/.test(c)) { if (cur) { out.push(cur); cur = ''; } i++; continue; }
    cur += c; i++;
  }
  if (cur) out.push(cur);
  return out;
}
