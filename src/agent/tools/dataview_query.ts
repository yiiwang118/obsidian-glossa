/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-duplicate-type-constituents, @typescript-eslint/only-throw-error, @typescript-eslint/no-unused-vars -- Dynamic plugin and host-app boundaries validate these values at runtime. */
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

function getDvApi(app: any): any | null {
  return app?.plugins?.plugins?.['dataview']?.api ?? null;
}

export const dataviewQuery: ToolImpl = buildTool({
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  isDestructive: () => false,
  searchHint: 'run dataview dql query over notes',
  describe: a => {
    const mode = a.mode ?? 'query';
    const q = String(a.query ?? a.source ?? '').slice(0, 60);
    return `dataview ${mode}: ${q}`;
  },
  spec: {
    name: 'dataview_query',
    description: [
      'Run a Dataview query against the vault. Requires the Dataview plugin to be installed and enabled.',
      '',
      'Modes:',
      '  query  — DQL string starting with TABLE / LIST / TASK / CALENDAR.',
      '           e.g. "TABLE file.mtime FROM #project WHERE status = \\"open\\""',
      '  pages  — list pages from a source. e.g. source: "#project" returns all tagged notes.',
      '',
      'Output is a markdown table / list ready to drop into a note.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        mode:   { type: 'string', enum: ['query', 'pages'], description: 'Default "query".' },
        query:  { type: 'string', description: 'DQL string (mode=query only).' },
        source: { type: 'string', description: 'Dataview source string (mode=pages only). e.g. "#tag", \'"folder/path"\'.' },
        limit:  { type: 'number', description: 'Cap on rows. Default 100.' },
      },
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
      const pages = dv.pages(source);
      const arr = pages.array ? pages.array() : Array.from(pages);
      const cap = arr.slice(0, limit);
      if (cap.length === 0) return `No pages match source: ${source || '(empty)'}.`;
      const lines = cap.map((p: any) => {
        const path = p.file?.path ?? p.path ?? '(no path)';
        const tags = (p.file?.tags ?? []).slice(0, 5).join(' ');
        return `- ${path}${tags ? `  ${tags}` : ''}`;
      });
      const tail = arr.length > cap.length ? `\n[+${arr.length - cap.length} more, truncated at limit ${limit}]` : '';
      return `${cap.length} of ${arr.length} pages:\n${lines.join('\n')}${tail}`;
    } catch (e: any) {
      return `Dataview error: ${e?.message ?? e}`;
    }
  },
});
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-duplicate-type-constituents, @typescript-eslint/only-throw-error, @typescript-eslint/no-unused-vars */
