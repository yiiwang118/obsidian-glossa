import { uid } from './utils/dom';
import { Notice, type App, type DataAdapter } from 'obsidian';
import type { ChatSession, ChatFolder, ChatMessage } from './types';
import { chatMessagesForStorage, purgeTransientChatPayloads } from './utils/chat_storage';
import { folderName, normalizeFolders } from './utils/chat_folders';
import { disarmGoal } from './agent/session_runtime';
import { recoverRuns } from './agent/run_journal';
import { visibleUserContent } from './utils/prompt_snapshot';
import { safeWrite, safeWriteJson } from './utils/safe_write';
import { bi } from './utils/i18n';
interface ChatStoreHost { app: App; manifest: { dir?: string } }

/** What the history list needs about a chat without reading its file. */
export interface ChatSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  folderId?: string;
  endpointId: string | null;
  messageCount: number;
  /** What the user typed and what the model answered, bounded, for the history search. */
  preview: string;
}

const STORE_VERSION = 4;
const PREVIEW_CHARS = 3000;
/** While a chat streams only its time and preview change, so the index
 *  catches up this much later; an index that missed it heals at load. */
const INDEX_DELAY_MS = 5000;
/** The copy of the single-file store kept when upgrading goes away after this. */
const BACKUP_KEEP_MS = 30 * 24 * 3600_000;

/** Chats with nothing in them are never saved. */
export function isMeaningfulChat(s: ChatSession): boolean {
  if (s.goal || s.inbox?.length) return true;
  return (s.messages ?? []).some(m =>
    (m.content ?? '').trim().length > 0 ||
    (m.displayContent ?? '').trim().length > 0 ||
    (m.reasoningContent ?? '').trim().length > 0 ||
    ((m.toolEvents ?? []).length > 0));
}

/** The text the history search matches: what the user typed (not the prompt
 *  with attached notes and selections) and the answers. Every message gets a
 *  fair share of a bounded budget, so a long chat stays searchable to the end. */
export function chatSearchPreview(messages: readonly ChatMessage[], limit = PREVIEW_CHARS): string {
  const typed: string[] = [];
  const answers: string[] = [];
  for (const m of messages) {
    if (m.role === 'user') typed.push(oneLine(visibleUserContent(m)));
    else if (m.role === 'assistant') answers.push(oneLine(m.content));
  }
  const userPart = fairShare(typed, answers.some(Boolean) ? Math.floor(limit * 2 / 3) : limit);
  const answerPart = fairShare(answers, limit - userPart.length);
  return [userPart, answerPart].filter(Boolean).join('\n').slice(0, limit);
}

function oneLine(text: string | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

/** Join texts within `budget`: short ones whole, long ones cut to an equal share. */
function fairShare(texts: string[], budget: number): string {
  const parts = texts.filter(Boolean);
  const take = parts.map(() => 0);
  let left = Math.max(0, budget - parts.length);
  let open = parts.map((_, i) => i);
  while (left > 0 && open.length) {
    const share = Math.max(1, Math.floor(left / open.length));
    const unfinished: number[] = [];
    for (const i of open) {
      if (left <= 0) break;
      const more = Math.min(share, parts[i].length - take[i], left);
      take[i] += more;
      left -= more;
      if (take[i] < parts[i].length) unfinished.push(i);
    }
    open = unfinished;
  }
  return parts.map((text, i) => text.slice(0, take[i])).filter(Boolean).join('\n');
}

function summarize(session: ChatSession): ChatSummary {
  return {
    id: session.id,
    title: typeof session.title === 'string' ? session.title : '',
    createdAt: Number(session.createdAt) || 0,
    updatedAt: Number(session.updatedAt) || 0,
    ...(session.folderId ? { folderId: session.folderId } : {}),
    endpointId: typeof session.endpointId === 'string' ? session.endpointId : null,
    messageCount: session.messages?.length ?? 0,
    preview: chatSearchPreview(session.messages ?? []),
  };
}

function readSummary(value: unknown): ChatSummary | null {
  if (!value || typeof value !== 'object') return null;
  const s = value as Partial<ChatSummary>;
  if (typeof s.id !== 'string' || !s.id) return null;
  return {
    id: s.id,
    title: typeof s.title === 'string' ? s.title : '',
    createdAt: Number(s.createdAt) || 0,
    updatedAt: Number(s.updatedAt) || 0,
    ...(typeof s.folderId === 'string' && s.folderId ? { folderId: s.folderId } : {}),
    endpointId: typeof s.endpointId === 'string' ? s.endpointId : null,
    messageCount: Number(s.messageCount) || 0,
    preview: typeof s.preview === 'string' ? s.preview.slice(0, PREVIEW_CHARS) : '',
  };
}

/** Chat ids become file names; anything unusual is hashed into a plain name. */
function chatFileName(id: string): string {
  if (/^[A-Za-z0-9_-]{1,100}$/.test(id)) return `${id}.json`;
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) { hash ^= id.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return `x-${(hash >>> 0).toString(36)}-${id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40)}.json`;
}

/** Clean-ups for a chat read from disk; true when its file should be rewritten. */
function prepareLoaded(session: ChatSession): boolean {
  // A restored task needs an explicit resume.
  disarmGoal(session);
  let changed = recoverRuns(session);
  changed = purgeTransientChatPayloads(session.messages ?? []) > 0 || changed;
  for (const m of session.messages ?? []) {
    for (const item of Array.isArray(m.contextSnapshot) ? m.contextSnapshot : []) {
      if (item && typeof (item as { content?: string }).content === 'string') { delete (item as { content?: string }).content; changed = true; }
    }
  }
  return changed;
}

interface ParsedStore {
  /** Entries of the index. */
  summaries: ChatSummary[];
  /** Whole chats, from the single-file store used before 1.1 (or data.json). */
  chats: ChatSession[];
  folders: ChatFolder[];
  deletedSessionIds: Record<string, number>;
  backupAt?: number;
}

function parseStore(raw: string): ParsedStore {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object') throw new Error('chat store is not a JSON object');
  const store = (Array.isArray(parsed) ? {} : parsed) as Record<string, unknown>;
  const list = Array.isArray(parsed) ? parsed : Array.isArray(store.sessions) ? store.sessions as unknown[] : [];
  const summaries: ChatSummary[] = [];
  const chats: ChatSession[] = [];
  for (const item of list) {
    const chat = item as ChatSession | null;
    if (chat && typeof chat === 'object' && Array.isArray(chat.messages)) {
      if (typeof chat.id === 'string' && chat.id) chats.push(chat);
      continue;
    }
    const summary = readSummary(item);
    if (summary) summaries.push(summary);
  }
  const deleted = store.deletedSessionIds;
  return {
    summaries,
    chats,
    folders: normalizeFolders(store.folders),
    deletedSessionIds: deleted && typeof deleted === 'object' ? deleted as Record<string, number> : {},
    backupAt: typeof store.backupAt === 'number' ? store.backupAt : undefined,
  };
}

/** Each chat lives in `chats/<id>.json`, read when it is opened. `chats.json`
 *  is a small index (folders, titles, times, search previews, deleted ids),
 *  so a save writes one chat file and the index, never every chat. There is
 *  no limit on how many chats are kept. */
export class ChatStore {
  private summaries = new Map<string, ChatSummary>();
  /** Chats opened or saved this session; the rest stay on disk until opened. */
  private loaded = new Map<string, ChatSession>();
  private opening = new Map<string, Promise<ChatSession | undefined>>();
  /** Chats whose last write failed; retried before the next index write. */
  private unwritten = new Set<ChatSession>();
  private folders: ChatFolder[] = [];
  private path: string;
  private dir: string;
  private deletedPath: string;
  private backupPath: string;
  private backupAt: number | null = null;
  private deletedSessionIds = new Map<string, number>();
  private journalDirty = false;
  /** The index's previous copy (`.bak`) still lists a deleted chat. */
  private backupListsDeleted = false;
  private scrubIds = new Set<string>();
  private scrubQueued = false;
  private dirReady = false;
  /** chats.json still holds the single-file store: some chat could not be
   *  moved into its own file yet. The index replaces it once every chat is
   *  written, so a failed move is retried instead of dropping the chat. */
  private legacyKept = false;
  private indexTimer: number | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(private plugin: ChatStoreHost) {
    this.path = `${plugin.manifest.dir}/chats.json`;
    this.dir = `${plugin.manifest.dir}/chats`;
    this.deletedPath = `${plugin.manifest.dir}/chats.deleted.json`;
    this.backupPath = `${plugin.manifest.dir}/chats.v3-backup.json`;
  }

  private get adapter(): DataAdapter { return this.plugin.app.vault.adapter; }

  /** Writes run one at a time, in the order they were asked for. */
  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job, job);
    this.queue = run.then((): void => undefined, (): void => undefined);
    return run;
  }

  private chatPath(id: string): string { return `${this.dir}/${chatFileName(id)}`; }

  private markDeleted(id?: string) {
    if (!id) return;
    this.deletedSessionIds.set(id, Math.max(this.deletedSessionIds.get(id) ?? 0, Date.now()));
    this.journalDirty = true;
    this.backupListsDeleted = true;
  }

  private applyDeletedSessionIds(deleted: Record<string, number>, fromJournal = false) {
    for (const [id, at] of Object.entries(deleted)) {
      if (!id) continue;
      const prev = this.deletedSessionIds.get(id) ?? 0;
      const next = Math.max(prev, Number(at) || Date.now());
      if (next === prev) continue;
      this.deletedSessionIds.set(id, next);
      if (!fromJournal) this.journalDirty = true;
    }
  }

  private deletedRecord(): Record<string, number> {
    const entries = [...this.deletedSessionIds.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2000);
    this.deletedSessionIds = new Map(entries);
    return Object.fromEntries(entries);
  }

  private async loadDeletedJournal() {
    try {
      if (!(await this.adapter.exists(this.deletedPath))) return;
      const parsed = JSON.parse(await this.adapter.read(this.deletedPath)) as { deletedSessionIds?: Record<string, number> };
      if (parsed?.deletedSessionIds) this.applyDeletedSessionIds(parsed.deletedSessionIds, true);
    } catch (e: unknown) {
      console.warn('[Glossa] deleted chat journal load failed', e);
    }
  }

  private async persistDeletedJournal() {
    try {
      await safeWriteJson(
        this.adapter,
        this.deletedPath,
        { deletedSessionIds: this.deletedRecord(), updatedAt: Date.now() },
        { pretty: true },
      );
      this.journalDirty = false;
    } catch (e: unknown) {
      console.warn('[Glossa] deleted chat journal save failed', e);
    }
  }

  private async readStoreFile(path: string): Promise<{ store: ParsedStore; raw: string } | null> {
    try {
      if (!(await this.adapter.exists(path))) return null;
      const raw = await this.adapter.read(path);
      return { store: parseStore(raw), raw };
    } catch (e: unknown) {
      console.warn(`[Glossa] chat recovery skipped unreadable file ${path}`, e);
      return null;
    }
  }

  private async recoveryCandidates(): Promise<string[]> {
    const candidates: string[] = [];
    if (await this.adapter.exists(`${this.path}.bak`)) candidates.push(`${this.path}.bak`);
    if (!this.plugin.manifest.dir) return candidates;
    try {
      const listed = await this.adapter.list(this.plugin.manifest.dir);
      const conflictFiles = (listed.files ?? [])
        .filter(file => /^chats\.json(?: \d+)?\.json$/.test(file.split('/').pop() ?? file))
        .sort((a, b) => {
          const aNum = Number((a.match(/chats\.json (\d+)\.json$/) ?? [])[1] ?? 0);
          const bNum = Number((b.match(/chats\.json (\d+)\.json$/) ?? [])[1] ?? 0);
          return bNum - aNum;
        });
      candidates.push(...conflictFiles);
    } catch (e: unknown) {
      console.warn('[Glossa] chat recovery could not list plugin directory', e);
    }
    // The copy kept when upgrading comes last: it is the oldest.
    if (await this.adapter.exists(this.backupPath)) candidates.push(this.backupPath);
    return [...new Set(candidates)];
  }

  private async recoverFromBackups(): Promise<{ store: ParsedStore; raw: string; from: string } | null> {
    for (const candidate of await this.recoveryCandidates()) {
      const found = await this.readStoreFile(candidate);
      if (found && (found.store.chats.length || found.store.summaries.length)) return { ...found, from: candidate };
    }
    return null;
  }

  async load(legacy?: ChatSession[]) {
    let changed = false;
    try {
      await this.loadDeletedJournal();
      let found: { store: ParsedStore; raw: string } | null = await this.readStoreFile(this.path);
      let recoveredFrom = '';
      if (!found) {
        if (legacy?.length && !(await this.adapter.exists(this.path))) {
          found = { store: { summaries: [], chats: legacy, folders: [], deletedSessionIds: {} }, raw: JSON.stringify({ sessions: legacy }) };
        } else {
          const recovered = await this.recoverFromBackups();
          if (recovered) { found = recovered; recoveredFrom = recovered.from; changed = true; }
        }
      }
      if (found) {
        this.applyDeletedSessionIds(found.store.deletedSessionIds);
        this.folders = found.store.folders;
        this.backupAt = found.store.backupAt ?? null;
        for (const summary of found.store.summaries) this.summaries.set(summary.id, summary);
        if (found.store.chats.length) {
          if (await this.importChats(found.store.chats, found.raw)) {
            this.legacyKept = true;
            new Notice(bi(
              'Glossa could not move every chat into its own file and will try again. Your history stays in chats.json.',
              'Glossa 没能把所有对话都存成单独文件，之后会再试；历史记录仍保存在 chats.json 中。',
            ), 10000);
          }
          changed = true;
        }
      }
      if (await this.reconcileFiles()) changed = true;
      if (await this.expireBackup()) changed = true;
      if (recoveredFrom) {
        new Notice(bi(
          `Glossa restored ${this.summaries.size} chat sessions from ${recoveredFrom.split('/').pop()}.`,
          `Glossa 已从 ${recoveredFrom.split('/').pop()} 恢复 ${this.summaries.size} 个历史会话。`,
        ), 8000);
      }
    } catch (e: unknown) { console.warn('[Glossa] chat load failed', e); }
    if (changed) await this.persist();
    else if (this.journalDirty) await this.persistDeletedJournal();
  }

  /** Chats from the single-file store (or data.json) move into one file each.
   *  The old file is kept as chats.v3-backup.json for a month. Returns how
   *  many chats could not be written. */
  private async importChats(chats: ChatSession[], raw: string): Promise<number> {
    try {
      if (!(await this.adapter.exists(this.backupPath))) {
        await this.adapter.write(this.backupPath, raw);
        this.backupAt = Date.now();
      }
    } catch (e: unknown) {
      console.warn('[Glossa] could not keep a copy of the old chat store', e);
    }
    let failed = 0;
    for (const session of chats) {
      if (this.deletedSessionIds.has(session.id) || !isMeaningfulChat(session)) continue;
      // A chat already in its own file wins unless this copy is newer (a
      // recovered backup, or an older Glossa that wrote chats.json again).
      if (await this.adapter.exists(this.chatPath(session.id))) {
        const stored = await this.readChatFile(this.chatPath(session.id));
        if (stored && (Number(stored.updatedAt) || 0) >= (Number(session.updatedAt) || 0)) {
          if (stored.id === session.id) this.summaries.set(session.id, summarize(stored));
          continue;
        }
      }
      prepareLoaded(session);
      this.summaries.set(session.id, summarize(session));
      try {
        await this.writeChat(session);
      } catch (e: unknown) {
        // Kept in memory and written again before the next index write.
        this.loaded.set(session.id, session);
        failed++;
        console.warn(`[Glossa] could not move chat ${session.id} into its own file`, e);
      }
    }
    return failed;
  }

  /** Chats the index lists whose files are gone come back from the copy
   *  kept when upgrading, when it still has them. Returns the ids restored. */
  private async restoreFromBackup(ids: string[]): Promise<Set<string>> {
    const restored = new Set<string>();
    const backup = await this.readStoreFile(this.backupPath);
    if (!backup) return restored;
    const wanted = new Set(ids);
    for (const session of backup.store.chats) {
      if (!wanted.has(session.id) || this.deletedSessionIds.has(session.id) || !isMeaningfulChat(session)) continue;
      prepareLoaded(session);
      this.summaries.set(session.id, summarize(session));
      restored.add(session.id);
      try {
        await this.writeChat(session);
      } catch (e: unknown) {
        this.loaded.set(session.id, session);
        console.warn(`[Glossa] could not restore chat ${session.id} from the upgrade copy`, e);
      }
    }
    return restored;
  }

  /** The index follows the chat files: a file without an entry (another
   *  device, an older Glossa, a lost index) is listed again, and an entry
   *  whose file is gone is dropped. */
  private async reconcileFiles(): Promise<boolean> {
    let changed = false;
    let listed: string[] | null = null;
    try {
      listed = (await this.adapter.exists(this.dir)) ? (await this.adapter.list(this.dir)).files ?? [] : [];
    } catch (e: unknown) {
      console.warn('[Glossa] could not list chat files', e);
    }
    const present = new Map<string, string>();
    for (const file of listed ?? []) {
      const name = file.split('/').pop() ?? file;
      if (name.endsWith('.json')) present.set(name, file);
    }
    const indexed = new Set<string>();
    const missing: string[] = [];
    for (const id of [...this.summaries.keys()]) {
      const name = chatFileName(id);
      indexed.add(name);
      if (this.deletedSessionIds.has(id)) {
        this.summaries.delete(id);
        if (present.has(name)) await this.removeChatFile(id);
        changed = true;
        continue;
      }
      if (present.has(name) || this.loaded.has(id)) continue;
      if (!(await this.adapter.exists(this.chatPath(id)))) missing.push(id);
    }
    if (missing.length) {
      const restored = await this.restoreFromBackup(missing);
      for (const id of missing) if (!restored.has(id)) this.summaries.delete(id);
      changed = true;
    }
    for (const [name, file] of present) {
      if (indexed.has(name)) continue;
      const session = await this.readChatFile(file);
      if (!session || chatFileName(session.id) !== name) continue;
      if (this.deletedSessionIds.has(session.id)) { await this.removeChatFile(session.id); continue; }
      if (!isMeaningfulChat(session)) continue;
      this.summaries.set(session.id, summarize(session));
      changed = true;
    }
    return changed;
  }

  private async expireBackup(): Promise<boolean> {
    try {
      if (!(await this.adapter.exists(this.backupPath))) {
        if (this.backupAt === null) return false;
        this.backupAt = null;
        return true;
      }
      if (this.backupAt === null) { this.backupAt = Date.now(); return true; }
      if (Date.now() - this.backupAt < BACKUP_KEEP_MS) return false;
      await this.adapter.remove(this.backupPath);
      this.backupAt = null;
      return true;
    } catch (e: unknown) {
      console.warn('[Glossa] could not check the old chat store copy', e);
      return false;
    }
  }

  /** A deleted chat leaves the pre-upgrade copy as well. */
  private scrubBackup(ids: Iterable<string>) {
    for (const id of ids) this.scrubIds.add(id);
    if (this.scrubQueued || !this.scrubIds.size) return;
    this.scrubQueued = true;
    void this.enqueue(async () => {
      this.scrubQueued = false;
      const ids = new Set(this.scrubIds);
      this.scrubIds.clear();
      try {
        if (!(await this.adapter.exists(this.backupPath))) return;
        const parsed = JSON.parse(await this.adapter.read(this.backupPath)) as unknown;
        const list = Array.isArray(parsed) ? parsed : (parsed as { sessions?: unknown } | null)?.sessions;
        if (!Array.isArray(list)) return;
        const kept = list.filter(item => !ids.has((item as ChatSession | null)?.id ?? ''));
        if (kept.length === list.length) return;
        if (!kept.length) {
          await this.adapter.remove(this.backupPath);
          this.backupAt = null;
          return;
        }
        await safeWriteJson(this.adapter, this.backupPath, Array.isArray(parsed) ? kept : { ...(parsed as object), sessions: kept }, { keepBackup: false });
      } catch (e: unknown) {
        console.warn('[Glossa] could not remove a deleted chat from the old chat store copy', e);
      }
    });
  }

  private async readChatFile(path: string): Promise<ChatSession | null> {
    try {
      const parsed = JSON.parse(await this.adapter.read(path)) as { session?: ChatSession } | ChatSession | null;
      const session = parsed && typeof parsed === 'object' && 'session' in parsed ? parsed.session : parsed as ChatSession | null;
      if (!session || typeof session.id !== 'string' || !session.id || !Array.isArray(session.messages)) return null;
      return session;
    } catch (e: unknown) {
      console.warn(`[Glossa] could not read chat file ${path}`, e);
      return null;
    }
  }

  private async writeChat(session: ChatSession) {
    if (this.deletedSessionIds.has(session.id)) return;
    try {
      if (!this.dirReady) {
        if (!(await this.adapter.exists(this.dir))) await this.adapter.mkdir(this.dir);
        this.dirReady = true;
      }
      await safeWriteJson(this.adapter, this.chatPath(session.id), {
        version: STORE_VERSION,
        session: { ...session, messages: chatMessagesForStorage(session.messages ?? []) },
      }, { keepBackup: false });
      this.unwritten.delete(session);
    } catch (e: unknown) {
      this.unwritten.add(session);
      throw e;
    }
  }

  private async removeChatFile(id: string) {
    try {
      if (await this.adapter.exists(this.chatPath(id))) await this.adapter.remove(this.chatPath(id));
    } catch (e: unknown) {
      console.warn(`[Glossa] could not remove chat file for ${id}`, e);
    }
  }

  private async writeIndex(dropDeletedFromBackup: boolean) {
    for (const session of [...this.unwritten]) {
      try { await this.writeChat(session); } catch { /* kept for the next try */ }
    }
    if (this.legacyKept) {
      if (this.unwritten.size) {
        // The single-file store stays until every chat has its own file.
        if (dropDeletedFromBackup) this.backupListsDeleted = true;
        if (this.journalDirty) await this.persistDeletedJournal();
        return;
      }
      this.legacyKept = false;
    }
    const json = JSON.stringify({
      version: STORE_VERSION,
      updatedAt: Date.now(),
      folders: this.folders,
      sessions: this.sortedSummaries(),
      deletedSessionIds: this.deletedRecord(),
      ...(this.backupAt ? { backupAt: this.backupAt } : {}),
    });
    await safeWrite(this.adapter, this.path, json, { keepBackup: !dropDeletedFromBackup });
    // The previous copy still listed the deleted chats; it becomes this one.
    if (dropDeletedFromBackup) await this.adapter.write(`${this.path}.bak`, json);
    if (this.journalDirty) await this.persistDeletedJournal();
  }

  /** Index writes that follow chat saves wait a few seconds. */
  private touchIndex() {
    if (this.indexTimer !== null) return;
    this.indexTimer = window.setTimeout(() => {
      this.indexTimer = null;
      void this.persist();
    }, INDEX_DELAY_MS);
  }

  /** Write the index now. */
  async persist() {
    if (this.indexTimer !== null) { window.clearTimeout(this.indexTimer); this.indexTimer = null; }
    const dropDeleted = this.backupListsDeleted;
    this.backupListsDeleted = false;
    try {
      await this.enqueue(() => this.writeIndex(dropDeleted));
    } catch (e: unknown) {
      if (dropDeleted) this.backupListsDeleted = true;
      console.warn('[Glossa] chat index save failed', e);
    }
  }

  /** Finish waiting writes, including an index write that was put off. */
  async flush() {
    if (this.indexTimer !== null) await this.persist();
    else await this.queue;
  }

  /** Force re-strip all contextSnapshot.content even if previously missed. */
  async purgeLegacyContext(): Promise<number> {
    let count = 0;
    await this.rewriteChats([...this.summaries.keys()], session => {
      let stripped = 0;
      for (const m of session.messages ?? []) {
        for (const item of Array.isArray(m.contextSnapshot) ? m.contextSnapshot : []) {
          if (item && typeof (item as { content?: string }).content === 'string') { delete (item as { content?: string }).content; stripped++; }
        }
      }
      count += stripped;
      return stripped > 0;
    });
    return count;
  }

  /** Chats that used a deleted endpoint fall back to the active one. */
  async detachEndpoint(endpointId: string): Promise<number> {
    const ids = [...this.summaries.values()].filter(s => s.endpointId === endpointId).map(s => s.id);
    return this.rewriteChats(ids, session => {
      if (session.endpointId !== endpointId) return false;
      session.endpointId = null;
      return true;
    });
  }

  /** Change chats whether opened or not; unopened ones are read one at a time
   *  and not kept in memory. Returns how many changed. */
  private async rewriteChats(ids: string[], edit: (session: ChatSession) => boolean): Promise<number> {
    let changed = 0;
    for (const id of ids) {
      if (this.deletedSessionIds.has(id)) continue;
      let session = this.loaded.get(id) ?? await this.readChatFile(this.chatPath(id));
      // Opened while the file was being read: change the copy in use.
      session = this.loaded.get(id) ?? session;
      if (!session || session.id !== id || this.deletedSessionIds.has(id) || !edit(session)) continue;
      changed++;
      this.summaries.set(id, summarize(session));
      const target = session;
      try { await this.enqueue(() => this.writeChat(target)); } catch (e: unknown) { console.warn('[Glossa] chat save failed', e); }
    }
    if (changed) await this.persist();
    return changed;
  }

  private sortedSummaries(): ChatSummary[] {
    return [...this.summaries.values()]
      .filter(s => !this.deletedSessionIds.has(s.id))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** Every chat, newest first, without reading chat files. */
  listSessions(): ChatSummary[] { return this.sortedSummaries(); }

  hasSession(id: string): boolean {
    return !this.deletedSessionIds.has(id) && (this.summaries.has(id) || this.loaded.has(id));
  }

  /** The chat in memory, if it was opened or saved this session. */
  loadedSession(id: string): ChatSession | undefined {
    return this.deletedSessionIds.has(id) ? undefined : this.loaded.get(id);
  }

  /** The whole chat, read from its file the first time. */
  async openSession(id: string): Promise<ChatSession | undefined> {
    if (this.deletedSessionIds.has(id)) return undefined;
    const cached = this.loaded.get(id);
    if (cached) return cached;
    if (!this.summaries.has(id)) return undefined;
    const pending = this.opening.get(id);
    if (pending !== undefined) return pending;
    const reading = this.readSession(id).finally(() => this.opening.delete(id));
    this.opening.set(id, reading);
    return reading;
  }

  private async readSession(id: string): Promise<ChatSession | undefined> {
    const session = await this.readChatFile(this.chatPath(id));
    if (!session || session.id !== id || this.deletedSessionIds.has(id)) return undefined;
    // A save may have put a newer copy in memory while the file was read.
    const raced = this.loaded.get(id);
    if (raced) return raced;
    const rewrite = prepareLoaded(session);
    this.loaded.set(id, session);
    this.summaries.set(id, summarize(session));
    if (rewrite) void this.enqueue(() => this.writeChat(session)).catch(e => console.warn('[Glossa] chat save failed', e));
    return session;
  }

  /** List a chat at once without writing it; its next save writes it. */
  track(session: ChatSession) {
    if (this.deletedSessionIds.has(session.id) || !isMeaningfulChat(session)) return;
    this.loaded.set(session.id, session);
    this.summaries.set(session.id, summarize(session));
  }

  async saveSession(s: ChatSession) { await this.saveSessions([s]); }

  /** Write each chat to its own file; the index follows a few seconds later. */
  async saveSessions(list: ChatSession[]) {
    const writes: ChatSession[] = [];
    let removed = false;
    for (const s of list) {
      if (this.deletedSessionIds.has(s.id)) continue;
      if (!isMeaningfulChat(s)) {
        if (this.summaries.delete(s.id)) {
          this.loaded.delete(s.id);
          this.unwritten.delete(s);
          void this.enqueue(() => this.removeChatFile(s.id));
          removed = true;
        }
        continue;
      }
      this.loaded.set(s.id, s);
      this.summaries.set(s.id, summarize(s));
      writes.push(s);
    }
    if (writes.length) {
      try {
        await this.enqueue(async () => { for (const s of writes) await this.writeChat(s); });
      } catch (e: unknown) {
        console.warn('[Glossa] chat save failed', e);
      }
    }
    if (removed) await this.persist();
    else if (writes.length) this.touchIndex();
  }

  /** Write one chat and the index at once (actions in the history list). */
  private async saveNow(session: ChatSession) {
    this.loaded.set(session.id, session);
    this.summaries.set(session.id, summarize(session));
    try {
      await this.enqueue(() => this.writeChat(session));
    } catch (e: unknown) {
      console.warn('[Glossa] chat save failed', e);
    }
    await this.persist();
  }

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
    // An unopened chat file that still names the folder reads as unfiled.
    for (const summary of this.summaries.values()) if (summary.folderId === id) delete summary.folderId;
    for (const session of this.loaded.values()) {
      if (session.folderId !== id) continue;
      delete session.folderId;
      void this.enqueue(() => this.writeChat(session)).catch(e => console.warn('[Glossa] chat save failed', e));
    }
    await this.persist();
  }
  async moveSession(id: string, folderId?: string) {
    if (folderId && !this.folders.some(f => f.id === folderId)) return;
    const session = await this.openSession(id);
    if (!session) return;
    session.folderId = folderId || undefined;
    await this.saveNow(session);
  }
  async deleteSession(id: string) {
    await this.deleteSessions([id]);
  }
  async deleteSessions(ids: string[]) {
    for (const id of ids) {
      this.markDeleted(id);
      this.summaries.delete(id);
      const session = this.loaded.get(id);
      if (session) this.unwritten.delete(session);
      this.loaded.delete(id);
      void this.enqueue(() => this.removeChatFile(id));
    }
    this.scrubBackup(ids);
    await this.persist();
  }
  async renameSession(id: string, title: string) {
    const s = await this.openSession(id);
    if (!s) return;
    s.title = title.trim().slice(0, 100);
    s.updatedAt = Date.now();
    await this.saveNow(s);
  }
  async duplicateSession(id: string): Promise<ChatSession | null> {
    const src = await this.openSession(id);
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
      // Run status, subtask progress and the Codex thread belong to the original chat.
      runs: undefined, subtasks: undefined, nativeSession: undefined,
    };
    await this.saveNow(copy);
    return copy;
  }
  async clearAll() {
    const ids = new Set([...this.summaries.keys(), ...this.loaded.keys()]);
    for (const id of ids) this.markDeleted(id);
    this.summaries.clear();
    this.loaded.clear();
    this.unwritten.clear();
    this.scrubIds.clear();
    void this.enqueue(async () => {
      for (const id of ids) await this.removeChatFile(id);
      try {
        // Files no index listed go too.
        if (await this.adapter.exists(this.dir)) {
          for (const file of (await this.adapter.list(this.dir)).files ?? []) await this.adapter.remove(file);
        }
        if (await this.adapter.exists(this.backupPath)) await this.adapter.remove(this.backupPath);
      } catch (e: unknown) {
        console.warn('[Glossa] could not remove every chat file', e);
      }
      this.backupAt = null;
    });
    await this.persist();
  }

  private cloneMessages(messages: ChatSession['messages']): ChatSession['messages'] {
    try {
      return JSON.parse(JSON.stringify(chatMessagesForStorage(messages))) as ChatSession['messages'];
    } catch {
      return chatMessagesForStorage(messages);
    }
  }
}
