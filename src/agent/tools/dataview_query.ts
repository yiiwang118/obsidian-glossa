/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- Dynamic plugin and host-app boundaries validate these values at runtime. */
/**
 * dataview_query — bridge to the Dataview plugin's DQL engine.
 *
 * Modes:
 *   query  → run a DQL string (TABLE/LIST/TASK/CALENDAR) via `dv.api.query`.
 *   js     → run a JS expression returning pages/results via `dv.api.queryMarkdown`.
 *   pages  → equivalent to `dv.pages(source)` returning a flat list.
 *
 * Result is always returned as a markdown string the model can read directly.
 */
import { buildTool, type ToolImpl } from './_shared';

type DataviewApi = Record<string, AnyValue> & {
  queryMarkdown?: (query: string) => Promise<{ successful?: boolean; value?: unknown; error?: unknown }>;
  pages?: (source: string) => unknown;
};

function objectRecord(value: unknown): Record<string, AnyValue> | null {
  return value && typeof value === 'object' ? value as Record<string, AnyValue> : null;
}

function isIterableValue(value: unknown): value is Iterable<AnyValue> {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return false;
  return typeof (value as { [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function';
}

function getDvApi(app: AnyValue): DataviewApi | null {
  const appRecord = objectRecord(app);
  const plugins = objectRecord(objectRecord(appRecord?.plugins)?.plugins);
  const dataview = objectRecord(plugins?.['dataview']);
  const api = objectRecord(dataview?.api);
  return api as DataviewApi | null;
}

export const dataviewQuery: ToolImpl = buildTool({
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  isDestructive: () => false,
  shouldDefer: true,
  searchHint: 'run dataview dql query over notes',
  searchTags: ['database table query', 'Dataview pages', '数据视图', '数据库查询'],
  describe: a => {
    const mode = a.mode ?? 'query';
    const q = String(a.query ?? a.source ?? '').slice(0, 60);
    return `dataview ${mode}: ${q}`;
  },
  spec: {
    name: 'dataview_query',
    description: 'Run a read-only Dataview query through the installed Dataview plugin. Use query for DQL TABLE/LIST/TASK/CALENDAR output, or pages for a source expression such as #project. Returns Markdown and never writes notes.',
    parameters: {
      type: 'object',
      properties: {
        mode:   { type: 'string', enum: ['query', 'pages'], description: 'Default "query".' },
        query:  { type: 'string', description: 'DQL string (mode=query only).' },
        source: { type: 'string', description: 'Dataview source string (mode=pages only). e.g. "#tag", \'"folder/path"\'.' },
        limit:  { type: 'integer', minimum: 1, maximum: 5000, description: 'Maximum rows to return. Default 100.' },
      },
      additionalProperties: false,
    },
  },
  run: async (app, args, ctx) => {
    if (ctx?.signal?.aborted) return 'Error: cancelled before start.';
    const dv = getDvApi(app);
    if (!dv) return 'Error: Dataview plugin not installed or not enabled. Install it from Community Plugins.';
    const mode = (args.mode ?? 'query') as 'query' | 'pages';
    const limit = Math.max(1, Math.min(5000, Number(args.limit) || 100));

    try {
      if (mode === 'query') {
        const q = String(args.query ?? '').trim();
        if (!q) return 'Error: query is required for mode=query.';
        // dv.queryMarkdown returns { successful, value, error } where value
        // is a fully-rendered markdown string. Cheaper to use than .query()
        // (which yields raw arrays we\'d have to re-serialize).
        if (typeof dv.queryMarkdown !== 'function') return 'Error: Dataview API queryMarkdown is unavailable.';
        const res = await dv.queryMarkdown(q);
        if (!res?.successful) return `Dataview error: ${res?.error ?? 'unknown'}`;
        let text = String(res.value ?? '');
        // Truncate at row level so we don\'t cut a table mid-row.
        const lines = text.split('\n');
        if (lines.length > limit + 10) {
          text = lines.slice(0, limit + 4).join('\n') + `\n... [+${lines.length - limit - 4} rows truncated; raise limit]`;
        }
        return text || '(no rows)';
      }

      // pages mode
      const source = String(args.source ?? '').trim();
      if (typeof dv.pages !== 'function') return 'Error: Dataview API pages is unavailable.';
      const pages = dv.pages(source);
      const pagesRecord = objectRecord(pages);
      const arr = typeof pagesRecord?.array === 'function'
        ? pagesRecord.array()
        : isIterableValue(pages) ? Array.from(pages) : [];
      const cap = arr.slice(0, limit);
      if (cap.length === 0) return `No pages match source: ${source || '(empty)'}.`;
      const lines = cap.map((p: AnyValue) => {
        const path = p.file?.path ?? p.path ?? '(no path)';
        const tags = (p.file?.tags ?? []).slice(0, 5).join(' ');
        return `- ${path}${tags ? `  ${tags}` : ''}`;
      });
      const tail = arr.length > cap.length ? `\n[+${arr.length - cap.length} more, truncated at limit ${limit}]` : '';
      return `${cap.length} of ${arr.length} pages:\n${lines.join('\n')}${tail}`;
    } catch (e) {
      return `Dataview error: ${e?.message ?? e}`;
    }
  },
});
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- Re-enable review lint rules after dynamic boundary module. */
