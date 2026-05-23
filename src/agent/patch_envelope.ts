/**
 * Codex-style `apply_patch` envelope parser + applier.
 * Ported from /codex-rs/apply-patch (parser.rs, seek_sequence.rs) to TypeScript.
 *
 * Envelope grammar:
 *   *** Begin Patch
 *   *** Add File: <path>      +line\n+line\n…
 *   *** Delete File: <path>
 *   *** Update File: <path>   [*** Move to: <newpath>] { hunk+ }
 *   *** End Patch
 *
 * A hunk starts with `@@` (optional header) then has lines prefixed " " (context), "-" (remove),
 * "+" (add). Optional `*** End of File` marker forces anchor to file tail.
 *
 * We do progressive matching: exact → rstrip → trim → unicode-normalised (dashes, quotes,
 * non-breaking spaces). Mirrors codex's seek_sequence lenience.
 */

export type FileOp =
  | { kind: 'add'; path: string; contents: string }
  | { kind: 'delete'; path: string }
  | { kind: 'update'; path: string; movePath?: string; chunks: UpdateChunk[] };

export interface UpdateChunk {
  context: string | null;        // optional @@ header
  oldLines: string[];            // lines (without prefix) that must match in source
  newLines: string[];            // replacement lines
  isEndOfFile: boolean;          // anchor to file tail
}

export class PatchParseError extends Error {
  constructor(public lineNumber: number, msg: string) {
    super(`patch parse error at line ${lineNumber}: ${msg}`);
  }
}

const BEGIN = '*** Begin Patch';
const END   = '*** End Patch';
const ADD   = '*** Add File: ';
const DEL   = '*** Delete File: ';
const UPD   = '*** Update File: ';
const MOVE  = '*** Move to: ';
const EOF_M = '*** End of File';

/** Parse the full envelope string into a list of FileOps. Tolerates leading/trailing
 *  whitespace and stray blank lines outside hunks. */
export function parseEnvelope(input: string): FileOp[] {
  const rawLines = input.replace(/\r\n/g, '\n').split('\n');
  // Trim leading blank lines + BOM
  let i = 0;
  while (i < rawLines.length && rawLines[i].trim() === '') i++;
  if (i >= rawLines.length) throw new PatchParseError(1, 'empty patch');
  if (rawLines[i].trim() !== BEGIN) throw new PatchParseError(i + 1, `expected "${BEGIN}"`);
  i++;

  const ops: FileOp[] = [];
  let sawEnd = false;
  while (i < rawLines.length) {
    const line = rawLines[i];
    if (line.trim() === END) { i++; sawEnd = true; break; }
    if (line.trim() === '') { i++; continue; }

    if (line.startsWith(ADD)) {
      const path = line.slice(ADD.length).trim();
      i++;
      const contentLines: string[] = [];
      while (i < rawLines.length) {
        const l = rawLines[i];
        if (l.trim() === END || l.startsWith(ADD) || l.startsWith(DEL) || l.startsWith(UPD)) break;
        if (l.startsWith('+')) { contentLines.push(l.slice(1)); i++; }
        else if (l.trim() === '') { i++; }
        else throw new PatchParseError(i + 1, `expected "+" line in Add File, got: ${l}`);
      }
      ops.push({ kind: 'add', path, contents: contentLines.join('\n') });
    } else if (line.startsWith(DEL)) {
      ops.push({ kind: 'delete', path: line.slice(DEL.length).trim() });
      i++;
    } else if (line.startsWith(UPD)) {
      const path = line.slice(UPD.length).trim();
      i++;
      let movePath: string | undefined;
      if (i < rawLines.length && rawLines[i].startsWith(MOVE)) {
        movePath = rawLines[i].slice(MOVE.length).trim();
        i++;
      }
      const chunks: UpdateChunk[] = [];
      while (i < rawLines.length) {
        const l = rawLines[i];
        if (l.trim() === END || l.startsWith(ADD) || l.startsWith(DEL) || l.startsWith(UPD)) break;
        if (l.startsWith('@@')) {
          const context = l.slice(2).trim() || null;
          i++;
          const oldLines: string[] = [];
          const newLines: string[] = [];
          let isEof = false;
          while (i < rawLines.length) {
            const c = rawLines[i];
            if (c.trim() === END
              || c.startsWith(ADD) || c.startsWith(DEL) || c.startsWith(UPD) || c.startsWith('@@')) break;
            if (c.trim() === EOF_M) { isEof = true; i++; break; }
            if (c.startsWith('+')) { newLines.push(c.slice(1)); i++; }
            else if (c.startsWith('-')) { oldLines.push(c.slice(1)); i++; }
            else if (c.startsWith(' ')) { oldLines.push(c.slice(1)); newLines.push(c.slice(1)); i++; }
            else if (c === '') {
              // Treat fully-blank line as context (some models drop the leading space)
              oldLines.push(''); newLines.push(''); i++;
            }
            else throw new PatchParseError(i + 1, `unexpected line in hunk: ${c}`);
          }
          chunks.push({ context, oldLines, newLines, isEndOfFile: isEof });
        } else if (l.trim() === '') {
          i++;
        } else {
          throw new PatchParseError(i + 1, `expected "@@" or another header inside Update File: ${l}`);
        }
      }
      if (chunks.length === 0) throw new PatchParseError(i, `Update File: ${path} has no hunks`);
      ops.push({ kind: 'update', path, movePath, chunks });
    } else {
      throw new PatchParseError(i + 1, `expected file header, got: ${line}`);
    }
  }
  if (ops.length === 0) throw new PatchParseError(1, 'patch had no file operations');
  // Refuse silently-truncated envelopes. A model that emits the prefix but
  // gets cut off mid-stream (network drop, output_token cap, idle timeout)
  // would land us here with valid ops but no closing marker — applying that
  // would silently lose the rest of the intended patch. Throw instead so the
  // caller surfaces the issue rather than committing a half-baked diff.
  if (!sawEnd) throw new PatchParseError(rawLines.length, `missing "${END}" marker — envelope appears truncated`);
  return ops;
}

/** Locate `pattern` lines inside `source` with progressive lenience.
 *  Returns 0-based line index of first match, or -1 if none. */
export function seekSequence(source: string[], pattern: string[], start: number, eof: boolean): number {
  if (pattern.length === 0) return start;
  if (pattern.length > source.length) return -1;
  const searchStart = (eof && source.length >= pattern.length) ? source.length - pattern.length : start;

  // 1. exact
  for (let i = searchStart; i <= source.length - pattern.length; i++) {
    let ok = true;
    for (let k = 0; k < pattern.length; k++) {
      if (source[i + k] !== pattern[k]) { ok = false; break; }
    }
    if (ok) return i;
  }
  // 2. rstrip
  const rs = (s: string) => s.replace(/[\s ]+$/, '');
  for (let i = searchStart; i <= source.length - pattern.length; i++) {
    let ok = true;
    for (let k = 0; k < pattern.length; k++) {
      if (rs(source[i + k]) !== rs(pattern[k])) { ok = false; break; }
    }
    if (ok) return i;
  }
  // 3. trim
  const tr = (s: string) => s.trim();
  for (let i = searchStart; i <= source.length - pattern.length; i++) {
    let ok = true;
    for (let k = 0; k < pattern.length; k++) {
      if (tr(source[i + k]) !== tr(pattern[k])) { ok = false; break; }
    }
    if (ok) return i;
  }
  // 4. unicode-normalised (dashes, quotes, NB-space) — same as codex
  const norm = (s: string) => s.trim().replace(/[‐-―−]/g, '-')
                                     .replace(/[‘’‚‛]/g, "'")
                                     .replace(/[“”„‟]/g, '"')
                                     .replace(/[  -   　]/g, ' ');
  for (let i = searchStart; i <= source.length - pattern.length; i++) {
    let ok = true;
    for (let k = 0; k < pattern.length; k++) {
      if (norm(source[i + k]) !== norm(pattern[k])) { ok = false; break; }
    }
    if (ok) return i;
  }
  return -1;
}

/** Apply parsed chunks to source text. Returns the new content.
 *  Throws if any chunk fails to anchor. */
export function applyUpdate(source: string, chunks: UpdateChunk[]): string {
  const srcLines = source.split('\n');
  let cursor = 0;
  // Build output incrementally by copying spans + replacements
  const out: string[] = [];

  for (const chunk of chunks) {
    let searchFrom = cursor;
    // If a context header is provided, jump cursor to first line whose TRIMMED
    // form equals or starts with the context. Previously this used `includes`
    // which made `@@ func foo` match an unrelated line like `// some_foo_name`,
    // landing the hunk at the wrong location and silently corrupting the file.
    if (chunk.context) {
      const needle = chunk.context.trim();
      const ctxIdx = srcLines.findIndex((l, idx) => {
        if (idx < cursor) return false;
        const t = l.trim();
        return t === needle || t.startsWith(needle);
      });
      if (ctxIdx >= 0) searchFrom = ctxIdx;
    }
    const idx = seekSequence(srcLines, chunk.oldLines, searchFrom, chunk.isEndOfFile);
    if (idx < 0) {
      throw new Error(`hunk did not match (${chunk.oldLines.length} lines)${chunk.context ? ` near "${chunk.context}"` : ''}`);
    }
    // Copy unchanged lines before match
    for (let i = cursor; i < idx; i++) out.push(srcLines[i]);
    // Emit replacement
    for (const l of chunk.newLines) out.push(l);
    cursor = idx + chunk.oldLines.length;
  }
  // Tail
  for (let i = cursor; i < srcLines.length; i++) out.push(srcLines[i]);
  return out.join('\n');
}

/** True if the given string looks like a codex envelope (starts with "*** Begin Patch"). */
export function looksLikeEnvelope(s: string): boolean {
  if (typeof s !== 'string') return false;
  return /^\s*\*\*\* Begin Patch/.test(s);
}

/** Per-file preview result. `newText === null` means a Delete File (no after-state). */
export interface EnvelopeFilePreview {
  kind: 'add' | 'update' | 'delete';
  path: string;          // original path
  movePath?: string;     // rename target (Update only)
  oldText: string;       // empty for Add; current content for Update/Delete
  newText: string | null;
  warning?: string;      // hunk failed to anchor, file missing, etc.
}

/** Run an envelope through the parser + applier (read-only) to get per-file before/after.
 *  No filesystem mutation. Used by the approval UI to render diffs. `read(path)` should
 *  return the file's current content or null if it doesn't exist. */
export async function previewEnvelope(
  envelope: string,
  read: (path: string) => Promise<string | null>,
): Promise<{ ops: FileOp[]; files: EnvelopeFilePreview[]; parseError?: string }> {
  let ops: FileOp[];
  try { ops = parseEnvelope(envelope); }
  catch (e: any) { return { ops: [], files: [], parseError: e.message }; }

  const files: EnvelopeFilePreview[] = [];
  for (const op of ops) {
    if (op.kind === 'add') {
      const existing = await read(op.path);
      files.push({
        kind: 'add', path: op.path,
        oldText: existing ?? '',
        newText: op.contents,
        warning: existing != null ? 'file already exists — Add File will fail at apply time' : undefined,
      });
    } else if (op.kind === 'delete') {
      const cur = await read(op.path);
      files.push({
        kind: 'delete', path: op.path,
        oldText: cur ?? '',
        newText: null,
        warning: cur == null ? 'file not found — Delete will fail at apply time' : undefined,
      });
    } else {
      const cur = await read(op.path);
      if (cur == null) {
        files.push({ kind: 'update', path: op.path, movePath: op.movePath, oldText: '', newText: '', warning: 'file not found — Update will fail at apply time' });
        continue;
      }
      try {
        const next = applyUpdate(cur, op.chunks);
        files.push({ kind: 'update', path: op.path, movePath: op.movePath, oldText: cur, newText: next });
      } catch (e: any) {
        files.push({ kind: 'update', path: op.path, movePath: op.movePath, oldText: cur, newText: cur, warning: `hunk did not match — ${e.message}` });
      }
    }
  }
  return { ops, files };
}

/** Human-readable summary of what an envelope does — for the approval card preview. */
export function summarizeOps(ops: FileOp[]): string {
  const lines: string[] = [];
  for (const op of ops) {
    if (op.kind === 'add') lines.push(`+ Add: ${op.path} (${op.contents.split('\n').length} lines)`);
    else if (op.kind === 'delete') lines.push(`- Delete: ${op.path}`);
    else {
      // Count adds/dels by set-difference on lines. The prior implementation
      // ran two `Array.prototype.filter` + nested `includes` per chunk: O(n²)
      // per chunk and quadratic across many-line hunks. Use Sets for O(n).
      let adds = 0, dels = 0;
      for (const c of op.chunks) {
        const oldSet = new Set(c.oldLines);
        const newSet = new Set(c.newLines);
        for (const l of c.newLines) if (!oldSet.has(l)) adds++;
        for (const l of c.oldLines) if (!newSet.has(l)) dels++;
      }
      const move = op.movePath ? ` → ${op.movePath}` : '';
      lines.push(`~ Update: ${op.path}${move} (${op.chunks.length} hunk${op.chunks.length === 1 ? '' : 's'}, +${adds}/-${dels})`);
    }
  }
  return lines.join('\n');
}
