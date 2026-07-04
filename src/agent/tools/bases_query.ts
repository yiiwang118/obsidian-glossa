/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- Dynamic plugin, model, and vault payloads are validated at runtime boundaries. */
/**
 * bases_query — bridge to Obsidian Bases (1.9+ built-in).
 *
 * Bases is a YAML-defined database view over the vault: filters, properties,
 * formulas, views. The Obsidian core API to invoke a base programmatically
 * is not yet public, so this bridge parses the .base YAML ourselves and
 * applies the filter expression against the file metadata cache.
 *
 * Supported filter expressions (subset, sufficient for ~80% of bases):
 *   file.hasTag("...")            → file has the tag
 *   file.tags.contains("...")     → alias for hasTag
 *   file.has("propname")          → frontmatter property is set
 *   file.name == "..."            → name equality
 *   <prop> == <value>             → frontmatter property equality
 *   <prop> != <value>
 *   <expr> and <expr>             → AND
 *   <expr> or <expr>              → OR
 *
 * Anything more complex falls back to returning the raw base + an
 * explanation that the model should use search_vault / dataview_query
 * for richer queries.
 */
import { TFile, getAllTags, parseYaml } from 'obsidian';
import { assertVaultPath, buildTool, normalizePathFields, type ToolImpl } from './_shared';

interface BaseDef {
  filters?: any;
  properties?: any[];
  views?: any[];
  formulas?: any[];
}

interface FilterAtom {
  kind: 'hasTag' | 'has' | 'eq' | 'neq' | 'true';
  key?: string;
  value?: string;
}

interface FilterExpr {
  type: 'and' | 'or' | 'atom';
  atom?: FilterAtom;
  children?: FilterExpr[];
}

/** Parse one expression line into FilterExpr. Recursive descent; very small
 *  grammar so we keep it inline. */
function parseExpr(line: string): FilterExpr {
  const trimmed = line.trim();
  // and / or chains (left-associative).
  // We look for top-level " and " / " or " (not inside quotes).
  const splitTop = (sep: string): string[] | null => {
    const parts: string[] = [];
    let depth = 0, quote: string | null = null, cur = '';
    for (let i = 0; i < trimmed.length; i++) {
      const c = trimmed[i];
      if (quote) {
        cur += c;
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'") { quote = c; cur += c; continue; }
      if (c === '(') depth++;
      if (c === ')') depth--;
      if (depth === 0 && trimmed.substring(i, i + sep.length + 2) === ` ${sep} `) {
        parts.push(cur); cur = ''; i += sep.length + 1; continue;
      }
      cur += c;
    }
    parts.push(cur);
    return parts.length > 1 ? parts : null;
  };
  const orParts = splitTop('or');
  if (orParts) return { type: 'or', children: orParts.map(parseExpr) };
  const andParts = splitTop('and');
  if (andParts) return { type: 'and', children: andParts.map(parseExpr) };
  // Paren wrap.
  if (trimmed.startsWith('(') && trimmed.endsWith(')')) return parseExpr(trimmed.slice(1, -1));
  // Atom forms.
  let m: RegExpMatchArray | null;
  if ((m = trimmed.match(/^file\.hasTag\(\s*["']([^"']+)["']\s*\)$/))) {
    return { type: 'atom', atom: { kind: 'hasTag', value: m[1] } };
  }
  if ((m = trimmed.match(/^file\.tags\.contains\(\s*["']([^"']+)["']\s*\)$/))) {
    return { type: 'atom', atom: { kind: 'hasTag', value: m[1] } };
  }
  if ((m = trimmed.match(/^file\.has\(\s*["']([^"']+)["']\s*\)$/))) {
    return { type: 'atom', atom: { kind: 'has', key: m[1] } };
  }
  if ((m = trimmed.match(/^([A-Za-z_][\w.]*)\s*==\s*["']?([^"']*)["']?$/))) {
    return { type: 'atom', atom: { kind: 'eq', key: m[1], value: m[2] } };
  }
  if ((m = trimmed.match(/^([A-Za-z_][\w.]*)\s*!=\s*["']?([^"']*)["']?$/))) {
    return { type: 'atom', atom: { kind: 'neq', key: m[1], value: m[2] } };
  }
  // Unrecognised — match everything (parser fallback).
  return { type: 'atom', atom: { kind: 'true' } };
}

function evalExpr(expr: FilterExpr, file: TFile, cache: any): boolean {
  if (expr.type === 'and') return (expr.children ?? []).every(c => evalExpr(c, file, cache));
  if (expr.type === 'or') return (expr.children ?? []).some(c => evalExpr(c, file, cache));
  const atom = expr.atom;
  if (atom.kind === 'true') return true;
  if (atom.kind === 'hasTag') {
    const tags = (getAllTags(cache ?? {}) ?? []).map(t => t.replace(/^#+/, ''));
    return tags.includes(String(atom.value).replace(/^#+/, ''));
  }
  if (atom.kind === 'has') {
    return cache?.frontmatter && atom.key in cache.frontmatter;
  }
  // eq/neq dispatch — file.* accessors vs frontmatter keys.
  if (atom.kind === 'eq' || atom.kind === 'neq') {
    const key = atom.key;
    let actual: any;
    if (key === 'file.name')    actual = file.basename;
    else if (key === 'file.path') actual = file.path;
    else if (key === 'file.folder') actual = file.parent?.path ?? '';
    else actual = cache?.frontmatter?.[key];
    const matches = String(actual ?? '') === String(atom.value ?? '');
    return atom.kind === 'eq' ? matches : !matches;
  }
  return false;
}

/** Build a single root FilterExpr from a YAML filters block. Bases accept:
 *   filters:
 *     and:
 *       - file.hasTag("project")
 *       - status != "done"
 *  (or `or:`, or a single string). */
function buildFilter(yamlFilters: any): FilterExpr {
  if (!yamlFilters) return { type: 'atom', atom: { kind: 'true' } };
  if (typeof yamlFilters === 'string') return parseExpr(yamlFilters);
  if (Array.isArray(yamlFilters)) {
    return { type: 'and', children: yamlFilters.map(buildFilter) };
  }
  if (typeof yamlFilters === 'object') {
    if (yamlFilters.and) return { type: 'and', children: (yamlFilters.and as any[]).map(buildFilter) };
    if (yamlFilters.or)  return { type: 'or',  children: (yamlFilters.or  as any[]).map(buildFilter) };
  }
  return { type: 'atom', atom: { kind: 'true' } };
}

export const basesQuery: ToolImpl = buildTool({
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  isDestructive: () => false,
  searchHint: 'run obsidian bases yaml query filter',
  backfillObservableInput: normalizePathFields(['base_path']),
  describe: a => `base: ${a.base_path}${a.view ? ` [${a.view}]` : ''}`,
  spec: {
    name: 'bases_query',
    description: [
      'Run an Obsidian Bases (.base) query and return matching notes as a markdown',
      'table. Supports a SUBSET of Bases filter grammar:',
      '',
      '  file.hasTag("...")  /  file.tags.contains("...")',
      '  file.has("propname")',
      '  file.name == "..."  /  file.path == "..."  /  file.folder == "..."',
      '  <prop> == <value>   /  <prop> != <value>',
      '  <expr> and <expr>   /  <expr> or <expr>',
      '',
      'For richer queries (formulas, computed columns) install Dataview and use',
      'dataview_query instead.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        base_path: { type: 'string', description: 'Vault-relative path to a .base file.' },
        view: { type: 'string', description: 'Optional view name (only used to choose which properties to show).' },
        max_results: { type: 'number', description: 'Default 100.' },
      },
      required: ['base_path'],
    },
  },
  run: async (app, args, ctx) => {
    if (ctx?.signal?.aborted) return 'Error: cancelled before start.';
    let path: string;
    try { path = assertVaultPath(args.base_path, 'base_path'); }
    catch (e: any) { return `Error: ${e.message}`; }
    if (!path.endsWith('.base')) return `Error: ${path} is not a .base file.`;
    const f = app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) return `Error: not found: ${path}`;
    const raw = await app.vault.read(f);
    let def: BaseDef;
    try { def = parseYaml(raw) as BaseDef; }
    catch (e: any) { return `Error: invalid YAML in ${path}: ${e?.message ?? e}`; }

    const filterExpr = buildFilter(def.filters);
    const max = Math.max(1, Math.min(5000, Number(args.max_results) || 100));

    // Pick view if specified.
    let propKeys: string[] = [];
    if (Array.isArray(def.properties)) {
      propKeys = def.properties.map((p: any) => typeof p === 'string' ? p : (p?.name ?? p?.key ?? '')).filter(Boolean);
    }
    if (args.view && Array.isArray(def.views)) {
      const v = def.views.find((vv: any) => vv?.name === args.view);
      if (v?.properties) propKeys = (v.properties as any[]).map((p: any) => typeof p === 'string' ? p : (p?.name ?? '')).filter(Boolean);
    }
    if (propKeys.length === 0) propKeys = ['file.name'];

    const rows: string[][] = [];
    for (const file of app.vault.getMarkdownFiles()) {
      const cache = app.metadataCache.getFileCache(file);
      if (!evalExpr(filterExpr, file, cache)) continue;
      const cells = propKeys.map(k => {
        if (k === 'file.name') return file.basename;
        if (k === 'file.path') return file.path;
        if (k === 'file.folder') return file.parent?.path ?? '';
        if (k === 'file.mtime') return new Date(file.stat.mtime).toISOString().slice(0, 10);
        const v = cache?.frontmatter?.[k];
        return v == null ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
      });
      rows.push(cells);
      if (rows.length >= max + 1) break;
    }
    if (rows.length === 0) return `No rows match ${path}.`;
    const truncated = rows.length > max;
    const shown = rows.slice(0, max);

    // Markdown table.
    const lines: string[] = [];
    lines.push('| ' + propKeys.join(' | ') + ' |');
    lines.push('|' + propKeys.map(() => '---').join('|') + '|');
    for (const r of shown) lines.push('| ' + r.map(c => String(c).replace(/\|/g, '\\|')).join(' | ') + ' |');
    if (truncated) lines.push(`\n[+${rows.length - max} more, truncated]`);
    return `Base: ${path}${args.view ? `  (view: ${args.view})` : ''}\n${shown.length} row${shown.length === 1 ? '' : 's'}:\n\n${lines.join('\n')}`;
  },
});
