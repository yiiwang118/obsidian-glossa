/**
 * tool_search — surface deferred tools by keyword match.
 *
 * When the Glossa tool registry grows beyond ~20 entries, including every
 * tool's full schema in the initial system prompt becomes wasteful: most
 * conversations only need 5–6 tools and the rest just inflate cache_write
 * cost. We mark rarely-needed tools with `shouldDefer: true` so they're
 * excluded from the default tool spec list. The model invokes `tool_search`
 * with a keyword query; we match against each deferred tool's `searchHint`,
 * `name`, and `spec.description`, and return the schemas of matching tools.
 * The model can then call them on a subsequent turn.
 *
 * Mirrors upstream Claude Code's ToolSearchTool. Simplified: we always
 * return the schemas inline as a JSON block in the tool result, rather than
 * having a separate deferred-loading channel.
 */

import { TOOLS } from '../tools';
import { buildTool, type ToolImpl } from './_shared';

interface MatchedTool {
  name: string;
  description: string;
  searchHint?: string;
  parameters: any;
  /** Match score — higher is better. Used for sorting in result. */
  score: number;
}

/** Tokenize a query into lower-cased word tokens. */
function tokens(q: string): string[] {
  return q.toLowerCase().split(/[^a-z0-9_]+/).filter(t => t.length > 1);
}

/** Score a deferred tool against the query. Each query token that appears in
 *  any of `name`, `searchHint`, `spec.description` adds points. Name hits
 *  weigh most (×3), hint next (×2), description ×1. */
function scoreTool(tool: ToolImpl, queryTokens: string[]): number {
  const name = tool.spec.name.toLowerCase();
  const hint = (tool.searchHint ?? '').toLowerCase();
  const desc = (tool.spec.description ?? '').toLowerCase();
  let score = 0;
  for (const t of queryTokens) {
    if (name.includes(t)) score += 3;
    if (hint.includes(t)) score += 2;
    if (desc.includes(t)) score += 1;
  }
  return score;
}

export const toolSearchTool: ToolImpl = buildTool({
  spec: {
    name: 'tool_search',
    description:
      'Search the deferred-tool catalog by keyword. Some specialty tools ' +
      '(plugin bridges, legacy tools) are not loaded in the default tool list ' +
      'to save context budget. Use this tool to discover them, then call ' +
      'them by name in a subsequent turn. Two query forms: keyword search ' +
      '(e.g. "dataview query") or explicit selection ("select:foo,bar").',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keyword phrase OR "select:tool1,tool2" for direct fetch.' },
        max_results: { type: 'number', description: 'Maximum number of tools to return (default 5).' },
      },
      required: ['query'],
    },
  },
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  searchHint: 'find deferred tools by keyword',
  describe: a => `tool_search: ${String(a?.query ?? '').slice(0, 40)}`,
  run: async (_app, args) => {
    const query = String(args?.query ?? '').trim();
    if (!query) return 'Error: query is required.';
    const maxResults = Number.isFinite(args?.max_results) ? Math.max(1, Math.min(20, Number(args.max_results))) : 5;

    // Explicit selection mode: "select:name1,name2,name3".
    if (query.startsWith('select:')) {
      const names = query.slice(7).split(',').map(s => s.trim()).filter(Boolean);
      const out: MatchedTool[] = [];
      for (const n of names) {
        const t = TOOLS[n];
        if (!t) continue;
        out.push({
          name: t.spec.name,
          description: t.spec.description,
          searchHint: t.searchHint,
          parameters: t.spec.parameters,
          score: 100,
        });
      }
      if (out.length === 0) return `No tool matched any of: ${names.join(', ')}.`;
      return formatResults(out);
    }

    // Keyword search across ALL deferred tools.
    const qts = tokens(query);
    if (qts.length === 0) return 'Error: query has no searchable tokens.';
    const deferred = Object.values(TOOLS).filter(t => t.shouldDefer);
    const scored: MatchedTool[] = [];
    for (const t of deferred) {
      const score = scoreTool(t, qts);
      if (score <= 0) continue;
      scored.push({
        name: t.spec.name,
        description: t.spec.description,
        searchHint: t.searchHint,
        parameters: t.spec.parameters,
        score,
      });
    }
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, maxResults);
    if (top.length === 0) {
      const deferredNames = deferred.map(t => t.spec.name).join(', ') || '(none)';
      return `No deferred tools matched "${query}". Available deferred tools: ${deferredNames}.`;
    }
    return formatResults(top);
  },
});

function formatResults(matches: MatchedTool[]): string {
  const lines = ['Found ' + matches.length + ' tool(s). Schemas below — invoke by name on the next turn:'];
  for (const m of matches) {
    lines.push('');
    lines.push(`## ${m.name}`);
    lines.push(m.description);
    if (m.searchHint) lines.push(`_hint: ${m.searchHint}_`);
    lines.push('```json');
    lines.push(JSON.stringify({ name: m.name, parameters: m.parameters }, null, 2));
    lines.push('```');
  }
  return lines.join('\n');
}
