/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- Dynamic plugin and host-app boundaries validate these values at runtime. */
/**
 * manage_tags — add/remove/list tags on a note.
 *
 * Obsidian supports tags in two places:
 *   (a) inline `#tag` anywhere in the body
 *   (b) `tags:` (or `tag:`) array in frontmatter
 *
 * We reconcile both: `add` writes to frontmatter (canonical), `remove` strips
 * from both, `list` returns the union. Tag normalisation: leading `#` is
 * stripped on storage but accepted on input.
 */
import { TFile, getAllTags } from 'obsidian';
import { assertVaultPath, buildTool, normalizePathFields, type ToolImpl } from './_shared';
import { setStyle } from '../../utils/dom';

function normalizeTag(t: string): string {
  return t.replace(/^#+/, '').trim();
}

export const manageTags: ToolImpl = buildTool({
  isReadOnly: a => a?.op === 'list',
  isDestructive: a => a?.op === 'add' || a?.op === 'remove',
  isConcurrencySafe: a => a?.op === 'list',
  shouldDefer: true,
  searchHint: 'add remove list note tags frontmatter inline',
  searchTags: ['tag metadata', '分类标签', '标签增删', 'frontmatter tags'],
  backfillObservableInput: normalizePathFields(['path']),
  describe: a => `${a.op ?? 'list'} tags on ${a.path}`,
  // Render: a horizontal row of colored tag chips when the result is a
  // line-per-tag list, otherwise a one-line summary.
  renderToolResultMessage(result, args) {
    if (result.startsWith('Error') || result.startsWith('(')) return null;
    const wrap = activeDocument.createElement('div');
    setStyle(wrap, { padding: '6px 10px' });
    setStyle(wrap, { lineHeight: '1.5' });
    setStyle(wrap, { fontSize: '12px' });

    const header = activeDocument.createElement('div');
    setStyle(header, { fontWeight: '600' });
    setStyle(header, { marginBottom: '6px' });
    header.textContent = `${(args?.op ?? 'tags').toUpperCase()}  ·  ${args?.path ?? ''}`;
    wrap.appendChild(header);

    // For `list` op, result is a newline-separated tag list (no prefix).
    // For `add` / `remove`, result starts with "Added: " / "Removed: ".
    let tags: string[] = [];
    if (args?.op === 'list') {
      tags = result.split('\n').map(s => s.replace(/^#+/, '').trim()).filter(Boolean);
    } else {
      const m = result.match(/^(Added|Removed):\s*(.+)$/);
      if (m) tags = m[2].split(',').map(s => s.trim()).filter(Boolean);
    }
    if (tags.length === 0) {
      const sub = activeDocument.createElement('div');
      setStyle(sub, { opacity: '0.7' });
      sub.textContent = result;
      wrap.appendChild(sub);
      return wrap;
    }

    const chipRow = activeDocument.createElement('div');
    setStyle(chipRow, { display: 'flex' });
    setStyle(chipRow, { flexWrap: 'wrap' });
    setStyle(chipRow, { gap: '4px' });
    const op = args?.op;
    const chipColor = op === 'add' ? 'var(--glossa-success, #2f7d52)'
                    : op === 'remove' ? 'var(--glossa-danger, #b84a4a)'
                    : 'var(--glossa-active-text, #365f9f)';
    const chipBg = op === 'add' ? 'color-mix(in srgb, var(--glossa-success, #2f7d52) 10%, transparent)'
                 : op === 'remove' ? 'color-mix(in srgb, var(--glossa-danger, #b84a4a) 10%, transparent)'
                 : 'var(--glossa-active-bg, #eef3fb)';
    for (const t of tags) {
      const chip = activeDocument.createElement('span');
      chip.textContent = `#${t}`;
      setStyle(chip, { padding: '2px 8px' });
      setStyle(chip, { fontSize: '11px' });
      setStyle(chip, { background: chipBg });
      setStyle(chip, { color: chipColor });
      setStyle(chip, { border: `1px solid ${chipColor}` });
      setStyle(chip, { borderRadius: '10px' });
      chipRow.appendChild(chip);
    }
    wrap.appendChild(chipRow);
    return wrap;
  },
  spec: {
    name: 'manage_tags',
    description: 'List, add, or remove tags on one note. Add writes canonical frontmatter tags; remove reconciles frontmatter and inline tags. Use only for tag changes, not arbitrary metadata.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Vault-relative path of the note.' },
        op: { type: 'string', enum: ['add', 'remove', 'list'], description: 'Tag operation. list is read-only; add/remove modify the note.' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tag names (with or without leading #). Required for add/remove.',
        },
      },
      required: ['path', 'op'],
      additionalProperties: false,
    },
  },
  preview: async (a) => `${a.op} ${(a.tags ?? []).join(', ')} on ${a.path}`,
  run: async (app, args) => {
    let path: string;
    try { path = assertVaultPath(args.path); }
    catch (e) { return `Error: ${e.message}`; }
    const op = args.op as 'add' | 'remove' | 'list';
    const f = app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) return `Error: not found: ${path}`;

    if (op === 'list') {
      const cache = app.metadataCache.getFileCache(f);
      const all = getAllTags(cache ?? ({} as AnyValue)) ?? [];
      const uniq = [...new Set(all.map(normalizeTag))].sort();
      return uniq.length === 0 ? '(no tags)' : uniq.join('\n');
    }

    const inputTags = Array.isArray(args.tags) ? (args.tags as unknown[]).map(t => normalizeTag(String(t))).filter(Boolean) : [];
    if (inputTags.length === 0) return 'Error: tags array is required for add/remove (and must be non-empty).';

    if (op === 'add') {
      let added: string[] = [];
      try {
        await app.fileManager.processFrontMatter(f, (fm: Record<string,AnyValue>) => {
          // Reconcile: frontmatter accepts `tags:` (array) or `tag:` (string).
          // We normalise to `tags:` array.
          const existing = Array.isArray(fm.tags) ? fm.tags.map(String)
                          : typeof fm.tags === 'string' ? [fm.tags]
                          : Array.isArray(fm.tag) ? fm.tag.map(String)
                          : typeof fm.tag === 'string' ? [fm.tag]
                          : [];
          const existingNorm = new Set(existing.map(normalizeTag));
          added = inputTags.filter(t => !existingNorm.has(t));
          if (added.length === 0) return;
          const next = [...existing.map(normalizeTag), ...added];
          fm.tags = [...new Set(next)];
          // Drop legacy `tag:` field if we just wrote `tags:`.
          if ('tag' in fm) delete fm.tag;
        });
      } catch (e) { return `Error: ${e.message}`; }
      return added.length === 0 ? '(all tags already present)' : `Added: ${added.join(', ')}`;
    }

    // remove — both frontmatter AND inline.
    let removed = new Set<string>();
    try {
      await app.fileManager.processFrontMatter(f, (fm: Record<string,AnyValue>) => {
        const before = Array.isArray(fm.tags) ? fm.tags.map(String) : typeof fm.tags === 'string' ? [fm.tags] : [];
        const targetSet = new Set(inputTags);
        const kept = before.filter(t => !targetSet.has(normalizeTag(t)));
        for (const t of before) if (targetSet.has(normalizeTag(t))) removed.add(normalizeTag(t));
        fm.tags = kept;
        if (Array.isArray(fm.tag)) {
          const beforeTag = (fm.tag as unknown[]).map(String);
          fm.tag = beforeTag.filter(t => !targetSet.has(normalizeTag(t)));
          for (const t of beforeTag) if (targetSet.has(normalizeTag(t))) removed.add(normalizeTag(t));
        } else if (typeof fm.tag === 'string' && targetSet.has(normalizeTag(fm.tag))) {
          removed.add(normalizeTag(fm.tag));
          delete fm.tag;
        }
      });
    } catch (e) { return `Error: ${e.message}`; }

    // Strip inline #tag occurrences.
    const text = await app.vault.read(f);
    let next = text;
    for (const t of inputTags) {
      const re = new RegExp(`(^|\\s)#${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$|[,;.])`, 'gm');
      if (re.test(next)) {
        removed.add(t);
        next = next.replace(re, '$1');
      }
    }
    if (next !== text) await app.vault.modify(f, next);

    return removed.size === 0 ? '(no matching tags found)' : `Removed: ${[...removed].sort().join(', ')}`;
  },
});
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- Re-enable review lint rules after dynamic boundary module. */
