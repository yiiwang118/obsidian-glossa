/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- Dynamic plugin and host-app boundaries validate these values at runtime. */
import { TFile } from 'obsidian';
import { parseEnvelope, looksLikeEnvelope, summarizeOps, type FileOp } from '../patch_envelope';
import { commitPatchTransaction, materializePatchTransaction, obsidianPatchFileStore } from '../patch_transaction';
import { applyTextEdits, describeTextMatches, textFingerprint, type TextEditOperation } from '../text_edit_engine';
import { assertVaultPath, buildTool, type ToolImpl } from './_shared';

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
                  : (op as AnyValue).path;
          return `patch ${p} (${op.kind === 'update' ? `${op.chunks.length}h` : op.kind})`;
        }
        return `patch envelope (${ops.length} files)`;
      } catch { return 'apply_patch (envelope, parse error)'; }
    }
    return `patch ${a.path} (${(a.edits ?? []).length} edits)`;
  },
  preview: async (app, a: AnyValue) => {
    if (typeof a.patch === 'string' && looksLikeEnvelope(a.patch)) {
      try {
        const ops = parseEnvelope(a.patch);
        const plan = await materializePatchTransaction(ops, obsidianPatchFileStore(app));
        a.__expectedFingerprints = Object.fromEntries(plan.snapshots.map(snapshot => [snapshot.path, snapshot.fingerprint]));
        const lines: string[] = [summarizeOps(ops), ''];
        for (const operation of plan.operations) {
          lines.push(`${operation.kind} ${operation.sourcePath}${operation.targetPath !== operation.sourcePath ? ` → ${operation.targetPath}` : ''}`);
          if (operation.matchSummary) lines.push(`  ${operation.matchSummary}`);
        }
        return lines.join('\n');
      } catch (e) {
        return `Envelope parse error: ${e.message}`;
      }
    }
    const f = app.vault.getAbstractFileByPath(a.path);
    if (!(f instanceof TFile)) return `(file not found: ${a.path})`;
    const text = await app.vault.read(f);
    const edits = a.edits ?? [];
    const result = applyTextEdits(text, edits.map((edit: AnyValue) => ({ oldText: edit.search, newText: edit.replace })));
    if (result.ok === false) return `File: ${a.path}\n\n✗ Edit ${(result.operationIndex ?? 0) + 1}: ${result.error}`;
    a.__expectedFingerprint = result.fingerprint;
    const lines: string[] = [`File: ${a.path}`, `Match: ${describeTextMatches(result.edits)}`, ''];
    for (let i = 0; i < edits.length; i++) {
      lines.push(`Edit ${i + 1}:`, `  - ${edits[i].search.slice(0, 200)}`, `  + ${edits[i].replace.slice(0, 200)}`, '');
    }
    return lines.join('\n');
  },
  spec: {
    name: 'apply_patch',
    description: 'Apply an atomic one- or multi-file patch. All final content and fingerprints are checked before writing; conflicts, stale files, ambiguous hunks, or failures abort and roll back. Match mode is disclosed. Prefer an envelope for multiple files. Requires approval.',
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
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  },
  run: async (app, args) => {
    if (typeof args.patch === 'string' && looksLikeEnvelope(args.patch)) {
      let ops: FileOp[];
      try { ops = parseEnvelope(args.patch); }
      catch (e) { return `Error: ${e.message}`; }
      // Pre-validate every path in the envelope before applying anything.
      // Bail before the first write so we don't half-apply a patch when one
      // hunk references a hostile path.
      for (const op of ops) {
        try { assertVaultPath((op as AnyValue).path); }
        catch (e) { return `Error: ${op.kind} has invalid path — ${e.message}`; }
        if (op.kind === 'update' && op.movePath) {
          try { assertVaultPath(op.movePath, 'move target'); }
          catch (e) { return `Error: ${op.kind} → move target invalid — ${e.message}`; }
        }
      }
      const store = obsidianPatchFileStore(app);
      let plan;
      try { plan = await materializePatchTransaction(ops, store); }
      catch (e) { return `Error: patch preflight failed: ${e.message}`; }
      const expected = args.__expectedFingerprints;
      if (expected && typeof expected === 'object') {
        for (const snapshot of plan.snapshots) {
          if (Object.prototype.hasOwnProperty.call(expected, snapshot.path) && expected[snapshot.path] !== snapshot.fingerprint) {
            return `Error: ${snapshot.path} changed after preview; patch was not started.`;
          }
        }
      }
      const committed = await commitPatchTransaction(plan, store);
      if (committed.ok === false) {
        const rollback = committed.rolledBack
          ? 'All partial writes were rolled back.'
          : `Rollback incomplete: ${committed.rollbackErrors.join('; ')}`;
        return `Error: patch commit failed: ${committed.error}. ${rollback}`;
      }
      const matches = plan.operations.flatMap(operation => operation.matchSummary ? [`${operation.targetPath}: ${operation.matchSummary}`] : []);
      return `Applied atomic patch (${ops.length} file op${ops.length === 1 ? '' : 's'}): ${committed.touched.join(', ')}${matches.length ? `. Matches: ${matches.join(' | ')}` : ''}`;
    }

    let path: string;
    try { path = assertVaultPath(args.path); }
    catch (e) { return `Error: ${e.message}`; }
    const { edits } = args;
    if (!Array.isArray(edits) || edits.length === 0) return 'Error: provide either `patch` (envelope) or `edits` array.';
    const f = app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) return `Error: not found: ${path}`;
    const text = await app.vault.read(f);
    const expected = typeof args.__expectedFingerprint === 'string' ? args.__expectedFingerprint : '';
    if (expected && textFingerprint(text) !== expected) return `Error: ${path} changed after preview; no changes were applied.`;
    const operations: TextEditOperation[] = [];
    for (let i = 0; i < edits.length; i++) {
      const ed = edits[i];
      if (typeof ed.search !== 'string' || ed.search.length === 0) return `Error: edit ${i + 1}: "search" must be a non-empty string.`;
      if (typeof ed.replace !== 'string') return `Error: edit ${i + 1}: "replace" must be a string.`;
      operations.push({ oldText: ed.search, newText: ed.replace });
    }
    const result = applyTextEdits(text, operations);
    if (result.ok === false) return `Error: edit ${(result.operationIndex ?? 0) + 1}: ${result.error}`;
    await app.vault.modify(f, result.content);
    return `Patched ${path} once (${edits.length} edits; ${describeTextMatches(result.edits)}).`;
  },
});
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- Re-enable review lint rules after dynamic boundary module. */
