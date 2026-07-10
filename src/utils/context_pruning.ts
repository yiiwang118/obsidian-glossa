import type { MessageInput } from '../providers/types';

export const CONTEXT_PRUNE_TOOL_NAME = 'context_prune';

const NON_PRUNABLE_TOOLS = new Set([
  CONTEXT_PRUNE_TOOL_NAME,
  'skill',
  'tool_search',
  'todo_write',
  'attempt_completion',
  'write_note',
  'create_note',
  'append_to_note',
  'edit_section',
  'delete_note',
  'file_edit',
  'apply_patch',
  'patch_note',
  'manage_frontmatter',
  'manage_tags',
  'rename_note',
  'patch_canvas',
  'get_periodic_note',
  'open_in_editor',
  'set_selection',
  'templater_render',
  'download_file',
]);

export interface ContextPruneRequest {
  mode: 'selected' | 'all';
  toolCallIds?: string[];
  reason?: string;
}

export interface ContextPruneOutcome {
  acceptedToolCallIds: string[];
  ignoredToolCallIds: string[];
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function toolNamesByCallId(messages: readonly MessageInput[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const message of messages) {
    for (const call of message.toolCalls ?? []) names.set(call.id, call.name);
    if (message.role === 'tool' && message.toolCallId && message.toolName) {
      names.set(message.toolCallId, message.toolName);
    }
  }
  return names;
}

function isPrunableToolName(name: string | undefined): boolean {
  return Boolean(name && !NON_PRUNABLE_TOOLS.has(name));
}

/** Return successful historical read/search calls that may leave model context. */
export function collectPrunableToolCallIds(
  messages: readonly MessageInput[],
  currentToolCallId?: string,
): Set<string> {
  const names = toolNamesByCallId(messages);
  const ids = new Set<string>();
  for (const message of messages) {
    if (message.role !== 'tool' || !message.toolCallId) continue;
    if (message.toolCallId === currentToolCallId) break;
    if (message.toolIsError || !isPrunableToolName(names.get(message.toolCallId))) continue;
    ids.add(message.toolCallId);
  }
  return ids;
}

export function resolveContextPruneRequest(
  messages: readonly MessageInput[],
  request: ContextPruneRequest,
  currentToolCallId?: string,
): ContextPruneOutcome {
  const prunable = collectPrunableToolCallIds(messages, currentToolCallId);
  const requested = request.mode === 'all'
    ? [...prunable]
    : uniqueStrings(request.toolCallIds ?? []);
  return {
    acceptedToolCallIds: requested.filter(id => prunable.has(id)),
    ignoredToolCallIds: requested.filter(id => !prunable.has(id)),
  };
}

/**
 * Remove selected tool calls only from the next model request. The original
 * message array remains untouched, so visible chat history and audit data stay complete.
 */
export function filterPrunedToolContext(
  messages: readonly MessageInput[],
  prunedToolCallIds: ReadonlySet<string>,
): MessageInput[] {
  if (prunedToolCallIds.size === 0) return [...messages];
  const names = toolNamesByCallId(messages);
  const out: MessageInput[] = [];

  for (const message of messages) {
    if (
      message.role === 'tool' &&
      message.toolCallId &&
      prunedToolCallIds.has(message.toolCallId) &&
      isPrunableToolName(names.get(message.toolCallId))
    ) {
      continue;
    }

    if (message.role !== 'assistant' || !message.toolCalls?.length) {
      out.push(message);
      continue;
    }

    const toolCalls = message.toolCalls.filter(call => (
      !prunedToolCallIds.has(call.id) || !isPrunableToolName(call.name)
    ));
    if (toolCalls.length === message.toolCalls.length) {
      out.push(message);
    } else if (toolCalls.length > 0) {
      out.push({ ...message, toolCalls });
    } else if (message.content || message.reasoningContent) {
      out.push({ ...message, toolCalls: undefined });
    }
  }
  return out;
}

function recordedIds(text: string): string[] {
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const record = value as Record<string, unknown>;
    const candidate = record.accepted_tool_call_ids ?? record.acceptedToolCallIds;
    if (!Array.isArray(candidate)) return [];
    return uniqueStrings(candidate.filter((item): item is string => typeof item === 'string'));
  } catch {
    return [];
  }
}

/** Restore prune state recorded by context_prune in earlier user turns. */
export function collectRecordedPrunedToolCallIds(messages: readonly MessageInput[]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    if (message.role !== 'tool' || message.toolName !== CONTEXT_PRUNE_TOOL_NAME || message.toolIsError) continue;
    for (const id of recordedIds(message.content)) ids.add(id);
  }
  return ids;
}

export function formatContextPruneOutcome(
  request: ContextPruneRequest,
  outcome: ContextPruneOutcome,
): string {
  return JSON.stringify({
    tool: CONTEXT_PRUNE_TOOL_NAME,
    operation: request.mode === 'all' ? 'prune_all' : 'prune_selected',
    accepted_tool_call_ids: outcome.acceptedToolCallIds,
    ignored_tool_call_ids: outcome.ignoredToolCallIds,
    reason: request.reason?.trim() || null,
  }, null, 2);
}
