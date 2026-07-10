import type { ChatMessage } from '../types';

type UserPromptMessage = Pick<ChatMessage, 'role' | 'content' | 'displayContent'>;

/** Preserve both representations of a user turn: concise user-authored text
 * for UI/export and the exact model-facing prompt for future context. */
export function captureUserPromptSnapshot(
  message: UserPromptMessage,
  displayContent: string,
  modelContent: string,
): void {
  if (message.role !== 'user') throw new Error('Prompt snapshots can only be captured for user messages.');
  message.displayContent = displayContent;
  message.content = modelContent;
}

export function visibleUserContent(message: UserPromptMessage): string {
  return message.displayContent ?? message.content ?? '';
}
