import type { ChatMessage } from '../types';

/** Remove model-transport-only payloads before chat persistence. Full image
 * base64 remains available in the live session but does not inflate chats.json
 * or cloud sync; human-readable tool text and all audit metadata are retained. */
export function chatMessagesForStorage(messages: readonly ChatMessage[]): ChatMessage[] {
  return messages.map(message => {
    if (!message.toolEvents?.length) return { ...message };
    return {
      ...message,
      toolEvents: message.toolEvents.map(event => {
        const stored = { ...event } as typeof event & { _modelBoundResult?: unknown };
        delete stored.contentBlocks;
        delete stored._modelBoundResult;
        return stored;
      }),
    };
  });
}

/** Mutating migration used only for objects loaded from older chat stores. */
export function purgeTransientChatPayloads(messages: readonly ChatMessage[]): number {
  let removed = 0;
  for (const message of messages) {
    for (const event of message.toolEvents ?? []) {
      if (event.contentBlocks !== undefined) {
        delete event.contentBlocks;
        removed++;
      }
      const transient = event as typeof event & { _modelBoundResult?: unknown };
      if (transient._modelBoundResult !== undefined) {
        delete transient._modelBoundResult;
        removed++;
      }
    }
  }
  return removed;
}
