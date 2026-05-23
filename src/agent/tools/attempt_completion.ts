import { buildTool, type ToolImpl } from './_shared';

export const attemptCompletion: ToolImpl = buildTool({
  isReadOnly: () => true,
  isConcurrencySafe: () => false,
  isDestructive: () => false,
  dangerous: false,
  searchHint: 'signal task is finished',
  describe: () => 'task complete',
  spec: {
    name: 'attempt_completion',
    description: 'Signal that you have finished the user\'s task and should NOT continue with more tool calls. Provide a brief summary of what you did in the "result" field. Use this when the task is fully done.',
    parameters: {
      type: 'object',
      properties: { result: { type: 'string', description: 'Short summary of what was accomplished.' } },
      required: ['result'],
    },
  },
  run: async (_app, { result }) => `[completed] ${result}`,
});
