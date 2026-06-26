/**
 * patch_note — section / block / frontmatter-anchored append-prepend-replace.
 *
 * Supersedes the cruder `edit_section` and `append_to_note` tools by letting
 * the model surgically modify a note WITHOUT having to read the whole file
 * first. Three target shapes:
 *
 *  - `{heading: "## Some Heading"}` — locate the heading by exact text match
 *     (optionally including the markdown level prefix). The section's body
 *     range is everything from after the heading line up to the next heading
 *     at the same or shallower level. `replace` swaps the body; `append`
 *     inserts at the end of the body; `prepend` at the start.
 *
 *  - `{block_ref: "abc123"}` — locate a block reference `^abc123` (Obsidian
 *     block IDs); operate on the paragraph that owns it.
 *
 *  - `{frontmatter_key: "tags"}` — operate on a single frontmatter property's
 *     value. `replace` overwrites it; `append`/`prepend` concatenate (string)
 *     or push (array).
 *
 * Mirrors upstream Claude Code / cyanheads MCP server's `patch_note`.
 */
import { TFile } from 'obsidian';
import { assertVaultPath, buildTool, normalizePathFields, type ToolImpl } from './_shared';
import { setStyle } from '../../utils/dom';

type Op = 'append' | 'prepend' | 'replace';

interface PatchTarget {
  heading?: string;
  block_ref?: string;
  frontmatter_key?: string;
}

/** Find a heading section's body line range (inclusive, exclusive).
 *  Returns null if not found. Heading match is exact (level + text), but if
 *  the user supplies just text we fuzzy-match level. */
function findHeadingSection(text: string, heading: string): { start: number; end: number; level: number } | null {
  const lines = text.split('\n');
  // Normalize: strip leading # marks from user input if present.
  const hmatch = heading.match(/^(#+)\s+(.*)$/);
  const wantedLevel = hmatch ? hmatch[1].length : null;
  const wantedText = (hmatch ? hmatch[2] : heading).trim();
  let headingLine = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#+)\s+(.*)$/);
    if (!m) continue;
    if (m[2].trim() !== wantedText) continue;
    if (wantedLevel !== null && m[1].length !== wantedLevel) continue;
    headingLine = i;
    level = m[1].length;
    break;
  }
  if (headingLine < 0) return null;
  // Body is from line headingLine+1 to the next heading of same/shallower level.
  let endLine = lines.length;
  for (let i = headingLine + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#+)\s+/);
    if (m && m[1].length <= level) { endLine = i; break; }
  }
  return { start: headingLine + 1, end: endLine, level };
}

/** Find the line index of a `^block-ref` anchor. Returns the OWNING paragraph
 *  range (back to last blank line, forward to next blank or end-of-file). */
function findBlockSection(text: string, blockRef: string): { start: number; end: number } | null {
  const ref = blockRef.replace(/^\^/, '');
  const lines = text.split('\n');
  const re = new RegExp(`\\^${ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`);
  let hitLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) { hitLine = i; break; }
  }
  if (hitLine < 0) return null;
  // Walk back to start of paragraph.
  let start = hitLine;
  while (start > 0 && lines[start - 1].trim() !== '') start--;
  // Walk forward to end of paragraph.
  let end = hitLine + 1;
  while (end < lines.length && lines[end].trim() !== '') end++;
  return { start, end };
}

export const patchNote: ToolImpl = buildTool({
  isReadOnly: () => false,
  isDestructive: () => true,
  isConcurrencySafe: () => false,
  searchHint: 'append prepend replace heading block frontmatter',
  backfillObservableInput: normalizePathFields(['path']),
  describe: a => {
    const t = (a.target ?? {}) as PatchTarget;
    const where = t.heading ? `heading "${t.heading}"`
                : t.block_ref ? `block ^${t.block_ref}`
                : t.frontmatter_key ? `frontmatter.${t.frontmatter_key}`
                : 'unknown target';
    return `${a.op ?? 'replace'} ${where} in ${a.path}`;
  },
  spec: {
    name: 'patch_note',
    description: [
      'Surgically modify a note at a specific anchor. Three target shapes:',
      '',
      '  target.heading        — match by exact heading text (e.g. "## Methods" or just "Methods")',
      '  target.block_ref      — match by block reference (e.g. "abc123" for ^abc123)',
      '  target.frontmatter_key — operate on a single YAML property',
      '',
      'Three ops:',
      '  append   — for sections: insert at end of section body; for frontmatter arrays: push',
      '  prepend  — for sections: insert at start of body; for frontmatter arrays: unshift',
      '  replace  — overwrite the section body / block paragraph / property value',
      '',
      'REQUIRES USER APPROVAL.'
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Vault-relative note path.' },
        op: { type: 'string', enum: ['append', 'prepend', 'replace'] },
        target: {
          type: 'object',
          description: 'Exactly ONE of heading / block_ref / frontmatter_key.',
          properties: {
            heading: { type: 'string' },
            block_ref: { type: 'string' },
            frontmatter_key: { type: 'string' },
          },
        },
        content: { type: 'string', description: 'The text / value to insert.' },
      },
      required: ['path', 'op', 'target', 'content'],
    },
  },
  preview: async (app, a: any) => {
    const t = (a.target ?? {}) as PatchTarget;
    const where = t.heading ? `heading "${t.heading}"`
                : t.block_ref ? `block ^${t.block_ref}`
                : t.frontmatter_key ? `frontmatter.${t.frontmatter_key}`
                : 'unknown';
    return `${a.op} ${where} in ${a.path}\n\n+ ${(a.content ?? '').slice(0, 300)}`;
  },
  // Inline render: a single colored pill stating WHERE we patched + a small
  // delta indicator. Mirrors the kind of UX upstream Claude Code provides on
  // FileEdit result cards.
  renderToolResultMessage(result, args) {
    const t = (args?.target ?? {}) as PatchTarget;
    const where = t.heading ? `## ${t.heading.replace(/^#+\s*/, '')}`
                : t.block_ref ? `^${t.block_ref}`
                : t.frontmatter_key ? `props.${t.frontmatter_key}`
                : 'unknown anchor';
    if (result.startsWith('Error')) return null;        // fall back to default error rendering
    const wrap = activeDocument.createElement('div');
    setStyle(wrap, { padding: '6px 10px' });
    setStyle(wrap, { fontSize: '12px' });
    setStyle(wrap, { background: 'color-mix(in srgb, var(--glossa-success, #188038) 8%, transparent)' });
    setStyle(wrap, { borderLeft: '3px solid var(--glossa-success, #188038)' });
    setStyle(wrap, { borderRadius: '4px' });
    setStyle(wrap, { lineHeight: '1.5' });
    const head = activeDocument.createElement('div');
    setStyle(head, { fontWeight: '600' });
    head.textContent = `${(args?.op ?? 'patched').toUpperCase()} · ${where}`;
    wrap.appendChild(head);
    const sub = activeDocument.createElement('div');
    setStyle(sub, { opacity: '0.7' });
    setStyle(sub, { fontSize: '11px' });
    sub.textContent = result.split('\n')[0];
    wrap.appendChild(sub);
    return wrap;
  },
  run: async (app, args) => {
    let path: string;
    try { path = assertVaultPath(args.path); }
    catch (e: any) { return `Error: ${e.message}`; }
    const op = args.op as Op;
    if (op !== 'append' && op !== 'prepend' && op !== 'replace') {
      return `Error: op must be append / prepend / replace, got "${args.op}"`;
    }
    const content = typeof args.content === 'string' ? args.content : '';
    const target = (args.target ?? {}) as PatchTarget;
    const f = app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) return `Error: not found: ${path}`;

    // ── Frontmatter mode: use Obsidian's atomic API so other keys / formatting stay intact.
    if (target.frontmatter_key) {
      try {
        await app.fileManager.processFrontMatter(f, (fm: Record<string, any>) => {
          const cur = fm[target.frontmatter_key!];
          if (op === 'replace') {
            // Try to parse content as JSON for arrays/objects/booleans/numbers;
            // fall through to plain string on parse error.
            try { fm[target.frontmatter_key!] = JSON.parse(content); }
            catch { fm[target.frontmatter_key!] = content; }
          } else if (Array.isArray(cur)) {
            // We're in the !replace branch (replace handled above), so op is append/prepend.
            const parsed = (() => { try { return JSON.parse(content); } catch { return content; } })();
            if (op === 'append')  fm[target.frontmatter_key!] = [...cur, parsed];
            else                  fm[target.frontmatter_key!] = [parsed, ...cur];
          } else {
            // String concat for scalar values; op is append/prepend here.
            const curStr = String(cur ?? '');
            fm[target.frontmatter_key!] = op === 'append' ? (curStr + content) : (content + curStr);
          }
        });
        return `Patched ${path}.frontmatter.${target.frontmatter_key} (${op}).`;
      } catch (e: any) {
        return `Error processing frontmatter: ${e.message}`;
      }
    }

    // ── Heading / block-ref modes.
    const text = await app.vault.read(f);
    let lines = text.split('\n');
    let section: { start: number; end: number } | null = null;
    if (target.heading) section = findHeadingSection(text, target.heading);
    else if (target.block_ref) section = findBlockSection(text, target.block_ref);
    else return 'Error: target must specify one of heading / block_ref / frontmatter_key.';
    if (!section) return `Error: target not found in ${path}.`;

    // Compute new line list.
    const before = lines.slice(0, section.start);
    const body = lines.slice(section.start, section.end);
    const after = lines.slice(section.end);
    const insert = content.split('\n');
    let newBody: string[];
    if (op === 'replace') {
      newBody = insert;
    } else if (op === 'append') {
      // Strip trailing blank lines from body before appending so the inserted
      // text sits flush against the existing content; preserves a final blank.
      const trimmed = body.slice();
      while (trimmed.length > 0 && trimmed[trimmed.length - 1].trim() === '') trimmed.pop();
      newBody = [...trimmed, ...insert];
    } else /* prepend */ {
      newBody = [...insert, ...body];
    }
    const next = [...before, ...newBody, ...after].join('\n');
    await app.vault.modify(f, next);
    const targetDesc = target.heading ? `heading "${target.heading}"` : `block ^${target.block_ref}`;
    return `Patched ${path} @ ${targetDesc} (${op}, ${insert.length} line${insert.length === 1 ? '' : 's'}).`;
  },
});
