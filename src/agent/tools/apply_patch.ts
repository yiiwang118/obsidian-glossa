import { TFile } from 'obsidian';
import { parseEnvelope, applyUpdate, looksLikeEnvelope, summarizeOps, seekSequence, type FileOp } from '../patch_envelope';
import { assertVaultPath, buildTool, vaultFolderOf, type ToolImpl } from './_shared';

export const applyPatch: ToolImpl = buildTool({
  isReadOnly: () => false,
  isDestructive: () => true,
  isConcurrencySafe: () => false,
  searchHint: 'multi-file codex envelope patch',
  describe: a => {
    if (typeof a.patch === 'string' && looksLikeEnvelope(a.patch)) {
      try {
        const ops = parseEnvelope(a.patch);
        if (ops.length === 1) {
          const op = ops[0];
          const p = op.kind === 'update' && op.movePath ? `${op.path} → ${op.movePath}`
                  : (op as any).path;
          return `patch ${p} (${op.kind === 'update' ? `${op.chunks.length}h` : op.kind})`;
        }
        return `patch envelope (${ops.length} files)`;
      } catch { return 'apply_patch (envelope, parse error)'; }
    }
    return `patch ${a.path} (${(a.edits ?? []).length} edits)`;
  },
  preview: async (app, a: any) => {
    if (typeof a.patch === 'string' && looksLikeEnvelope(a.patch)) {
      try {
        const ops = parseEnvelope(a.patch);
        const lines: string[] = [summarizeOps(ops), ''];
        for (const op of ops) {
          if (op.kind === 'update') {
            const f = app.vault.getAbstractFileByPath(op.path);
            if (!(f instanceof TFile)) { lines.push(`✗ ${op.path}: file not found`); continue; }
            const text = await app.vault.read(f);
            const srcLines = text.split('\n');
            for (let h = 0; h < op.chunks.length; h++) {
              const c = op.chunks[h];
              const idx = seekSequence(srcLines, c.oldLines, 0, c.isEndOfFile);
              lines.push(`hunk ${h + 1}${c.context ? ` @ ${c.context}` : ''}: ${idx >= 0 ? `✓ matched at line ${idx + 1}` : '✗ NOT MATCHED'}`);
            }
          }
        }
        return lines.join('\n');
      } catch (e: any) {
        return `Envelope parse error: ${e.message}`;
      }
    }
    const f = app.vault.getAbstractFileByPath(a.path);
    if (!(f instanceof TFile)) return `(file not found: ${a.path})`;
    const text = await app.vault.read(f);
    const lines: string[] = [`File: ${a.path}\n`];
    for (let i = 0; i < (a.edits ?? []).length; i++) {
      const ed = a.edits[i];
      const found = text.includes(ed.search);
      lines.push(`Edit ${i + 1} ${found ? '✓' : '✗ NOT MATCHED'}:`);
      lines.push(`  - ${ed.search.slice(0, 200)}`);
      lines.push(`  + ${ed.replace.slice(0, 200)}`);
      lines.push('');
    }
    return lines.join('\n');
  },
  spec: {
    name: 'apply_patch',
    description: [
      'Apply edits to one or more notes. TWO input modes:',
      '',
      '(A) ENVELOPE (preferred for multi-file or context-anchored edits) — pass a single `patch` string in codex format:',
      '    *** Begin Patch',
      '    *** Update File: path/to/note.md',
      '    @@ optional context (e.g. heading text)',
      '     unchanged context line',
      '    -old line',
      '    +new line',
      '     unchanged context line',
      '    *** End Patch',
      '  Supports *** Add File:, *** Delete File:, *** Update File: (with optional *** Move to:).',
      '  Each hunk: 3 lines of context above/below, "-" removes, "+" adds, " " keeps. Context must uniquely anchor.',
      '',
      '(B) LEGACY (single-file simple replace) — pass `path` + `edits: [{search, replace}, …]`. "search" must match exactly once.',
      '',
      'Prefer (A) for any non-trivial edit. REQUIRES USER APPROVAL.'
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        patch: { type: 'string', description: 'Full envelope text (mode A).' },
        path: { type: 'string', description: 'Target file path (mode B only).' },
        edits: {
          type: 'array',
          description: 'Array of { search, replace } edits applied in order (mode B only).',
          items: {
            type: 'object',
            properties: {
              search: { type: 'string', description: 'Exact unique text to find.' },
              replace: { type: 'string', description: 'Replacement text.' },
            },
            required: ['search', 'replace'],
          },
        },
      },
    },
  },
  run: async (app, args) => {
    if (typeof args.patch === 'string' && looksLikeEnvelope(args.patch)) {
      let ops: FileOp[];
      try { ops = parseEnvelope(args.patch); }
      catch (e: any) { return `Error: ${e.message}`; }
      // Pre-validate every path in the envelope before applying anything.
      // Bail before the first write so we don't half-apply a patch when one
      // hunk references a hostile path.
      for (const op of ops) {
        try { assertVaultPath((op as any).path); }
        catch (e: any) { return `Error: ${op.kind} has invalid path — ${e.message}`; }
        if (op.kind === 'update' && op.movePath) {
          try { assertVaultPath(op.movePath, 'move target'); }
          catch (e: any) { return `Error: ${op.kind} → move target invalid — ${e.message}`; }
        }
      }
      const touched: string[] = [];
      for (const op of ops) {
        try {
          if (op.kind === 'add') {
            const folder = vaultFolderOf(op.path);
            if (folder) try { await app.vault.createFolder(folder); } catch { /* ignore */ }
            if (app.vault.getAbstractFileByPath(op.path)) return `Error: Add File: ${op.path} already exists.`;
            await app.vault.create(op.path, op.contents);
            touched.push(`+${op.path}`);
          } else if (op.kind === 'delete') {
            const f = app.vault.getAbstractFileByPath(op.path);
            if (!(f instanceof TFile)) return `Error: Delete File: ${op.path} not found.`;
            await app.fileManager.trashFile(f);
            touched.push(`-${op.path}`);
          } else {
            const f = app.vault.getAbstractFileByPath(op.path);
            if (!(f instanceof TFile)) return `Error: Update File: ${op.path} not found.`;
            const text = await app.vault.read(f);
            const next = applyUpdate(text, op.chunks);
            await app.vault.modify(f, next);
            if (op.movePath && op.movePath !== op.path) {
              await app.fileManager.renameFile(f, op.movePath);
            }
            touched.push(`~${op.movePath ?? op.path}`);
          }
        } catch (e: any) {
          return `Error in ${op.kind} ${('path' in op) ? op.path : ''}: ${e.message}`;
        }
      }
      return `Applied patch (${ops.length} file op${ops.length === 1 ? '' : 's'}): ${touched.join(', ')}`;
    }

    let path: string;
    try { path = assertVaultPath(args.path); }
    catch (e: any) { return `Error: ${e.message}`; }
    const { edits } = args;
    if (!Array.isArray(edits) || edits.length === 0) return 'Error: provide either `patch` (envelope) or `edits` array.';
    const f = app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) return `Error: not found: ${path}`;
    let text = await app.vault.read(f);
    for (let i = 0; i < edits.length; i++) {
      const ed = edits[i];
      if (typeof ed.search !== 'string' || ed.search.length === 0) return `Error: edit ${i + 1}: "search" must be a non-empty string.`;
      if (typeof ed.replace !== 'string') return `Error: edit ${i + 1}: "replace" must be a string.`;
      const occurrences = text.split(ed.search).length - 1;
      if (occurrences === 0) return `Error: edit ${i + 1}: "search" not found.`;
      if (occurrences > 1) return `Error: edit ${i + 1}: "search" matches ${occurrences} places — be more specific.`;
      text = text.replace(ed.search, ed.replace);
    }
    await app.vault.modify(f, text);
    return `Patched ${path} (${edits.length} edits).`;
  },
});
