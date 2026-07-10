/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- Dynamic plugin and host-app boundaries validate these values at runtime. */
import { buildTool, type ToolImpl } from './_shared';

export const todoWrite: ToolImpl = buildTool({
  // The todo list is plan-tracking, not vault mutation — safe to default to
  // not requiring approval. It changes only transient plan UI, so it counts
  // as read-only for vault permission and remains usable in Plan mode.
  isReadOnly: () => true,
  isDestructive: () => false,
  isConcurrencySafe: () => false,    // one plan at a time
  dangerous: false,
  searchHint: 'plan multi-step task with todos',
  describe: a => `update todo list (${(a.items ?? []).length} items)`,
  spec: {
    name: 'todo_write',
    description: 'Maintain the complete visible plan for a task with at least three distinct steps. Every call replaces the full list. Keep exactly one item in_progress while work remains, mark items completed immediately, and skip this tool for trivial tasks.',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          description: 'Ordered list of todo items.',
          items: {
            type: 'object',
            properties: {
              content:    { type: 'string', minLength: 1, maxLength: 180, description: 'Imperative outcome, for example "Run tests".' },
              activeForm: { type: 'string', minLength: 1, maxLength: 180, description: 'Present-continuous status shown while active, for example "Running tests".' },
              status:     { type: 'string', enum: ['pending', 'in_progress', 'completed'], description: 'Current item state.' },
            },
            required: ['content', 'activeForm', 'status'],
            additionalProperties: false,
          },
        },
      },
      required: ['items'],
      additionalProperties: false,
    },
  },
  run: async (_app, { items }) => {
    if (!Array.isArray(items)) return 'Error: items must be an array.';
    const inProg = items.filter((i: AnyValue) => i.status === 'in_progress').length;
    if (inProg > 1) return `Error: ${inProg} items marked in_progress — exactly one allowed at a time.`;
    if (items.some((i: AnyValue) => i.status !== 'completed') && inProg !== 1) {
      return 'Error: exactly one item must be in_progress while unfinished items remain.';
    }
    const lines = items.map((it: AnyValue, idx: number) => {
      const mark = it.status === 'completed' ? '[x]'
                : it.status === 'in_progress' ? '[→]'
                : '[ ]';
      const label = it.status === 'in_progress' && it.activeForm ? it.activeForm : it.content;
      return `${mark} ${idx + 1}. ${label}`;
    });
    return lines.join('\n');
  },
});
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- Re-enable review lint rules after dynamic boundary module. */
