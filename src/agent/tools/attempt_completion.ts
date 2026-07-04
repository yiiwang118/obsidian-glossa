/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-duplicate-type-constituents, @typescript-eslint/only-throw-error, @typescript-eslint/no-unused-vars -- Dynamic plugin and host-app boundaries validate these values at runtime. */
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
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-duplicate-type-constituents, @typescript-eslint/only-throw-error, @typescript-eslint/no-unused-vars -- Re-enable review lint rules after dynamic boundary module. */
