import type { MessageInput } from '../providers/types';
import { collectPrunableToolCallIds, filterPrunedToolContext } from './context_pruning';
import { estimateTokens } from './tokens';

// Automatic pruning is conservative even for unknown third-party tools.
const READ_TOOLS = new Set(['read_note', 'read_files', 'read_pdf', 'view_image', 'search', 'search_vault', 'search_notes', 'grep', 'glob', 'list_files', 'list_folder', 'web_search', 'web_fetch', 'fetch_url', 'get_backlinks', 'get_outgoing_links']);
export function contextTokens(messages: readonly MessageInput[]): number {
  return estimateTokens(JSON.stringify(messages));
}

export function pruneUnderPressure(messages: readonly MessageInput[], budget: number): { messages: MessageInput[]; ids: string[]; before: number; after: number } {
  const before = contextTokens(messages);
  if (!(budget > 0) || before <= budget) return { messages: [...messages], ids: [], before, after: before };
  const eligible = collectPrunableToolCallIds(messages);
  const lastCalls = [...messages].reverse().find(m => m.role === 'assistant' && m.toolCalls?.length)?.toolCalls ?? [];
  const protectedIds = new Set(lastCalls.map(c => c.id));
  const names = new Map(messages.flatMap(m => (m.toolCalls ?? []).map(c => [c.id, c.name] as const)));
  const candidates = messages.filter(m => m.role === 'tool' && m.toolCallId && eligible.has(m.toolCallId)
    && !protectedIds.has(m.toolCallId) && READ_TOOLS.has(m.toolName ?? names.get(m.toolCallId) ?? '') && m.content.length > 2000);
  const ids = new Set<string>();
  let result = [...messages], after = before;
  for (const candidate of candidates) {
    ids.add(candidate.toolCallId);
    result = filterPrunedToolContext(messages, ids);
    after = contextTokens(result);
    if (after <= budget) break;
  }
  return { messages: result, ids: [...ids], before, after };
}
