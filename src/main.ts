import { Plugin, WorkspaceLeaf, Notice, addIcon } from 'obsidian';
import { GlossaView, VIEW_TYPE_GLOSSA } from './ui/view';
import { GlossaSettingTab } from './settings';
import { DEFAULT_SETTINGS, type GlossaSettings, type ChatSession, type Endpoint } from './types';
import { BUILTIN_SLASH_COMMANDS, applySlashTemplate } from './commands/slash';
import { getCurrentSelection } from './context/sources';
import { askPassphrase } from './ui/passphrase_modal';
import { deriveKey, encryptString, decryptString, decryptStringStrict, isEncrypted, makeVerifier, type SubtleKeyHandle } from './utils/crypto';
import { EmbeddingIndex } from './agent/embeddings';
import { CheckpointManager } from './agent/checkpoint';
import { McpHub } from './agent/mcp';
import { setLanguage, bi } from './utils/i18n';
import { loadShellEnv } from './utils/env';
import { GLOSSA_MARK_SVG, GLOSSA_RIBBON_SVG } from './ui/icons';

export default class GlossaPlugin extends Plugin {
  settings: GlossaSettings;
  store: ChatStore;

  // Encryption — passphrase derived key held in memory only.
  private cryptoHandle: SubtleKeyHandle | null = null;
  private unlocked = true;     // true when keys are readable (encryption disabled or unlocked)

  embeddingIndex: EmbeddingIndex;
  checkpoint: CheckpointManager;
  mcp: McpHub;
  fileIndex: import('./agent/file_index').FileIndex;

  async onload() {
    // Snapshot the user's login-shell env asynchronously at startup so spawned
    // CLIs (codex, claude) inherit HTTPS_PROXY / OPENAI_API_KEY / etc that live
    // in ~/.zshrc. macOS GUI apps don't load shell rc files, so without this
    // every subprocess we spawn would attempt direct internet egress and hang
    // behind the user's proxy. Fire-and-forget: makeChildEnv() reads from the
    // sync `shellEnvSnapshot()` cache populated by this Promise.
    loadShellEnv().catch(() => {});

    const raw = (await this.loadData()) ?? {};
    const { __chats: legacy, ...settingsRaw } = raw as any;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, settingsRaw);
    // Experimental PDF citation hover is currently hidden and hard-disabled.
    // Keep the implementation files in-tree for later work, but never register
    // its DOM listeners from the plugin lifecycle.
    this.settings.citationHoverEnabled = false;

    // ---- Settings migrations ----
    // Tool name renames (old → new) that may be lingering in user's auto-approve list.
    const renames: Record<string, string> = { 'get_active': 'get_active_file' };
    this.settings.agentAlwaysApproveTools = (this.settings.agentAlwaysApproveTools ?? [])
      .map(n => renames[n] ?? n);
    this.settings.agentNeverApproveTools = (this.settings.agentNeverApproveTools ?? [])
      .map(n => renames[n] ?? n);
    // De-dup
    this.settings.agentAlwaysApproveTools = [...new Set(this.settings.agentAlwaysApproveTools)];
    this.settings.agentNeverApproveTools = [...new Set(this.settings.agentNeverApproveTools)];
    // Bump stale context budget for users created before 1M default. Use
    // `<` against the new default so any leftover value in the 100k..1M range
    // also gets corrected (the old `<= 100_000` missed the 100_001..999_999 band).
    if (this.settings.maxContextTokens < 1_000_000) this.settings.maxContextTokens = 1_000_000;
    if (this.settings.warnTokenThreshold < 500_000) this.settings.warnTokenThreshold = 500_000;
    // 0.3 default is 13. Bump anyone still on the legacy 12 (or unset) to 13.
    if (!this.settings.reasoningFontSize || this.settings.reasoningFontSize < 12) {
      this.settings.reasoningFontSize = 13;
    }
    // Earlier plugin builds seeded the codex-cli "Default model" field with
    // 'gpt-5.4' for every newly-created endpoint. That leaks into `-m gpt-5.4`
    // at runtime and silently hangs when the user's account uses a different
    // model (we saw this firsthand). Clear that stale default so codex falls
    // back to ~/.codex/config.toml — the user can re-enter a model if they
    // truly want to override.
    let codexMigratedCount = 0;
    for (const ep of (this.settings.endpoints ?? [])) {
      if ((ep as any).kind === 'codex-cli' && (ep as any).model === 'gpt-5.4') {
        (ep as any).model = '';
        codexMigratedCount++;
      }
    }
    await this.saveData(this.settings);
    if (codexMigratedCount > 0) {
      // Defer past Obsidian's startup splash so the Notice is actually visible.
      window.setTimeout(() => new Notice(
        `Glossa: cleared stale 'gpt-5.4' model from ${codexMigratedCount} codex endpoint(s). ` +
        `They'll now use the model from ~/.codex/config.toml.`,
        10_000,
      ), 1500);
    }

    setLanguage(this.settings.uiLanguage);
    this.store = new ChatStore(this);
    await this.store.load(legacy);

    this.embeddingIndex = new EmbeddingIndex(this);
    await this.embeddingIndex.load();
    this.checkpoint = new CheckpointManager(this);
    this.mcp = new McpHub();
    const { FileIndex } = await import('./agent/file_index');
    this.fileIndex = new FileIndex(this.app);
    // Pass `this` so vault listeners go through plugin.registerEvent and
    // get auto-cleaned on hot reload — otherwise a reload would leave the
    // old listener set bound to a dead FileIndex, double-firing upserts.
    this.fileIndex.startListening(this);

    if (this.settings.encryptionEnabled) {
      this.unlocked = false;
      // Defer unlock prompt; user can trigger by clicking the ribbon or opening sidebar.
    }

    // Glossa mark — keep the brand gradient for in-panel surfaces, but use a
    // currentColor variant in Obsidian's ribbon so it matches host app icons.
    addIcon('glossa', GLOSSA_MARK_SVG);
    addIcon('glossa-ribbon', GLOSSA_RIBBON_SVG);

    this.registerView(VIEW_TYPE_GLOSSA, (leaf) => new GlossaView(leaf, this));
    this.addRibbonIcon('glossa-ribbon', 'Open ' + 'Glossa', () => this.activateView());

    this.addCommand({ id: 'open-sidebar', name: 'Open sidebar', callback: () => this.activateView() });
    this.addCommand({ id: 'new-chat', name: 'New chat',
      callback: async () => { await this.activateView(); (this.getView() as any)?.startNewSession?.(); } });
    this.addCommand({ id: 'unlock', name: 'Unlock encrypted keys',
      callback: () => this.tryUnlock() });
    this.addCommand({ id: 'rebuild-index', name: 'Rebuild embedding index',
      callback: () => this.rebuildEmbeddings() });

    for (const cmd of BUILTIN_SLASH_COMMANDS) {
      this.addCommand({
        id: cmd.id,
        name: `Glossa: ${cmd.title}`,
        callback: async () => {
          await this.activateView();
          const view = this.getView() as any;
          if (!view) return;
          const sel = getCurrentSelection(this.app);
          const af = this.app.workspace.getActiveFile();
          const fileContent = af ? await this.app.vault.cachedRead(af) : '';
          const expanded = applySlashTemplate({
            template: cmd.template, selection: sel?.text ?? '', fileContent,
            fileName: af?.basename ?? '', vaultName: this.app.vault.getName(),
          });
          view.inputEl.value = expanded;
          view.inputEl.dispatchEvent(new Event('input'));
          view.inputEl.focus();
        },
      });
    }

    this.addCommand({
      id: 'inline-edit',
      name: 'Inline edit selection',
      editorCallback: async () => {
        const { runInlineEdit } = await import('./commands/inline_edit');
        await runInlineEdit(this);
      },
    });

    this.addCommand({
      id: 'edit-selection',
      name: 'Edit selection with AI…',
      editorCallback: async (editor) => {
        const sel = editor.getSelection();
        if (!sel) { new Notice(bi('Select some text first.', '请先选中文本。')); return; }
        await this.activateView();
        const view = this.getView() as any;
        if (view) {
          view.inputEl.value = `Improve / rewrite this selection:\n\n${sel}\n\nKeep markdown intact.`;
          view.inputEl.dispatchEvent(new Event('input'));
          view.inputEl.focus();
        }
      },
    });

    this.addSettingTab(new GlossaSettingTab(this.app, this));

    // Start MCP servers in background
    this.app.workspace.onLayoutReady(() => {
      if (this.settings.mcpServers.some(s => s.enabled)) {
        this.mcp.start(this.settings.mcpServers).catch(e => console.warn('[mcp] start failed', e));
      }
    });

    // Initialize bundled skills (one-time, idempotent across reloads thanks to
    // clearBundledSkills() at module init). Also load the persisted nested
    // skill dir index so cross-session discovery is preserved. And probe the
    // plugin-bridge upstream availability so the model only sees bridges
    // whose target plugins are actually installed.
    this.app.workspace.onLayoutReady(() => {
      import('./agent/bundled_skills').then(m => m.initBundledSkills()).catch(e => console.warn('[bundled-skills] failed', e));
      import('./agent/skills').then(m => m.loadPersistedNestedSkillDirs(this.app)).catch(e => console.warn('[nested-dirs] load failed', e));
      import('./agent/plugin_bridges').then(m => m.watchPluginBridges(this.app)).catch(e => console.warn('[plugin-bridges] failed', e));
    });

    // Skill conditional activation: every time a file is opened or modified,
    // check if any conditional skill's `paths` matches and activate it.
    //
    // Debounce strategy: autosave fires `vault.on('modify')` on every
    // keystroke for the active file. Without debouncing, a 50-skill vault
    // would do 50 metadata lookups per keystroke. We coalesce to one check
    // per file-path every 300 ms; we also short-circuit when the same path
    // was just checked (most common case).
    const SKILL_ACTIVATE_DEBOUNCE_MS = 300;
    let lastActivatedPath: string | null = null;
    const pendingTimers = new Map<string, number>();
    const scheduleActivate = (path: string) => {
      if (!path) return;
      if (path === lastActivatedPath) return;            // already processed this exact path
      // Coalesce duplicate timers for the same path.
      const existing = pendingTimers.get(path);
      if (existing) window.clearTimeout(existing);
      const handle = window.setTimeout(() => {
        pendingTimers.delete(path);
        lastActivatedPath = path;
        import('./agent/skill_activation').then(m => m.activateForPath(this.app, path)).catch(() => {});
      }, SKILL_ACTIVATE_DEBOUNCE_MS);
      pendingTimers.set(path, handle);
    };

    this.registerEvent(
      this.app.workspace.on('file-open', (file) => { if (file?.path) scheduleActivate(file.path); }),
    );
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        const p: string = (file as any)?.path ?? '';
        if (p) scheduleActivate(p);
        // Editing a SKILL.md invalidates the discoverSkills TTL cache so
        // the next disc walk picks up the new frontmatter / body.
        if (p.endsWith('/SKILL.md') || p === 'SKILL.md') {
          import('./agent/skills').then(m => m.invalidateDiscoverCache()).catch(() => {});
        }
      }),
    );

    // (Plaintext key warning removed — user opted out of mandatory encryption flow.
    //  The Security tab still shows status; user can enable encryption manually.)
  }

  onunload() {
    this.mcp?.stop();
    // Flush any debounced persist timers so the last 750ms of changes
    // (nested skill dirs discovered, etc.) don't get lost when the user
    // disables / reloads the plugin. Fire-and-forget — onunload is
    // synchronous from Obsidian's perspective but we can still kick the
    // async flush; in practice the adapter.write completes synchronously
    // on the same tick for small files.
    import('./agent/skills').then(m => m.flushPersistedNestedSkillDirs(this.app)).catch(() => {});
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_GLOSSA)[0];
    if (!leaf) { leaf = workspace.getRightLeaf(false); await leaf?.setViewState({ type: VIEW_TYPE_GLOSSA, active: true }); }
    if (leaf) workspace.revealLeaf(leaf);
  }

  getView(): GlossaView | null {
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_GLOSSA)[0];
    return (leaf?.view as GlossaView) ?? null;
  }

  /* ============================================================
     Encryption / key vault
     ============================================================ */

  isUnlocked() { return this.unlocked; }

  /** Prompt for passphrase + verify. Returns true on success.
   *
   *  Auto-upgrades PBKDF2 200k → 600k iterations on first successful unlock
   *  after upgrading the plugin (OWASP 2023 recommendation). The handle is
   *  re-derived at 600k and a fresh verifier persists to settings. */
  async tryUnlock(): Promise<boolean> {
    if (!this.settings.encryptionEnabled) { this.unlocked = true; return true; }
    if (this.unlocked) return true;
    const pass = await askPassphrase(this.app, 'unlock');
    if (!pass) return false;
    const { unlockWithUpgrade } = await import('./utils/crypto');
    const result = await unlockWithUpgrade(pass, this.settings.encryptionSaltBase64, this.settings.encryptionVerifier);
    if (!result.ok || !result.handle) {
      new Notice(bi('Passphrase incorrect.', '密码错误。')); return false;
    }
    const handle = result.handle;
    if (result.upgradedVerifier) {
      // Migrated from 200k → 600k; persist the new verifier so the next
      // unlock uses the upgraded handle directly without the legacy probe.
      this.settings.encryptionVerifier = result.upgradedVerifier;
      try { await this.saveData(this.settings); } catch (e) { console.warn('[Glossa] upgraded verifier save failed', e); }
      new Notice(bi('Encryption upgraded to 600k PBKDF2 iterations.', '加密已升级到 600k PBKDF2 迭代。'), 4000);
    }
    this.cryptoHandle = handle;
    this.unlocked = true;
    new Notice(bi('Unlocked.', '已解锁。'));
    this.getView()?.refreshFromSettings?.();
    return true;
  }

  /** First-time encryption setup: ask passphrase, derive key, encrypt all current API keys. */
  async enableEncryption(): Promise<boolean> {
    if (this.settings.encryptionEnabled) { new Notice(bi('Encryption already on. Use "lock" to clear in-memory key.', '加密已开启。使用"锁定"清除内存中的密钥。')); return false; }
    const pass = await askPassphrase(this.app, 'set');
    if (!pass) return false;
    const handle = await deriveKey(pass);
    this.cryptoHandle = handle;
    this.settings.encryptionEnabled = true;
    this.settings.encryptionSaltBase64 = handle.saltBase64;
    this.settings.encryptionVerifier = await makeVerifier(handle);
    // Encrypt all current API keys
    for (const ep of this.settings.endpoints) {
      if (ep.apiKey && !isEncrypted(ep.apiKey)) ep.apiKey = await encryptString(ep.apiKey, handle);
    }
    this.unlocked = true;
    await this.persistAll();
    new Notice(bi('API keys encrypted.', 'API 密钥已加密。'));
    return true;
  }

  /** Decrypt back and disable. Requires unlocked state. */
  async disableEncryption(): Promise<boolean> {
    if (!this.settings.encryptionEnabled) return true;
    if (!await this.requireUnlock()) return false;
    for (const ep of this.settings.endpoints) {
      if (ep.apiKey && isEncrypted(ep.apiKey)) ep.apiKey = await decryptString(ep.apiKey, this.cryptoHandle!);
    }
    this.settings.encryptionEnabled = false;
    this.settings.encryptionSaltBase64 = '';
    this.settings.encryptionVerifier = '';
    this.cryptoHandle = null;
    await this.persistAll();
    new Notice(bi('Encryption disabled — keys now plaintext in data.json.', '加密已关闭 — data.json 中的密钥现在是明文。'));
    return true;
  }

  /** Forget the in-memory key. User will be re-prompted on next use. */
  async lock() {
    this.cryptoHandle = null;
    this.unlocked = !this.settings.encryptionEnabled;
    new Notice(bi('Locked.', '已锁定。'));
    this.getView()?.refreshFromSettings?.();
  }

  async requireUnlock(): Promise<boolean> {
    if (!this.settings.encryptionEnabled) { this.unlocked = true; return true; }
    if (this.unlocked && this.cryptoHandle) return true;
    return this.tryUnlock();
  }

  /** Encrypt a JSON blob.
   *  - Encryption off → plaintext (intended).
   *  - Encryption on + unlocked → encrypted.
   *  - Encryption on + LOCKED → throws (caller must surface to user; we no longer fall back
   *    to plaintext, which would leak embeddings/checkpoints contents). */
  async encryptBlob(plain: string): Promise<string> {
    if (!this.settings.encryptionEnabled) return plain;
    if (!this.cryptoHandle) throw new Error('Encryption is locked — unlock or disable.');
    return encryptString(plain, this.cryptoHandle);
  }
  /** Returns null without prompting if locked — for lazy/optional loads. */
  async decryptBlobOptional(stored: string): Promise<string | null> {
    if (!stored || !isEncrypted(stored)) return stored;
    if (!this.cryptoHandle) return null;     // don't pop unlock modal during silent load
    try { return await decryptString(stored, this.cryptoHandle); } catch { return null; }
  }
  /** Active path — will prompt for unlock.
   *
   *  When encryption is enabled, this uses the STRICT decrypt: a value
   *  lacking the encryption prefix throws rather than returning the raw
   *  string. Rationale: opaque blobs (checkpoint, embeddings) are always
   *  encrypted by `encryptBlob` when encryption is on, so if we see one
   *  without the prefix it's either pre-encryption legacy data OR file-level
   *  tampering. We surface it as an error so the user notices. The lenient
   *  decryptBlobOptional path is used elsewhere for migration-friendly
   *  silent loads. */
  async decryptBlob(stored: string): Promise<string> {
    if (!stored) return stored;
    if (!isEncrypted(stored)) {
      // Strict-when-enabled: don't silently pass through unencrypted blobs.
      if (this.settings.encryptionEnabled) {
        throw new Error('decryptBlob: encryption is enabled but stored blob is not encrypted — refusing (possible tampering or stale pre-encryption data).');
      }
      return stored;
    }
    if (!this.cryptoHandle) await this.requireUnlock();
    if (!this.cryptoHandle) throw new Error('Locked');
    return decryptStringStrict(stored, this.cryptoHandle);
  }

  /** Return endpoint with decrypted apiKey, or null if locked / decrypt fails. */
  async getDecryptedEndpoint(ep: Endpoint): Promise<Endpoint | null> {
    if (!ep.apiKey || !isEncrypted(ep.apiKey)) return ep;
    if (!await this.requireUnlock()) return null;
    try {
      const plain = await decryptString(ep.apiKey, this.cryptoHandle!);
      return { ...ep, apiKey: plain };
    } catch (e) {
      new Notice(bi('Failed to decrypt API key — passphrase may be wrong.', 'API 密钥解密失败 — 密码可能错误。')); return null;
    }
  }

  /** When user types/edits an API key in settings, encrypt it on save (if encryption on).
   *  Returns true if stored successfully, false if encryption is on but couldn't unlock
   *  (caller should reject the change to avoid silent plaintext fallback). */
  async storeApiKey(ep: Endpoint, plainKey: string): Promise<boolean> {
    if (!plainKey) { ep.apiKey = ''; return true; }
    if (this.settings.encryptionEnabled) {
      if (!this.cryptoHandle) await this.requireUnlock();
      if (!this.cryptoHandle) {
        new Notice(bi('Cannot store API key: encryption is locked. Unlock first.', '无法存储 API 密钥：加密已锁定。请先解锁。'));
        return false;     // refuse plaintext fallback
      }
      ep.apiKey = await encryptString(plainKey, this.cryptoHandle);
      return true;
    }
    ep.apiKey = plainKey;
    return true;
  }

  /* ============================================================
     Embedding index
     ============================================================ */
  async rebuildEmbeddings() {
    if (!this.settings.embeddingEndpointId) { new Notice(bi('Pick an embedding endpoint in settings first.', '请先在设置中选择嵌入端点。')); return; }
    // First-build consent gate: building an embedding index uploads every
    // markdown file's content to the configured endpoint. We show a one-time
    // modal that names the endpoint + counts files + estimates payload size
    // so the user can decide. Once granted, never asked again unless
    // settings flag is manually reset.
    if (!this.settings.embeddingConsentGranted) {
      const ep = this.settings.endpoints.find(e => e.id === this.settings.embeddingEndpointId);
      const epLabel = ep?.label ?? '(unknown)';
      const epUrl = ep?.baseUrl ?? '(unknown URL)';
      const files = this.app.vault.getMarkdownFiles();
      const totalBytes = files.reduce((s, f) => s + (f.stat.size ?? 0), 0);
      const sizeMb = (totalBytes / 1024 / 1024).toFixed(1);
      const { confirmModal } = await import('./ui/confirm_modal');
      const ok = await confirmModal(this.app, {
        title: 'Build embedding index?',
        body:
          `This will UPLOAD the content of every markdown file in your vault to:\n\n` +
          `  endpoint: ${epLabel}\n` +
          `  URL:      ${epUrl}\n\n` +
          `Scope: ${files.length} files, ~${sizeMb} MB total. The upload happens in batches of 32 chunks; ` +
          `only the embedded vectors are stored on disk, but the raw text leaves your machine.`,
        confirmText: 'Upload & build',
        danger: false,
      });
      if (!ok) return;
      this.settings.embeddingConsentGranted = true;
      try { await this.saveData(this.settings); } catch (e) { console.warn('[Glossa] consent persist failed', e); }
    }
    new Notice(bi('Building embedding index…', '正在构建嵌入索引…'));
    try {
      // EmbeddingIndex.build internally calls getDecryptedEndpoint — no mutation of
      // the persisted endpoint object happens. Safe.
      const { added, removed } = await this.embeddingIndex.build({
        onProgress: (done, total) => { if (done % 20 === 0) new Notice(`Embedding: ${done}/${total}`); },
      });
      new Notice(`Index ready: +${added} chunks · -${removed} stale.`);
    } catch (e: any) { new Notice(`Index build failed: ${e.message}`); }
  }

  /* ============================================================
     Persistence
     ============================================================ */
  private _saveTimer: any;
  async saveSettings() {
    setLanguage(this.settings.uiLanguage);
    this.getView()?.refreshFromSettings?.();
    this.settings.citationHoverEnabled = false;
    if (this._saveTimer) window.clearTimeout(this._saveTimer);
    this._saveTimer = window.setTimeout(() => { this.persistAll(); this._saveTimer = null; }, 300);
  }
  async persistAll() {
    await this.saveData({ ...this.settings });
    await this.store.persist();
  }
}

class ChatStore {
  private sessions: ChatSession[] = [];
  private path: string;
  constructor(private plugin: GlossaPlugin) { this.path = `${plugin.manifest.dir}/chats.json`; }

  async load(legacy?: ChatSession[]) {
    try {
      if (await this.plugin.app.vault.adapter.exists(this.path)) {
        const raw = await this.plugin.app.vault.adapter.read(this.path);
        const parsed = JSON.parse(raw);
        this.sessions = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
      } else if (legacy?.length) {
        this.sessions = legacy;
      }
    } catch (e) { console.warn('[Glossa] chat load failed', e); }
    // One-time migration: strip any `content` from contextSnapshot[] entries (older
    // chats stored full file content there; new schema keeps metadata only).
    let migrated = false;
    const beforeFilter = this.sessions.length;
    this.sessions = this.sessions.filter(s => this.isMeaningfulSession(s));
    if (this.sessions.length !== beforeFilter) migrated = true;
    for (const s of this.sessions) {
      for (const m of s.messages ?? []) {
        if (Array.isArray(m.contextSnapshot)) {
          for (const it of m.contextSnapshot) {
            if (it && typeof (it as any).content === 'string') {
              delete (it as any).content; migrated = true;
            }
          }
        }
      }
    }
    if (migrated) {
      await this.persist();
    }
  }

  /** Force re-strip all contextSnapshot.content even if previously missed. */
  async purgeLegacyContext() {
    let count = 0;
    for (const s of this.sessions) for (const m of s.messages ?? []) {
      if (Array.isArray(m.contextSnapshot)) {
        for (const it of m.contextSnapshot) {
          if (it && typeof (it as any).content === 'string') { delete (it as any).content; count++; }
        }
      }
    }
    await this.persist();
    return count;
  }

  all(): ChatSession[] { return this.sessions; }
  private isMeaningfulSession(s: ChatSession): boolean {
    return (s.messages ?? []).some(m =>
      (m.content ?? '').trim().length > 0 ||
      (m.displayContent ?? '').trim().length > 0 ||
      (m.reasoningContent ?? '').trim().length > 0 ||
      ((m.toolEvents ?? []).length > 0));
  }
  async saveSession(s: ChatSession) {
    const idx = this.sessions.findIndex(x => x.id === s.id);
    if (!this.isMeaningfulSession(s)) {
      if (idx >= 0) {
        this.sessions.splice(idx, 1);
        await this.persist();
      }
      return;
    }
    if (idx >= 0) this.sessions[idx] = s; else this.sessions.push(s);
    this.sessions = this.sessions.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 100);
    await this.persist();
  }
  async persist() {
    try {
      // Atomic write via tmp+rename so a crash mid-write doesn't truncate
      // the file to zero and silently wipe every saved conversation.
      const { safeWriteJson } = await import('./utils/safe_write');
      await safeWriteJson(this.plugin.app.vault.adapter, this.path, { sessions: this.sessions }, { pretty: true });
    } catch (e) { console.warn('[Glossa] chat save failed', e); }
  }
  getSession(id: string): ChatSession | undefined { return this.sessions.find(x => x.id === id); }
  listSessions(): ChatSession[] { return [...this.sessions].sort((a, b) => b.updatedAt - a.updatedAt); }
  async deleteSession(id: string) {
    this.sessions = this.sessions.filter(s => s.id !== id);
    await this.persist();
  }
  async renameSession(id: string, title: string) {
    const s = this.sessions.find(x => x.id === id);
    if (!s) return;
    s.title = title.slice(0, 100);
    s.updatedAt = Date.now();
    await this.persist();
  }
  async duplicateSession(id: string): Promise<ChatSession | null> {
    const src = this.sessions.find(x => x.id === id);
    if (!src) return null;
    const newId = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
    const copy: ChatSession = {
      ...src,
      id: newId,
      title: `${src.title} (copy)`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: src.messages.map(m => ({ ...m })),
    };
    this.sessions.push(copy);
    await this.persist();
    return copy;
  }
  async clearAll() {
    this.sessions = [];
    await this.persist();
  }
}
