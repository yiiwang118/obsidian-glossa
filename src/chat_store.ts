import { uid } from './utils/dom';
import { Notice, type App } from 'obsidian';
import type { ChatSession, ChatFolder } from './types';
import { chatMessagesForStorage, purgeTransientChatPayloads } from './utils/chat_storage';
import { folderName, normalizeFolders } from './utils/chat_folders';
import { disarmGoal } from './agent/session_runtime';
import { bi } from './utils/i18n';
interface ChatStoreHost { app: App; manifest: { dir?: string } }

export class ChatStore {
  private sessions: ChatSession[] = [];
  private folders: ChatFolder[] = [];
  private path: string;
  private deletedPath: string;
  private deletedSessionIds = new Map<string, number>();
  private persistQueue: Promise<void> = Promise.resolve();

  constructor(private plugin: ChatStoreHost) {
    this.path = `${plugin.manifest.dir}/chats.json`;
    this.deletedPath = `${plugin.manifest.dir}/chats.deleted.json`;
  }

  private sortAndCap() {
    const sorted = this.sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    for (const s of sorted.slice(100)) this.markDeleted(s.id);
    this.sessions = sorted.slice(0, 100);
  }

  private cloneMessages(messages: ChatSession['messages']): ChatSession['messages'] {
    try {
      return JSON.parse(JSON.stringify(chatMessagesForStorage(messages))) as ChatSession['messages'];
    } catch {
      return chatMessagesForStorage(messages);
    }
  }

  private parseStore(raw: string): { sessions: ChatSession[]; folders: ChatFolder[]; deletedSessionIds: Record<string, number> } {
    const parsed = JSON.parse(raw) as { sessions?: ChatSession[]; folders?: ChatFolder[]; deletedSessionIds?: Record<string, number> } | ChatSession[];
    if (Array.isArray(parsed)) return { sessions: parsed, folders: [], deletedSessionIds: {} };
    return {
      sessions: Array.isArray(parsed?.sessions) ? parsed.sessions : [],
      folders: normalizeFolders(parsed?.folders),
      deletedSessionIds: parsed?.deletedSessionIds && typeof parsed.deletedSessionIds === 'object'
        ? parsed.deletedSessionIds
        : {},
    };
  }

  private isMeaningfulSession(s: ChatSession): boolean {
    if (s.goal || s.inbox?.length) return true;
    return (s.messages ?? []).some(m =>
      (m.content ?? '').trim().length > 0 ||
      (m.displayContent ?? '').trim().length > 0 ||
      (m.reasoningContent ?? '').trim().length > 0 ||
      ((m.toolEvents ?? []).length > 0));
  }

  private markDeleted(id?: string) {
    if (!id) return;
    this.deletedSessionIds.set(id, Math.max(this.deletedSessionIds.get(id) ?? 0, Date.now()));
  }

  private applyDeletedSessionIds(deleted: Record<string, number>) {
    for (const [id, at] of Object.entries(deleted)) {
      if (!id) continue;
      const prev = this.deletedSessionIds.get(id) ?? 0;
      this.deletedSessionIds.set(id, Math.max(prev, Number(at) || Date.now()));
    }
  }

  private deletedRecord(): Record<string, number> {
    const entries = [...this.deletedSessionIds.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2000);
    this.deletedSessionIds = new Map(entries);
    return Object.fromEntries(entries);
  }

  private normalizeSessions(sessions: ChatSession[]): ChatSession[] {
    return sessions.filter(s => this.isMeaningfulSession(s) && !this.deletedSessionIds.has(s.id));
  }

  private async loadDeletedJournal() {
    try {
      if (!(await this.plugin.app.vault.adapter.exists(this.deletedPath))) return;
      const raw = await this.plugin.app.vault.adapter.read(this.deletedPath);
      const parsed = JSON.parse(raw) as { deletedSessionIds?: Record<string, number> };
      if (parsed?.deletedSessionIds) this.applyDeletedSessionIds(parsed.deletedSessionIds);
    } catch (e) {
      console.warn('[Glossa] deleted chat journal load failed', e);
    }
  }

  private async persistDeletedJournal() {
    try {
      const { safeWriteJson } = await import('./utils/safe_write');
      await safeWriteJson(
        this.plugin.app.vault.adapter,
        this.deletedPath,
        { deletedSessionIds: this.deletedRecord(), updatedAt: Date.now() },
        { pretty: true },
      );
    } catch (e) {
      console.warn('[Glossa] deleted chat journal save failed', e);
    }
  }

  private async readStoreFile(path: string): Promise<ReturnType<ChatStore['parseStore']> | null> {
    try {
      if (!(await this.plugin.app.vault.adapter.exists(path))) return null;
      const raw = await this.plugin.app.vault.adapter.read(path);
      return this.parseStore(raw);
    } catch (e) {
      console.warn(`[Glossa] chat recovery skipped unreadable file ${path}`, e);
      return null;
    }
  }

  private async recoveryCandidates(): Promise<string[]> {
    const adapter = this.plugin.app.vault.adapter;
    const candidates: string[] = [];
    if (await adapter.exists(`${this.path}.bak`)) candidates.push(`${this.path}.bak`);
    try {
      const listed = await adapter.list(this.plugin.manifest.dir);
      const conflictFiles = (listed.files ?? [])
        .filter(file => /^chats\.json(?: \d+)?\.json$/.test(file.split('/').pop() ?? file))
        .sort((a, b) => {
          const aNum = Number((a.match(/chats\.json (\d+)\.json$/) ?? [])[1] ?? 0);
          const bNum = Number((b.match(/chats\.json (\d+)\.json$/) ?? [])[1] ?? 0);
          return bNum - aNum;
        });
      candidates.push(...conflictFiles);
    } catch (e) {
      console.warn('[Glossa] chat recovery could not list plugin directory', e);
    }
    return [...new Set(candidates)];
  }

  private async recoverSessionsFromBackups(): Promise<ChatSession[] | null> {
    for (const candidate of await this.recoveryCandidates()) {
      const store = await this.readStoreFile(candidate);
      if (!store || store.sessions.length === 0) continue;
      this.applyDeletedSessionIds(store.deletedSessionIds);
      this.folders = store.folders;
      this.sessions = this.normalizeSessions(store.sessions);
      this.sortAndCap();
      await this.persist();
      new Notice(bi(
        `Glossa restored ${this.sessions.length} chat sessions from ${candidate.split('/').pop()}.`,
        `Glossa 已从 ${candidate.split('/').pop()} 恢复 ${this.sessions.length} 个历史会话。`,
      ), 8000);
      return this.sessions;
    }
    return null;
  }

  async load(legacy?: ChatSession[]) {
    try {
      await this.loadDeletedJournal();
      if (await this.plugin.app.vault.adapter.exists(this.path)) {
        const store = await this.readStoreFile(this.path);
        if (store) {
          this.applyDeletedSessionIds(store.deletedSessionIds);
          this.sessions = store.sessions;
          this.folders = store.folders;
        } else {
          const recovered = await this.recoverSessionsFromBackups();
          if (recovered) this.sessions = recovered;
        }
      } else if (legacy?.length) {
        this.sessions = legacy;
      } else {
        const recovered = await this.recoverSessionsFromBackups();
        if (recovered) this.sessions = recovered;
      }
    } catch (e) { console.warn('[Glossa] chat load failed', e); }

    let migrated = false;
    const beforeFilter = this.sessions.length;
    this.sessions = this.normalizeSessions(this.sessions);
    if (this.sessions.length !== beforeFilter) migrated = true;
    for (const s of this.sessions) {
      disarmGoal(s);
      if (purgeTransientChatPayloads(s.messages ?? []) > 0) migrated = true;
      for (const m of s.messages ?? []) {
        if (Array.isArray(m.contextSnapshot)) {
          for (const it of m.contextSnapshot) {
            if (it && typeof (it as AnyValue).content === 'string') {
              delete (it as AnyValue).content; migrated = true;
            }
          }
        }
      }
    }
    if (migrated) await this.persist();
    else if (this.deletedSessionIds.size > 0) await this.persistDeletedJournal();
  }

  /** Force re-strip all contextSnapshot.content even if previously missed. */
  async purgeLegacyContext() {
    let count = 0;
    for (const s of this.sessions) for (const m of s.messages ?? []) {
      if (Array.isArray(m.contextSnapshot)) {
        for (const it of m.contextSnapshot) {
          if (it && typeof (it as AnyValue).content === 'string') { delete (it as AnyValue).content; count++; }
        }
      }
    }
    await this.persist();
    return count;
  }

  all(): ChatSession[] { return this.sessions; }
  async saveSession(s: ChatSession) {
    if (this.deletedSessionIds.has(s.id)) return;
    const idx = this.sessions.findIndex(x => x.id === s.id);
    if (!this.isMeaningfulSession(s)) {
      if (idx >= 0) {
        this.sessions.splice(idx, 1);
        await this.persist();
      }
      return;
    }
    if (idx >= 0) this.sessions[idx] = s; else this.sessions.push(s);
    this.sortAndCap();
    await this.persist();
  }
  async persist() {
    const write = async () => {
      const { safeWriteJson } = await import('./utils/safe_write');
      const deletedSessionIds = this.deletedRecord();
      await safeWriteJson(this.plugin.app.vault.adapter, this.path, {
        version: 3,
        updatedAt: Date.now(),
        folders: this.folders,
        sessions: this.sessions.map(session => ({
          ...session,
          messages: chatMessagesForStorage(session.messages ?? []),
        })),
        deletedSessionIds,
      }, { pretty: true });
      await this.persistDeletedJournal();
    };
    this.persistQueue = this.persistQueue.then(write, write);
    try {
      await this.persistQueue;
    } catch (e) {
      console.warn('[Glossa] chat save failed', e);
    }
  }
  getSession(id: string): ChatSession | undefined { return this.deletedSessionIds.has(id) ? undefined : this.sessions.find(x => x.id === id); }
  listFolders(): ChatFolder[] { return this.folders.map(f => ({ ...f })); }
  async createFolder(name: string): Promise<ChatFolder | null> {
    const clean = folderName(name);
    if (!clean) return null;
    const existing = this.folders.find(f => f.name.toLocaleLowerCase() === clean.toLocaleLowerCase());
    if (existing) return existing;
    const folder = { id: uid(), name: clean, createdAt: Date.now() };
    this.folders.push(folder);
    await this.persist();
    return folder;
  }
  async renameFolder(id: string, name: string) {
    const folder = this.folders.find(f => f.id === id);
    const clean = folderName(name);
    if (!folder || !clean) return;
    folder.name = clean;
    await this.persist();
  }
  async deleteFolder(id: string) {
    this.folders = this.folders.filter(f => f.id !== id);
    for (const session of this.sessions) if (session.folderId === id) delete session.folderId;
    await this.persist();
  }
  async moveSession(id: string, folderId?: string) {
    const session = this.getSession(id);
    if (!session || (folderId && !this.folders.some(f => f.id === folderId))) return;
    session.folderId = folderId || undefined;
    await this.persist();
  }
  listSessions(): ChatSession[] { return this.normalizeSessions(this.sessions).sort((a, b) => b.updatedAt - a.updatedAt); }
  async deleteSession(id: string) {
    this.markDeleted(id);
    this.sessions = this.sessions.filter(s => s.id !== id);
    await this.persist();
  }
  async renameSession(id: string, title: string) {
    if (this.deletedSessionIds.has(id)) return;
    const s = this.sessions.find(x => x.id === id);
    if (!s) return;
    s.title = title.trim().slice(0, 100);
    s.updatedAt = Date.now();
    await this.persist();
  }
  async duplicateSession(id: string): Promise<ChatSession | null> {
    const src = this.getSession(id);
    if (!src) return null;
    const newId = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
    const copy: ChatSession = {
      ...src,
      id: newId,
      title: `${src.title} (copy)`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: this.cloneMessages(src.messages),
      inbox: [],
      goal: src.goal ? { ...src.goal, phase: 'paused' } : undefined,
      diagnostics: [],
    };
    this.sessions.push(copy);
    this.sortAndCap();
    await this.persist();
    return copy;
  }
  async clearAll() {
    for (const s of this.sessions) this.markDeleted(s.id);
    this.sessions = [];
    await this.persist();
  }
}
