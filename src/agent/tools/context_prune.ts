import { buildTool, type ToolImpl, type ToolRunResult } from './_shared';
import type { ContextPruneRequest } from '../../utils/context_pruning';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean))];
}

export const contextPrune: ToolImpl = buildTool({
  isReadOnly: () => true,
  isConcurrencySafe: () => false,
  isDestructive: () => false,
  searchHint: 'remove stale tool results from model context',
  searchTags: ['context cleanup', 'token efficiency', '上下文裁剪', '清理工具结果'],
  describe: args => `prune context: ${String(record(args).mode ?? 'selected')}`,
  spec: {
    name: 'context_prune',
    description: 'Exclude stale successful read/search results from future model requests without deleting visible chat history. Use after large evidence is no longer needed. Write confirmations, downloads, failures, skill instructions, tool discovery, and the active plan are never pruned.',
    parameters: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['selected', 'all'],
          description: 'Use selected for explicit tool call IDs. Use all only when every eligible historical result is stale.',
        },
        tool_call_ids: {
          type: 'array',
          minItems: 1,
          maxItems: 50,
          items: { type: 'string' },
          description: 'Historical tool call IDs to prune when mode is selected.',
        },
        reason: {
          type: 'string',
          maxLength: 200,
          description: 'Short reason explaining why the results are no longer needed.',
        },
      },
      required: ['mode'],
      additionalProperties: false,
    },
  },
  run: async (_app, args): Promise<ToolRunResult | string> => {
    const input = record(args);
    const mode = input.mode === 'all' ? 'all' : input.mode === 'selected' ? 'selected' : null;
    if (!mode) return 'Error: mode must be selected or all.';
    const ids = stringArray(input.tool_call_ids);
    if (mode === 'selected' && ids.length === 0) return 'Error: tool_call_ids is required when mode is selected.';
    const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 200) : undefined;
    const request: ContextPruneRequest = {
      mode,
      toolCallIds: mode === 'selected' ? ids : undefined,
      reason,
    };
    return {
      text: 'Context prune request queued.',
      contextPruneRequest: request,
    };
  },
});
