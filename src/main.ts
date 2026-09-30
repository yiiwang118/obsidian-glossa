import { Plugin, WorkspaceLeaf, Notice, addIcon } from 'obsidian';
import { GlossaView, VIEW_TYPE_GLOSSA } from './ui/view';
import { GlossaSettingTab } from './settings';
import {
  DEFAULT_SETTINGS,
  type GlossaSettings,
  type Endpoint,
  type SelectionTranslateMode,
} from './types';
import { BUILTIN_SLASH_COMMANDS, applySlashTemplate } from './commands/slash';
import { getCurrentSelection } from './context/sources';
import { askPassphrase } from './ui/passphrase_modal';
import { deriveKey, encryptString, decryptString, decryptStringStrict, isEncrypted, makeVerifier, type SubtleKeyHandle } from './utils/crypto';
import { CheckpointManager } from './agent/checkpoint';
import { setLanguage, bi } from './utils/i18n';
import { GLOSSA_RIBBON_SVG } from './ui/icons';
import type { UpdateInfo } from './features/update_check';
import { OBSIDIAN_PLUGIN_URI, UPDATE_CHECK_INTERVAL_MS, fetchLatestUpdate } from './features/update_check';
import { compareSemver, normalizeVersion } from './utils/version';
import { clearMediaCaches } from './utils/media_cache';
import { clearRenderedPdfPageCache } from './utils/pdf_render';
import { SelectionTranslationController } from './features/selection_translation';
import { createInlineCompletionExtension } from './features/inline_completion';
import { openLearningModal } from './ui/learning_modal';
import { ChatStore } from './chat_store';
import { DeferredTasks } from './utils/deferred_tasks';

export default class GlossaPlugin extends Plugin {
  settings: GlossaSettings;
  store: ChatStore;

  // Encryption — passphrase derived key held in memory only.
  private cryptoHandle: SubtleKeyHandle | null = null;
  private unlocked = true;     // true when keys are readable (encryption disabled or unlocked)

  embeddingIndex: {
    size: () => number;
    modelInfo: () => { model: string; endpointId: string };
    search: (query: string, topK?: number) => Promise<{ path: string; chunk: number; text: string; score: number }[]>;
  };
  checkpoint: CheckpointManager;
  mcp: AnyValue;
  updateInfo: UpdateInfo | null = null;
  private updateCheckInFlight: Promise<UpdateInfo | null> | null = null;
  private selectionTranslation: SelectionTranslationController | null = null;
  private deferredTasks = new DeferredTasks();

  async onload() {
    const raw = (await this.loadData()) ?? {};
    const { __chats: legacy, ...settingsRaw } = raw;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, settingsRaw);
    this.hydrateCachedUpdateInfo();
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
    this.settings.inlineCompletionDelayMs = Math.min(
      2_000,
      Math.max(300, Number(this.settings.inlineCompletionDelayMs) || 650),
    );
    this.settings.inlineCompletionContextBeforeChars = Math.min(
      4_000,
      Math.max(200, Number(this.settings.inlineCompletionContextBeforeChars) || 800),
    );
    const inlineCompletionAfterChars = Number(this.settings.inlineCompletionContextAfterChars);
    this.settings.inlineCompletionContextAfterChars = Number.isFinite(inlineCompletionAfterChars)
      ? Math.min(2_000, Math.max(0, inlineCompletionAfterChars))
      : 200;
    if (typeof this.settings.inlineCompletionMiddleOfLine !== 'boolean') {
      this.settings.inlineCompletionMiddleOfLine = true;
    }
    // Earlier plugin builds seeded the codex-cli "Default model" field with
    // 'gpt-5.4' for every newly-created endpoint. That leaks into `-m gpt-5.4`
    // at runtime and silently hangs when the user's account uses a different
    // model (we saw this firsthand). Clear that stale default so codex falls
    // back to ~/.codex/config.toml — the user can re-enter a model if they
    // truly want to override.
    let codexMigratedCount = 0;
    for (const ep of (this.settings.endpoints ?? [])) {
      // Existing endpoints retain their request body when upgrading to 0.8.
      if (ep.kind === 'custom-api' && ep.extraBody === undefined) ep.extraBody = {};
      if ((ep as AnyValue).kind === 'codex-cli' && (ep as AnyValue).model === 'gpt-5.4') {
        (ep as AnyValue).model = '';
        codexMigratedCount++;
      }
    }
    await this.saveData(this.settings);
    if (codexMigratedCount > 0) {
      // Defer past Obsidian's startup splash so the Notice is actually visible.
      this.deferredTasks.schedule(() => new Notice(
        `Glossa: cleared stale 'gpt-5.4' model from ${codexMigratedCount} codex endpoint(s). ` +
        `They'll now use the model from ~/.codex/config.toml.`,
        10_000,
      ), 1500);
    }

    setLanguage(this.settings.uiLanguage);
    this.store = new ChatStore(this);
    await this.store.load(legacy);

    this.embeddingIndex = {
      size: () => 0,
      modelInfo: () => ({ model: '', endpointId: '' }),
      search: async () => [],
    };
    this.checkpoint = new CheckpointManager(this);
    this.mcp = {
      clients: [],
      start: async () => {},
      stop: async () => {},
      restart: async () => {},
      allTools: () => [],
      asToolSpecs: () => [],
      findClient: () => null,
      onChange: () => () => {},
    };

    if (this.settings.encryptionEnabled) {
      this.unlocked = false;
      // Defer unlock prompt; user can trigger by clicking the ribbon or opening sidebar.
    }

    // Obsidian chrome (ribbon + tab headers) should inherit the host app's
    // monochrome icon color. In-panel brand surfaces use inline gradient SVGs.
    addIcon('glossa', GLOSSA_RIBBON_SVG);
    addIcon('glossa-ribbon', GLOSSA_RIBBON_SVG);

    this.registerView(VIEW_TYPE_GLOSSA, (leaf) => new GlossaView(leaf, this));
    this.registerEditorExtension(createInlineCompletionExtension(this));
    this.selectionTranslation = new SelectionTranslationController(this);
    this.selectionTranslation.start();
    this.register(() => {
      if (!this.selectionTranslation) return;
      this.selectionTranslation.destroy();
      this.selectionTranslation = null;
    });
    const ribbonIconEl = this.addRibbonIcon('glossa-ribbon', 'Open ' + 'Glossa', () => this.activateView());
    ribbonIconEl.addClass('glossa-ribbon-icon');

    this.addCommand({ id: 'open-sidebar', name: 'Open sidebar', callback: () => this.activateView() });
    this.addCommand({ id: 'learned-skills', name: 'Manage learned skills', callback: () => openLearningModal(this) });
    this.addCommand({ id: 'new-chat', name: 'New chat',
      callback: async () => { await this.activateView(); (this.getView() as AnyValue)?.startNewSession?.(); } });
    this.addCommand({ id: 'unlock', name: 'Unlock encrypted keys',
      callback: () => this.tryUnlock() });
    this.addCommand({ id: 'rebuild-index', name: 'Rebuild embedding index',
      callback: () => this.rebuildEmbeddings() });
    this.addCommand({ id: 'check-for-updates', name: 'Check for updates',
      callback: () => this.checkForUpdates({ force: true, notify: true }) });
    this.addCommand({
      id: 'translate-selection-popup',
      name: 'Translate selection in popup',
      callback: () => { void this.selectionTranslation?.translateCurrentSelection(); },
    });

    for (const cmd of BUILTIN_SLASH_COMMANDS) {
      this.addCommand({
        id: cmd.id,
        // The host prefixes command names with the plugin name in Settings.
        name: cmd.title,
        callback: async () => {
          await this.activateView();
          const view = this.getView() as AnyValue;
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
        const view = this.getView() as AnyValue;
        if (view) {
          view.inputEl.value = `Improve / rewrite this selection:\n\n${sel}\n\nKeep markdown intact.`;
          view.inputEl.dispatchEvent(new Event('input'));
          view.inputEl.focus();
        }
      },
    });

    this.addSettingTab(new GlossaSettingTab(this.app, this));

    // Initialize bundled skills (one-time, idempotent across reloads thanks to
    // clearBundledSkills() at module init). Also load the persisted nested
    // skill dir index so cross-session discovery is preserved. And probe the
    // plugin-bridge upstream availability so the model only sees bridges
    // whose target plugins are actually installed.
    this.app.workspace.onLayoutReady(() => {
      if (!this.deferredTasks.active) return;
      import('./agent/bundled_skills').then(m => { if (this.deferredTasks.active) m.initBundledSkills(); }).catch(e => console.warn('[bundled-skills] failed', e));
      import('./agent/skills').then(m => { if (this.deferredTasks.active) return m.loadPersistedNestedSkillDirs(this.app); }).catch(e => console.warn('[nested-dirs] load failed', e));
      import('./agent/plugin_bridges').then(m => { if (this.deferredTasks.active) this.register(m.watchPluginBridges(this.app)); }).catch(e => console.warn('[plugin-bridges] failed', e));
    });

    this.app.workspace.onLayoutReady(() => {
      this.deferredTasks.schedule(() => {
        this.checkForUpdates({ force: false, notify: false }).catch(e => console.warn('[Glossa] update check failed', e));
      }, 8000);
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
    this.register(() => pendingTimers.clear());
    const scheduleActivate = (path: string) => {
      if (!this.deferredTasks.active) return;
      if (!path) return;
      if (path === lastActivatedPath) return;            // already processed this exact path
      // Coalesce duplicate timers for the same path.
      const existing = pendingTimers.get(path);
      this.deferredTasks.cancel(existing);
      const handle = this.deferredTasks.schedule(() => {
        pendingTimers.delete(path);
        lastActivatedPath = path;
        import('./agent/skill_activation').then(m => { if (this.deferredTasks.active) return m.activateForPath(this.app, path); }).catch(() => {});
      }, SKILL_ACTIVATE_DEBOUNCE_MS);
      if (handle !== undefined) pendingTimers.set(path, handle);
    };
    const invalidateSkillCacheForPath = (path: string) => {
      if (!path.endsWith('/SKILL.md') && path !== 'SKILL.md') return;
      void import('./agent/skills').then(m => m.invalidateDiscoverCache()).catch(() => {});
    };

    this.registerEvent(
      this.app.workspace.on('file-open', (file) => { if (file?.path) scheduleActivate(file.path); }),
    );
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        const p: string = (file as AnyValue)?.path ?? '';
        if (p) scheduleActivate(p);
        // Editing a SKILL.md invalidates the discoverSkills TTL cache so
        // the next disc walk picks up the new frontmatter / body.
        invalidateSkillCacheForPath(p);
      }),
    );
    this.registerEvent(
      this.app.vault.on('create', (file) => {
        const p: string = (file as AnyValue)?.path ?? '';
        if (p) scheduleActivate(p);
        invalidateSkillCacheForPath(p);
      }),
    );
    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        const p: string = (file as AnyValue)?.path ?? '';
        invalidateSkillCacheForPath(p);
      }),
    );
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        const p: string = (file as AnyValue)?.path ?? '';
        if (p) scheduleActivate(p);
        invalidateSkillCacheForPath(oldPath);
        invalidateSkillCacheForPath(p);
      }),
    );

    // (Plaintext key warning removed — user opted out of mandatory encryption flow.
    //  The Security tab still shows status; user can enable encryption manually.)
  }

  async setSelectionTranslateMode(mode: SelectionTranslateMode): Promise<void> {
    this.settings.selectionTranslateMode = mode;
    await this.saveSettings();
    this.selectionTranslation?.syncMode();
  }

  onunload() {
    this.deferredTasks.dispose();
    // Flush pending settings/chat changes once instead of leaving a delayed
    // write alive after unloading. A final view-close save may also persist.
    if (this._saveTimer !== null) {
      this._saveTimer = null;
      void this.persistAll().catch(e => console.error('[Glossa] final save failed', e));
    }
    void this.mcp?.stop();
    clearMediaCaches();
    clearRenderedPdfPageCache();
    // Flush any debounced persist timers so the last 750ms of changes
    // (nested skill dirs discovered, etc.) don't get lost when the user
    // disables / reloads the plugin. Fire-and-forget — onunload is
    // synchronous from Obsidian's perspective but we can still kick the
    // async flush; in practice the adapter.write completes synchronously
    // on the same tick for small files.
    void import('./agent/skills').then(m => m.flushPersistedNestedSkillDirs(this.app)).catch(() => {});
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_GLOSSA)[0];
    if (!leaf) { leaf = workspace.getRightLeaf(false); await leaf?.setViewState({ type: VIEW_TYPE_GLOSSA, active: true }); }
    if (leaf) await workspace.revealLeaf(leaf);
  }

  getView(): GlossaView | null {
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_GLOSSA)[0];
    return (leaf?.view as GlossaView) ?? null;
  }

  async checkForUpdates(opts: { force?: boolean; notify?: boolean } = {}): Promise<UpdateInfo | null> {
    if (!this.deferredTasks.active) return null;
    if (!this.settings.updateCheckEnabled && !opts.force) return null;
    const now = Date.now();
    if (!opts.force && this.settings.updateLastCheckedAt && now - this.settings.updateLastCheckedAt < UPDATE_CHECK_INTERVAL_MS) {
      this.hydrateCachedUpdateInfo();
      return this.updateInfo;
    }
    if (this.updateCheckInFlight !== null) return this.updateCheckInFlight;
    this.updateCheckInFlight = (async () => {
      try {
        const info = await fetchLatestUpdate(this.manifest.version);
        if (!this.deferredTasks.active) return null;
        this.settings.updateLastCheckedAt = Date.now();
        this.settings.updateLatestVersion = info?.latestVersion ?? '';
        this.settings.updateLatestReleaseUrl = info?.releaseUrl ?? '';
        this.updateInfo = info && this.settings.updateDismissedVersion !== info.latestVersion ? info : null;
        await this.saveSettings();
        if (!this.deferredTasks.active) return null;
        this.getView()?.refreshFromSettings?.();
        if (opts.notify) {
          new Notice(this.updateInfo
            ? bi(`Glossa ${this.updateInfo.latestVersion} is available.`, `Glossa ${this.updateInfo.latestVersion} 有新版本。`)
            : bi('Glossa is up to date.', 'Glossa 已是最新版本。'));
        } else if (this.updateInfo) {
          new Notice(bi(`Glossa ${this.updateInfo.latestVersion} is available.`, `Glossa ${this.updateInfo.latestVersion} 有新版本。`), 7000);
        }
        return this.updateInfo;
      } finally {
        this.updateCheckInFlight = null;
      }
    })();
    return this.updateCheckInFlight;
  }

  async dismissUpdate(version: string) {
    this.settings.updateDismissedVersion = version;
    if (this.updateInfo?.latestVersion === version) this.updateInfo = null;
    await this.saveSettings();
    this.getView()?.refreshFromSettings?.();
  }

  private hydrateCachedUpdateInfo() {
    const latest = normalizeVersion(this.settings.updateLatestVersion || '');
    if (!latest || this.settings.updateDismissedVersion === latest || compareSemver(latest, this.manifest.version) <= 0) {
      this.updateInfo = null;
      return;
    }
    this.updateInfo = {
      currentVersion: normalizeVersion(this.manifest.version),
      latestVersion: latest,
      releaseUrl: this.settings.updateLatestReleaseUrl || `https://github.com/yiiwang118/obsidian-glossa/releases/tag/${latest}`,
      obsidianUrl: OBSIDIAN_PLUGIN_URI,
      releaseName: latest,
      body: '',
      notes: [],
      checkedAt: this.settings.updateLastCheckedAt || Date.now(),
    };
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
      if (ep.apiKey && isEncrypted(ep.apiKey)) ep.apiKey = await decryptString(ep.apiKey, this.cryptoHandle);
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
      const plain = await decryptString(ep.apiKey, this.cryptoHandle);
      return { ...ep, apiKey: plain };
    } catch {
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
    new Notice(bi(
      'Semantic indexing is disabled in the community review build.',
      '社区审核版本已关闭语义索引。',
    ));
  }

  /* ============================================================
     Persistence
     ============================================================ */
  private _saveTimer: number | null = null;
  async saveSettings() {
    this.settings.citationHoverEnabled = false;
    if (!this.deferredTasks.active) {
      await this.persistAll();
      return;
    }
    setLanguage(this.settings.uiLanguage);
    this.getView()?.refreshFromSettings?.();
    this.deferredTasks.cancel(this._saveTimer);
    this._saveTimer = this.deferredTasks.schedule(() => {
      this._saveTimer = null;
      void this.persistAll().catch(e => console.error('[Glossa] save failed', e));
    }, 300) ?? null;
  }
  async persistAll() {
    await this.saveData({ ...this.settings });
    await this.store.persist();
  }
}
