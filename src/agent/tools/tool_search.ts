/* eslint-disable @typescript-eslint/no-unsafe-member-access -- Dynamic plugin and host-app boundaries validate these values at runtime. */
/** Load schemas for specialized tools omitted from the default model surface. */
import { TOOLS, getTool, isToolAvailableForModel } from '../tools';
import { buildTool, type ToolImpl, type ToolRunResult } from './_shared';

interface MatchedTool {
  tool: ToolImpl;
  score: number;
}

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'tool', 'use', 'with',
]);

const QUERY_EXPANSIONS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['编辑', ['edit', 'patch', 'replace', 'write']],
  ['修改', ['edit', 'patch', 'replace']],
  ['覆盖', ['overwrite', 'write']],
  ['创建', ['create', 'write']],
  ['新建', ['create', 'write']],
  ['追加', ['append', 'patch']],
  ['删除', ['delete', 'remove']],
  ['重命名', ['rename', 'move']],
  ['移动', ['move', 'rename']],
  ['标签', ['tag', 'tags']],
  ['属性', ['frontmatter', 'metadata', 'property']],
  ['元数据', ['frontmatter', 'metadata']],
  ['反链', ['backlink', 'backlinks']],
  ['出链', ['outgoing', 'wikilink']],
  ['链接', ['link', 'wikilink', 'resolve']],
  ['周期笔记', ['periodic', 'daily', 'weekly', 'monthly']],
  ['日记', ['periodic', 'daily']],
  ['画布', ['canvas', 'node', 'edge']],
  ['流程图', ['canvas', 'node', 'edge']],
  ['思维导图', ['canvas', 'node', 'edge']],
  ['打开', ['open', 'editor']],
  ['跳转', ['open', 'editor', 'heading']],
  ['选中', ['selection', 'cursor']],
  ['光标', ['selection', 'cursor']],
  ['模板', ['template', 'templater', 'render']],
  ['任务查询', ['tasks', 'query']],
  ['数据库', ['dataview', 'query', 'table']],
  ['表格查询', ['dataview', 'query', 'table']],
  ['网页搜索', ['web', 'search']],
  ['技能', ['skill', 'playbook']],
  ['批量读取', ['batch', 'read', 'files']],
  ['多文件', ['batch', 'read', 'files']],
  ['校验技能', ['validate', 'skill', 'quality']],
  ['检查技能', ['validate', 'skill', 'quality']],
];

function normalize(value: string): string {
  return value.normalize('NFKC').toLowerCase().trim();
}

/** Tokenize English and localized capability requests, then add a small set
 *  of deterministic domain synonyms. This avoids an embedding dependency in
 *  the hot path while making common Chinese requests discoverable. */
export function toolSearchTerms(query: string): string[] {
  const normalized = normalize(query);
  const out = new Set<string>();
  for (const match of normalized.matchAll(/[\p{L}\p{N}_]+/gu)) {
    const token = match[0];
    if (token.length > 1 && !STOP_WORDS.has(token)) out.add(token);
    for (const part of token.split('_')) {
      if (part.length > 1 && !STOP_WORDS.has(part)) out.add(part);
    }
  }
  for (const [trigger, expansions] of QUERY_EXPANSIONS) {
    if (!normalized.includes(trigger)) continue;
    for (const expansion of expansions) out.add(expansion);
  }
  return [...out];
}

function scoreTool(tool: ToolImpl, terms: readonly string[], rawQuery: string): number {
  const name = normalize(tool.spec.name);
  const aliases = (tool.aliases ?? []).map(normalize);
  const hint = normalize(tool.searchHint ?? '');
  const tags = (tool.searchTags ?? []).map(normalize);
  const description = normalize(tool.spec.description);
  const parameterSchema = tool.spec.parameters as { properties?: Record<string, unknown> };
  const parameterNames = Object.keys(parameterSchema.properties ?? {}).map(normalize);
  const phrase = normalize(rawQuery);
  let score = 0;
  let covered = 0;

  if (phrase && name === phrase) score += 40;
  else if (phrase.length > 2 && name.includes(phrase)) score += 16;
  if (aliases.some(alias => alias === phrase)) score += 32;

  for (const term of terms) {
    let hit = false;
    if (name === term) { score += 14; hit = true; }
    else if (name.includes(term)) { score += 8; hit = true; }
    if (aliases.some(alias => alias === term)) { score += 12; hit = true; }
    else if (aliases.some(alias => alias.includes(term))) { score += 7; hit = true; }
    if (tags.some(tag => tag === term)) { score += 9; hit = true; }
    else if (tags.some(tag => tag.includes(term))) { score += 5; hit = true; }
    if (hint.includes(term)) { score += 4; hit = true; }
    if (parameterNames.some(parameter => parameter.includes(term))) { score += 3; hit = true; }
    if (description.includes(term)) { score += 1; hit = true; }
    if (hit) covered += 1;
  }
  if (terms.length > 1 && covered === terms.length) score += 6;
  return score;
}

export function searchDeferredTools(query: string, maxResults = 5): ToolImpl[] {
  const terms = toolSearchTerms(query);
  if (terms.length === 0) return [];
  const matches: MatchedTool[] = [];
  for (const tool of Object.values(TOOLS)) {
    if (!tool.shouldDefer || !isToolAvailableForModel(tool.spec.name, { includeDeferred: true })) continue;
    const score = scoreTool(tool, terms, query);
    if (score > 0) matches.push({ tool, score });
  }
  matches.sort((a, b) => b.score - a.score || a.tool.spec.name.localeCompare(b.tool.spec.name));
  return matches.slice(0, Math.max(1, Math.min(8, maxResults))).map(match => match.tool);
}

export const toolSearchTool: ToolImpl = buildTool({
  spec: {
    name: 'tool_search',
    description: [
      'Load specialized local tools that are omitted from the default tool list.',
      'Use only when none of the currently available tools fits the task. Search by capability in the user\'s language, or pass exact_names when you know the tool names.',
      'A successful result makes the returned tools callable on the next assistant step; do not search for the same tool twice.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          minLength: 2,
          description: 'Capability to find, for example "edit Canvas nodes", "反链", or "Dataview query". Legacy "select:name" is also accepted.',
        },
        exact_names: {
          type: 'array',
          minItems: 1,
          maxItems: 8,
          items: { type: 'string' },
          description: 'Exact tool names or aliases to load when already known.',
        },
        max_results: {
          type: 'integer',
          minimum: 1,
          maximum: 8,
          description: 'Maximum search matches to load. Default 5; use a small value.',
        },
      },
      additionalProperties: false,
    },
  },
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  searchHint: 'load a specialized tool by capability or exact name',
  searchTags: ['find tools', 'deferred schema', '工具搜索', '按需工具'],
  describe: args => `tool_search: ${String(args?.query ?? args?.exact_names ?? '').slice(0, 60)}`,
  run: async (_app, args): Promise<ToolRunResult | string> => {
    const exactNames = normalizeExactNames(args?.exact_names, args?.query);
    if (exactNames.length > 0) {
      const matched: ToolImpl[] = [];
      const rejected: string[] = [];
      for (const requested of exactNames) {
        const tool = getTool(requested);
        if (!tool || !isToolAvailableForModel(tool.spec.name, { includeDeferred: true })) {
          rejected.push(requested);
          continue;
        }
        if (!matched.some(existing => existing.spec.name === tool.spec.name)) matched.push(tool);
      }
      if (matched.length === 0) return `Error: no available tool matched: ${rejected.join(', ') || '(empty selection)'}.`;
      return formatLoadedTools(matched, rejected);
    }

    const queryCandidate = args?.query as unknown;
    const query = typeof queryCandidate === 'string' ? queryCandidate.trim() : '';
    if (!query) return 'Error: pass query or exact_names.';
    const maxResultsCandidate = args?.max_results as unknown;
    const maxResults = typeof maxResultsCandidate === 'number' && Number.isInteger(maxResultsCandidate)
      ? maxResultsCandidate
      : 5;
    const matched = searchDeferredTools(query, maxResults);
    if (matched.length === 0) {
      return `No specialized tool matched "${query}". Use a concrete capability such as "backlinks", "Canvas nodes", "frontmatter", or "Dataview query".`;
    }
    return formatLoadedTools(matched, []);
  },
});

function normalizeExactNames(value: unknown, query: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean);
  }
  if (typeof query === 'string' && query.trim().toLowerCase().startsWith('select:')) {
    return query.trim().slice(7).split(',').map(item => item.trim()).filter(Boolean);
  }
  return [];
}

function formatLoadedTools(tools: readonly ToolImpl[], rejected: readonly string[]): ToolRunResult {
  const names = tools.map(tool => tool.spec.name);
  const lines = [
    `Loaded ${names.length} specialized tool${names.length === 1 ? '' : 's'} for the next step: ${names.join(', ')}.`,
    'Call the best matching tool directly next; do not repeat tool_search.',
    ...tools.map(tool => `- ${tool.spec.name}: ${tool.spec.description.replace(/\s+/g, ' ').slice(0, 220)}`),
  ];
  if (rejected.length) lines.push(`Unavailable or unknown: ${rejected.join(', ')}.`);
  return { text: lines.join('\n'), loadedToolNames: names };
}
/* eslint-enable @typescript-eslint/no-unsafe-member-access -- Re-enable review lint rules after dynamic boundary module. */
