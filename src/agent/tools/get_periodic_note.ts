/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- Dynamic plugin and host-app boundaries validate these values at runtime. */
/**
 * get_periodic_note — resolve a daily / weekly / monthly note by type + offset.
 *
 * Uses the community "Periodic Notes" plugin when installed (rich settings),
 * otherwise falls back to Obsidian's built-in Daily Notes (core plugin) and
 * its `format` + `folder` settings. If `create_if_missing` is true, the
 * resolved path will be created (empty) when the file doesn't exist yet.
 *
 * Date arithmetic is intentionally simple — no moment.js dependency. Format
 * tokens supported in the fallback path:
 *   YYYY, MM, DD, gggg (year-of-week), HH, mm, ss
 */
import { TFile } from 'obsidian';
import { buildTool, type ToolImpl } from './_shared';

type Granularity = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

interface PeriodicConfig {
  format: string;
  folder: string;
  template?: string;
}

/** Fallback formatter using ASCII tokens. NOT moment-compatible for advanced
 *  tokens — kept tiny on purpose. */
function formatDate(fmt: string, date: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return fmt
    .replace(/YYYY/g, String(date.getFullYear()))
    .replace(/gggg/g, String(date.getFullYear()))
    .replace(/MM/g, pad(date.getMonth() + 1))
    .replace(/DD/g, pad(date.getDate()))
    .replace(/HH/g, pad(date.getHours()))
    .replace(/mm/g, pad(date.getMinutes()))
    .replace(/ss/g, pad(date.getSeconds()));
}

/** Apply a per-granularity offset to a date. Positive = future, negative = past. */
function applyOffset(d: Date, granularity: Granularity, offset: number): Date {
  const r = new Date(d);
  if (granularity === 'daily') r.setDate(r.getDate() + offset);
  else if (granularity === 'weekly') r.setDate(r.getDate() + 7 * offset);
  else if (granularity === 'monthly') r.setMonth(r.getMonth() + offset);
  else if (granularity === 'quarterly') r.setMonth(r.getMonth() + 3 * offset);
  else if (granularity === 'yearly') r.setFullYear(r.getFullYear() + offset);
  return r;
}

/** Read Daily-Notes core plugin config: format defaults to YYYY-MM-DD, folder
 *  empty (vault root). Returns null if the core plugin is disabled. */
function readBuiltinDaily(app: AnyValue): PeriodicConfig | null {
  // Daily Notes core plugin has been renamed across versions; check both.
  const cfg = app.internalPlugins?.plugins?.['daily-notes']?.instance?.options;
  if (!cfg) return null;
  return {
    format: cfg.format || 'YYYY-MM-DD',
    folder: cfg.folder || '',
    template: cfg.template,
  };
}

/** Periodic-Notes (community) per-granularity settings. */
function readPeriodicPlugin(app: AnyValue, granularity: Granularity): PeriodicConfig | null {
  const plugin = app.plugins?.plugins?.['periodic-notes'];
  if (!plugin) return null;
  const s = plugin.settings?.[granularity];
  if (!s || s.enabled === false) return null;
  return {
    format: s.format || (granularity === 'daily' ? 'YYYY-MM-DD' : `YYYY-[${granularity[0].toUpperCase()}]MM-DD`),
    folder: s.folder || '',
    template: s.template,
  };
}

function resolveConfig(app: AnyValue, granularity: Granularity): PeriodicConfig | null {
  // Prefer the dedicated periodic-notes plugin (it supports all 5 granularities).
  const pp = readPeriodicPlugin(app, granularity);
  if (pp) return pp;
  // Fall back to core Daily Notes only for `daily`.
  if (granularity === 'daily') return readBuiltinDaily(app);
  return null;
}

export const getPeriodicNote: ToolImpl = buildTool({
  isReadOnly: a => !a?.create_if_missing,
  isConcurrencySafe: a => !a?.create_if_missing,
  isDestructive: a => !!a?.create_if_missing,
  shouldDefer: true,
  searchHint: 'find or create daily weekly monthly note',
  searchTags: ['daily note', 'weekly note', 'journal', '日记', '周期笔记'],
  describe: a => `${a.type ?? 'daily'} note${a.offset ? ` (${a.offset > 0 ? '+' : ''}${a.offset})` : ''}`,
  spec: {
    name: 'get_periodic_note',
    description: 'Resolve a configured daily, weekly, monthly, quarterly, or yearly note by signed offset. By default this only reports the path and existence; create_if_missing writes the configured template and requires approval.',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'], description: 'Periodic-note granularity.' },
        offset: { type: 'integer', minimum: -1000, maximum: 1000, description: 'Default 0. Negative selects an earlier period; positive selects a later period.' },
        create_if_missing: { type: 'boolean', description: 'Default false. When true, create the file (empty) if it does not exist.' },
      },
      required: ['type'],
      additionalProperties: false,
    },
  },
  run: async (app, args) => {
    const granularity = (args.type ?? 'daily') as Granularity;
    if (!['daily','weekly','monthly','quarterly','yearly'].includes(granularity)) {
      return `Error: type must be one of daily/weekly/monthly/quarterly/yearly, got "${args.type}".`;
    }
    const offset = Number.isFinite(args.offset) ? Number(args.offset) : 0;
    const cfg = resolveConfig(app as AnyValue, granularity);
    if (!cfg) return `Error: no ${granularity}-notes config found. Enable the Daily Notes core plugin or install Periodic Notes.`;
    const target = applyOffset(new Date(), granularity, offset);
    const basename = formatDate(cfg.format, target);
    const path = cfg.folder ? `${cfg.folder.replace(/\/+$/, '')}/${basename}.md` : `${basename}.md`;
    const f = app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) {
      return `Path: ${path}\nExists: true\nGranularity: ${granularity}\nOffset: ${offset}`;
    }
    if (!args.create_if_missing) {
      return `Path: ${path}\nExists: false\nGranularity: ${granularity}\nOffset: ${offset}\n\n(file not yet created — pass create_if_missing:true to make an empty one)`;
    }
    // Create the file (with template if configured).
    let body = '';
    if (cfg.template) {
      const tplFile = app.vault.getAbstractFileByPath(cfg.template.endsWith('.md') ? cfg.template : `${cfg.template}.md`);
      if (tplFile instanceof TFile) body = await app.vault.read(tplFile);
    }
    try {
      const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      if (folder) try { await app.vault.createFolder(folder); } catch { /* ignore */ }
      await app.vault.create(path, body);
      return `Created ${path}.\nGranularity: ${granularity}\nOffset: ${offset}`;
    } catch (e) {
      return `Error creating ${path}: ${e.message}`;
    }
  },
});
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- Re-enable review lint rules after dynamic boundary module. */
