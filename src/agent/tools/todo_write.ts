import { buildTool, type ToolImpl } from './_shared';

export const todoWrite: ToolImpl = buildTool({
  // The todo list is plan-tracking, not vault mutation — safe to default to
  // not requiring approval. isReadOnly is `false` (it does modify session
  // state), but isDestructive is also `false` (it doesn't touch the vault).
  isReadOnly: () => false,
  isDestructive: () => false,
  isConcurrencySafe: () => false,    // one plan at a time
  dangerous: false,
  searchHint: 'plan multi-step task with todos',
  describe: a => `update todo list (${(a.items ?? []).length} items)`,
  spec: {
    name: 'todo_write',
    description: 'Maintain a visible plan for multi-step tasks. Pass the FULL list each call — items not included are removed. Always keep EXACTLY ONE item in_progress at a time. Update statuses promptly after finishing each sub-task. Skip for trivial 1-2 step tasks.\n\nEach item needs TWO forms (matching upstream Claude Code):\n- content: imperative ("Fix authentication bug")\n- activeForm: present continuous ("Fixing authentication bug") — shown as the live status text during execution.',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'Ordered list of todo items.',
          items: {
            type: 'object',
            properties: {
              content:    { type: 'string', description: 'Imperative form, e.g. "Run tests".' },
              activeForm: { type: 'string', description: 'Present-continuous form, e.g. "Running tests". Shown in the live status.' },
              status:     { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
            },
            required: ['content', 'activeForm', 'status'],
          },
        },
      },
      required: ['items'],
    },
  },
  run: async (_app, { items }) => {
    if (!Array.isArray(items)) return 'Error: items must be an array.';
    const inProg = items.filter((i: any) => i.status === 'in_progress').length;
    if (inProg > 1) return `Error: ${inProg} items marked in_progress — exactly one allowed at a time.`;
    const lines = items.map((it: any, idx: number) => {
      const mark = it.status === 'completed' ? '[x]'
                : it.status === 'in_progress' ? '[→]'
                : '[ ]';
      const label = it.status === 'in_progress' && it.activeForm ? it.activeForm : it.content;
      return `${mark} ${idx + 1}. ${label}`;
    });
    return lines.join('\n');
  },
});
