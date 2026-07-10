/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- Dynamic plugin and host-app boundaries validate these values at runtime. */
/**
 * tasks_query — bridge to the Tasks plugin\'s query DSL.
 *
 * Returns matching tasks as a markdown list. Supports the full Tasks query
 * grammar: `not done`, `due before today`, `path includes Daily/`, `tags
 * include #project`, `short mode`, etc.
 *
 * The Tasks plugin exposes its query engine via two API surfaces depending
 * on version:
 *   - apiV1: { queryTasks({query}) → Promise<Task[]> } (modern)
 *   - api:   legacy hash-bag (we ignore — too unstable)
 */
import { buildTool, type ToolImpl } from './_shared';

interface TasksTaskResult {
  taskLocation?: { tasksFile?: { path?: string }; lineNumber?: number };
  description?: string;
  status?: { symbol?: string };
  dueDate?: unknown;
  scheduledDate?: unknown;
  startDate?: unknown;
  doneDate?: unknown;
  tags?: string[];
  // Different versions expose different shapes; we read defensively below.
  [k: string]: unknown;
}

interface TasksApi {
  queryTasks?: (request: { query: string }) => Promise<unknown>;
}

function objectRecord(value: unknown): Record<string, AnyValue> | null {
  return value && typeof value === 'object' ? value as Record<string, AnyValue> : null;
}

function getTasksApi(app: AnyValue): TasksApi | null {
  const appRecord = objectRecord(app);
  const plugins = objectRecord(objectRecord(appRecord?.plugins)?.plugins);
  const plugin = objectRecord(plugins?.['obsidian-tasks-plugin']);
  const api = objectRecord(plugin?.apiV1) ?? objectRecord(plugin?.api);
  return api as TasksApi | null;
}

function fmtDate(d: unknown): string {
  if (!d) return '';
  if (typeof d === 'string') return d;
  // Tasks uses moment objects — call format if available, else toString.
  const record = objectRecord(d);
  if (typeof record?.format === 'function') return String(record.format('YYYY-MM-DD'));
  return String(d);
}

export const tasksQuery: ToolImpl = buildTool({
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  isDestructive: () => false,
  shouldDefer: true,
  searchHint: 'query tasks plugin filter due tags status',
  searchTags: ['task filter', 'due date checklist', '任务查询', '待办筛选'],
  describe: a => `tasks: ${String(a.query ?? '').replace(/\n/g, ' ').slice(0, 60)}`,
  spec: {
    name: 'tasks_query',
    description: 'Run a read-only Tasks-plugin DSL query, with one filter per line, and return matching tasks as Markdown. Use for due/status/tag/path task filters when the Tasks plugin is enabled.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, description: 'Tasks DSL filters separated by newlines, for example "not done\ndue before today".' },
        max_results: { type: 'integer', minimum: 1, maximum: 2000, description: 'Maximum tasks to return. Default 200.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  run: async (app, args, ctx) => {
    if (ctx?.signal?.aborted) return 'Error: cancelled before start.';
    const api = getTasksApi(app);
    if (!api) return 'Error: Tasks plugin not installed or not enabled.';
    if (typeof api.queryTasks !== 'function') {
      return 'Error: Tasks plugin found, but its API surface is unrecognised (queryTasks unavailable).';
    }
    const q = String(args.query ?? '').trim();
    if (!q) return 'Error: query is required.';
    const max = Math.max(1, Math.min(2000, Number(args.max_results) || 200));
    try {
      const result = await api.queryTasks({ query: q });
      const resultRecord = objectRecord(result);
      const tasks = (resultRecord?.tasks ?? result ?? []) as TasksTaskResult[];
      if (!Array.isArray(tasks) || tasks.length === 0) return `No tasks match.`;
      const cap = tasks.slice(0, max);
      const lines = cap.map(t => {
        const sym = t.status?.symbol ?? ' ';
        const path = t.taskLocation?.tasksFile?.path ?? '?';
        const line = t.taskLocation?.lineNumber;
        const due = fmtDate(t.dueDate);
        const sched = fmtDate(t.scheduledDate);
        const tags = (t.tags ?? []).slice(0, 4).join(' ');
        const meta = [due && `📅 ${due}`, sched && `⏳ ${sched}`, tags].filter(Boolean).join('  ');
        return `- [${sym}] ${t.description ?? '(no description)'}${meta ? `  ${meta}` : ''}  — ${path}${line ? `:${line}` : ''}`;
      });
      const tail = tasks.length > cap.length ? `\n\n[+${tasks.length - cap.length} more truncated]` : '';
      return `${cap.length} of ${tasks.length} task${tasks.length === 1 ? '' : 's'}:\n\n${lines.join('\n')}${tail}`;
    } catch (e) {
      return `Tasks plugin error: ${e?.message ?? e}`;
    }
  },
});
/* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- Re-enable review lint rules after dynamic boundary module. */
