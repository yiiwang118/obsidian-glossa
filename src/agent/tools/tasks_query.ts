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
  dueDate?: any;
  scheduledDate?: any;
  startDate?: any;
  doneDate?: any;
  tags?: string[];
  // Different versions expose different shapes; we read defensively below.
  [k: string]: unknown;
}

function getTasksApi(app: any): any | null {
  const plugin = app?.plugins?.plugins?.['obsidian-tasks-plugin'];
  return plugin?.apiV1 ?? plugin?.api ?? null;
}

function fmtDate(d: any): string {
  if (!d) return '';
  if (typeof d === 'string') return d;
  // Tasks uses moment objects — call format if available, else toString.
  if (typeof d?.format === 'function') return d.format('YYYY-MM-DD');
  return String(d);
}

export const tasksQuery: ToolImpl = buildTool({
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  isDestructive: () => false,
  searchHint: 'query tasks plugin filter due tags status',
  describe: a => `tasks: ${String(a.query ?? '').replace(/\n/g, ' ').slice(0, 60)}`,
  spec: {
    name: 'tasks_query',
    description: [
      'Run a Tasks-plugin query against the vault. Requires the Tasks plugin enabled.',
      '',
      'Query is the Tasks DSL (one filter per line). Examples:',
      '  not done',
      '  due before today',
      '  tags include #project',
      '  path includes Daily/',
      '',
      'Returns a markdown checklist the model can drop into a note or report.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        max_results: { type: 'number', description: 'Default 200.' },
      },
      required: ['query'],
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
      const tasks = (result?.tasks ?? result ?? []) as TasksTaskResult[];
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
    } catch (e: any) {
      return `Tasks plugin error: ${e?.message ?? e}`;
    }
  },
});
