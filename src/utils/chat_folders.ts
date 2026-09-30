import type { ChatFolder, ChatSession } from '../types';

export function folderName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, 60);
}

export function normalizeFolders(value: unknown): ChatFolder[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  return value.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const f = item as Partial<ChatFolder>;
    if (typeof f.id !== 'string' || !f.id || ids.has(f.id) || typeof f.name !== 'string') return [];
    const name = folderName(f.name);
    if (!name) return [];
    ids.add(f.id);
    return [{ id: f.id, name, createdAt: typeof f.createdAt === 'number' ? f.createdAt : 0 }];
  });
}

/** Missing/deleted folders always resolve to Unfiled; chats are never deleted. */
export function sessionFolder(session: ChatSession, folders: ChatFolder[]): string {
  return folders.some(f => f.id === session.folderId) ? session.folderId : '';
}
