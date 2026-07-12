/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return -- Dynamic plugin and host-app boundaries validate these values at runtime. */
import {
  ItemView, WorkspaceLeaf, MarkdownView, TFile, Notice, Menu,
} from 'obsidian';
import type GlossaPlugin from '../main';
import { ContextManager } from '../context/manager';
import {
  getCurrentSelection, resolveFile, resolveWebUrl,
  resolveDroppedFile,
  makeCurrentFileItem,
  listFilesForPicker,
} from '../context/sources';
import { BUILTIN_SLASH_COMMANDS, applySlashTemplate } from '../commands/slash';
import { Popup, type PopupItem } from './popup';
import { ICON, AURORA_ORB_SVG } from './icons';
import { el, clear, uid, debounce, setStyle, setVars, setTrustedSvg } from '../utils/dom';
import { formatTokenCount } from '../utils/tokens';
import { buildProvider } from '../providers/registry';
import type { ChatMessage, ContextItem, ContextItemRef, ChatSession, Endpoint, ToolEvent, PlanItem } from '../types';
import { modelContextWindow, reasoningOptionsForEndpoint } from '../types';
import { CustomApiProvider } from '../providers/custom_api';
import type { MessageInput } from '../providers/types';
import { runAgentLoop } from '../agent/loop';
import { compactSession, applyCompact, estimateSessionTokens, undoCompact as undoCompactInSession } from '../agent/compact';
import {
  metaFor,
  activityDescriptionFor,
  renderToolUseMessage as toolUseMessage,
  renderToolResultMessage as toolResultMessage,
  renderToolUseRejectedMessage as toolRejectedMessage,
  renderToolUseErrorMessage as toolErrorMessage,
} from '../agent/tool_meta';
import { quickNotice } from '../utils/notice';
import type { ToolImpl } from '../agent/tools';
import type { ApprovalResult } from '../agent/approval';
import { renderDiffInto } from '../utils/diff';
import { renderInto, decorateCodeBlocks, trimIncompleteMath } from '../utils/markdown';
import { t, bi, currentLanguage, onLanguageChange } from '../utils/i18n';
import {
  buildResponseLanguageHint,
  inferResponseLanguage,
  inferSelectionLanguage,
  inferSelectionTranslationTarget,
  sourceLanguageLabel,
} from '../utils/translation_target';
import { buildTaskContinuityHint } from '../utils/task_continuity';
import { compactHistoricalToolArgs, compactHistoricalToolResult } from '../utils/tool_context';
import {
  earlierHistoryWindow,
  latestHistoryWindow,
  newerHistoryWindow,
  selectChatHistory,
  type ChatHistoryWindow,
} from '../utils/chat_history_window';
import { captureUserPromptSnapshot, visibleUserContent } from '../utils/prompt_snapshot';
import {
  buildContextSourceReference,
  buildCurrentContextPolicyHint,
  pdfReadTaskForPrompt,
} from '../utils/context_policy';
import { shouldReuseRecentVisualContext, visualContinuityHint } from '../utils/visual_context';
import { loadProjectContext } from '../context/project_context';

export const VIEW_TYPE_GLOSSA = 'glossa-view';

function makeButtonLike(el: HTMLElement, label?: string) {
  el.setAttribute('role', 'button');
  el.tabIndex = 0;
  if (label) el.setAttribute('aria-label', label);
  el.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    el.click();
  });
}

function normalizeModelList(models: string[]): string[] {
  return [...new Set(models.map(m => String(m).trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));
}

const HIDDEN_TOOL_EVENTS = new Set(['attempt_completion']);
const INPUT_TRIGGER_LOOKBACK = 96;
const SELECTION_TRANSLATE_ENTER_WINDOW_MS = 520;

function shouldRenderToolEvent(ev: ToolEvent): boolean {
  return !HIDDEN_TOOL_EVENTS.has(ev.name);
}

function isHTMLElementNode(node: unknown): node is HTMLElement {
  return !!node && typeof node === 'object' && typeof (node as AnyValue).instanceOf === 'function' && (node as AnyValue).instanceOf(HTMLElement);
}

interface MsgUI {
  msg: ChatMessage;
  wrap: HTMLElement;
  body: HTMLElement;
  activityEl?: HTMLElement;
  elapsedEl?: HTMLElement;
  activityTimeEl?: HTMLElement;
  toolStack?: HTMLElement;
  actionsEl?: HTMLElement;
  reasoningCard?: HTMLElement;
  reasoningBody?: HTMLElement;
}

interface PromptExpansion {
  text: string;
  expanded: boolean;
  embeddedSelection: boolean;
  embeddedCurrentFile: boolean;
}

interface ThreadRailItem {
  id: string;
  role: ChatMessage['role'];
  kind: 'user' | 'assistant' | 'tool' | 'error' | 'summary';
  title: string;
  snippet: string;
  time: number;
  messageEl: HTMLElement;
  markerEl: HTMLElement;
}

export class GlossaView extends ItemView {
  plugin: GlossaPlugin;
  ctx: ContextManager;

  // DOM
  private rootEl: HTMLElement;
  private modelBtn: HTMLElement;
  private tokenBadge: HTMLElement;
  private updatePillEl: HTMLElement;
  private updatePopoverEl: HTMLElement | null = null;
  private contextBarEl: HTMLElement;
  private selectionPreviewEl: HTMLElement;
  private planBoardEl: HTMLElement;
  private get currentPlan(): PlanItem[] { return this.session.plan ?? []; }
  private messagesEl: HTMLElement;
  private threadRailEl: HTMLElement;
  private railPreviewEl: HTMLElement | null = null;
  private railItems: ThreadRailItem[] = [];
  private activeRailId: string | null = null;
  private hoverRailId: string | null = null;
  private stickToBottom = true;
  private railScrollRaf = 0;
  private railActiveUpdateRaf = 0;
  private emptyEl: HTMLElement | null = null;
  inputEl: HTMLTextAreaElement;     // public so /commands can populate it
  private inputWrap: HTMLElement;   // composer card — Aurora ring lives on it
  private submitBtn: HTMLButtonElement;
  private costBar: HTMLElement;

  // State
  private session: ChatSession;
  private streaming = false;
  /** Cursor into session.messages user-msgs for ↑/↓ history recall. -1 = not in
   *  history-nav mode (user is drafting fresh text). */
  private historyCursor = -1;
  /** Snapshot of textarea contents when history nav started, so ↓-all-the-way-down
   *  restores what the user was actually typing. */
  private historyDraft = '';
  private pendingRegeneratePrompt: string | null = null;
  private recentVisualContext: { images: { dataUri: string; name?: string }[] } | null = null;
  private abortCtl: AbortController | null = null;
  private popup = new Popup();
  private inputTriggerSig = '';
  private msgUIs = new Map<string, MsgUI>();
  private historyWindow: ChatHistoryWindow = { startTurn: 0, endTurn: -1 };
  private streamingMsgUI: MsgUI | null = null;
  private currentAsstMsg: ChatMessage | null = null;
  /** Bumped on every session boundary (newSession / loadSession). Submit()
   *  captures the value at start; every async callback (onText, onTool*,
   *  finalizeAsstRender) checks it before mutating UI / messages. A
   *  mismatch means "the user switched sessions while a chunk was in
   *  flight" — we drop the chunk silently. Without this guard, chunks
   *  arriving after a switch would write into the new session's messages
   *  array and corrupt history. */
  private sessionToken = 0;
  /** Shared turnId for every assistant message produced from the same user turn
   *  — set fresh at submit(), reused by onStepBoundary + flushAndStartNewAsstSegment. */
  private currentTurnId: string | null = null;
  private streamingBuf = '';
  /** True when the most recently consumed stream chunk in the current message
   *  was a tool_event. If text then resumes, we treat it as a NEW assistant
   *  segment and create a fresh message bubble so the rendering matches the
   *  actual turn shape: text → tools → text → tools → final text. */
  private lastChunkWasTool = false;
  /** Wall-clock when the current streaming message started (for the
   *  .nc-msg-elapsed counter on the assistant role label). Reset per segment. */
  private streamingStartedAt = 0;
  private currentSelection: { text: string; source: string; file?: TFile } | null = null;
  private selectionTranslateEnterAt = 0;
  private selectionTranslateEnterSig = '';
  /** Path of an auto-attached "current file" pill the user has explicitly
   *  dismissed via its × button. While this matches the active file's path,
   *  refreshAutoContext skips re-attaching it — otherwise active-leaf-change
   *  / file-open events would silently re-add the pill on the next tick and
   *  the × click would appear to do nothing. Cleared when the active file
   *  changes to a different path. */
  private dismissedCurrentPath: string | null = null;
  private autoContextRefreshSeq = 0;
  private sessionCostUSD = 0;
  private sessionInputTokens = 0;
  private sessionOutputTokens = 0;
  private currentActivityStartedAt = 0;

  constructor(leaf: WorkspaceLeaf, plugin: GlossaPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.ctx = new ContextManager();
    this.session = this.newSession();
  }

  getViewType() { return VIEW_TYPE_GLOSSA; }
  getDisplayText() { return 'Glossa'; }
  getIcon() { return 'glossa'; }

  async onOpen() {
    this.rootEl = this.containerEl.children[1] as HTMLElement;
    this.rootEl.empty();
    this.rootEl.addClass('glossa-view');
    // Back-compat: the root class was renamed in 0.3 — keep the old class on
    // for any community themes that already targeted `.note-codex-view`. Costs
    // nothing and prevents a stylesheet break for users with custom CSS.
    this.rootEl.addClass('note-codex-view');
    this.applyCssVars();

    this.buildHeader();
    this.planBoardEl = el('div', { className: 'nc-plan-board', parent: this.rootEl });
    setStyle(this.planBoardEl, { display: 'none' });
    this.threadRailEl = el('div', {
      className: 'nc-thread-rail',
      parent: this.rootEl,
      attrs: { 'aria-label': 'Conversation timeline' },
    });
    this.messagesEl = el('div', { className: 'nc-messages', parent: this.rootEl });
    this.messagesEl.addEventListener('scroll', this.onMessagesScroll, { passive: true });
    this.renderEmpty();
    this.buildInput();
    this.costBar = el('div', { className: 'nc-cost-bar', parent: this.rootEl });
    this.renderCostBar();

    this.ctx.on(() => { this.renderContextBar(); this.updateTokenBadge(); });

    void this.refreshAutoContext();
    // Some users opened the sidebar while no file was active yet; the initial
    // refreshAutoContext() ran with workspace.getActiveFile() returning null
    // and the current-file pill never appeared. Re-run once on layout-ready
    // (Obsidian guarantees an active file is resolved by then), then keep the
    // event-driven updates.
    this.app.workspace.onLayoutReady(() => { void this.refreshAutoContext(); });
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => { void this.refreshAutoContext(); }));
    this.registerEvent(this.app.workspace.on('file-open', () => { void this.refreshAutoContext(); }));
    this.registerEvent(this.app.workspace.on('editor-selection-change' as AnyValue, () => this.refreshSelection()));
    activeDocument.addEventListener('selectionchange', this.onDomSelectionChange);
    activeDocument.addEventListener('keydown', this.onGlobalSelectionTranslateEnter, true);

    // Re-render any header / input chrome whose strings come from `t()` when
    // the user toggles language in settings — no plugin reload required.
    this.langUnsub = onLanguageChange(() => this.rebuildChrome());
  }

  private langUnsub: (() => void) | null = null;
  /** Rebuild the static chrome (header, input footer, empty state) so any
   *  `t()`-sourced label picks up the new language. Messages keep their
   *  rendered content (model-generated text is language-neutral). */
  private rebuildChrome() {
    if (!this.rootEl) return;
    // Inputs hold a value we don't want to lose; preserve + restore.
    const inputBackup = this.inputEl?.value ?? '';
    // Header
    const header = this.rootEl.querySelector('.nc-header'); header?.remove();
    this.buildHeader();
    const rebuiltHeader = this.rootEl.querySelector('.nc-header');
    if (rebuiltHeader) this.rootEl.insertBefore(rebuiltHeader, this.planBoardEl);
    // Input area
    const inputWrap = this.rootEl.querySelector('.nc-input-wrap'); inputWrap?.remove();
    const costBar = this.costBar; costBar.remove();
    this.buildInput();
    this.rootEl.appendChild(costBar);
    if (this.inputEl) this.inputEl.value = inputBackup;
    // Empty-state placeholder if we're still on a fresh session
    if (this.session.messages.length === 0) this.renderEmpty();
    this.renderCostBar();
    this.refreshFromSettings();
  }

  onDomSelectionChange = debounce(() => {
    // Textarea caret movement fires document selectionchange in Chromium.
    // Do not run the expensive workspace-selection resolver while the user is
    // typing/deleting inside Glossa's own composer.
    if (activeDocument.activeElement === this.inputEl) return;
    this.refreshSelection();
  }, 120);

  private onGlobalSelectionTranslateEnter = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.isComposing || (e as AnyValue).keyCode === 229) return;
    if (this.streaming || this.popup.isOpen() || this.histPopEl) return;

    const sel = this.currentSelection;
    const selectedText = sel?.text.trim() ?? '';
    if (!sel || !selectedText) {
      this.selectionTranslateEnterAt = 0;
      this.selectionTranslateEnterSig = '';
      return;
    }

    const active = activeDocument.activeElement as HTMLElement | null;
    const inComposer = active === this.inputEl;
    if (this.inputEl.value.trim()) return;
    if (!inComposer && this.shouldIgnoreSelectionTranslateKeyTarget(active)) return;

    const sig = `${sel.source}\u0000${sel.file?.path ?? ''}\u0000${selectedText}`;
    const now = Date.now();
    const isSecondEnter = this.selectionTranslateEnterSig === sig
      && now - this.selectionTranslateEnterAt <= SELECTION_TRANSLATE_ENTER_WINDOW_MS;

    e.preventDefault();
    e.stopPropagation();

    if (!isSecondEnter) {
      this.selectionTranslateEnterAt = now;
      this.selectionTranslateEnterSig = sig;
      return;
    }

    this.selectionTranslateEnterAt = 0;
    this.selectionTranslateEnterSig = '';
    void this.submitSelectionTranslation(sel);
  };

  private shouldIgnoreSelectionTranslateKeyTarget(active: HTMLElement | null): boolean {
    if (!active) return false;
    if (activeDocument.querySelector('.modal-container')) return true;
    const tag = active.tagName.toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return true;
    if (active.closest('.menu, .suggestion-container, .nc-history-popover, .nc-popup')) return true;
    if (this.rootEl?.contains(active)) {
      return !!active.closest('button, a, input, textarea, select, [role="button"]');
    }
    return false;
  }

  private async submitSelectionTranslation(sel: { text: string; source: string; file?: TFile }) {
    if (this.streaming || !this.inputEl) return;
    if (this.inputEl.value.trim()) {
      quickNotice(bi('Clear the input before quick-translating a selection.', '清空输入框后再快速翻译选区。'));
      return;
    }
    this.currentSelection = sel;
    const target = this.translationTargetForSelection(sel.text);
    this.inputEl.value = `/translate ${target}`;
    this.inputEl.selectionStart = this.inputEl.selectionEnd = this.inputEl.value.length;
    this.recomputeInputHeight();
    this.inputEl.focus();
    await this.submit();
  }

  private translationTargetForSelection(text: string): 'Chinese' | 'English' {
    return inferSelectionTranslationTarget(text, currentLanguage());
  }

  private onMessagesScroll = () => {
    this.stickToBottom = this.isMessagesNearBottom();
    if (this.railScrollRaf) return;
    this.railScrollRaf = window.requestAnimationFrame(() => {
      this.railScrollRaf = 0;
      this.scheduleThreadRailActiveUpdate();
    });
  };

  /** Apply user-tunable CSS variables to the view root. The single Font size
   *  slider in Settings drives both the base prose font (`--nc-base-font`) and
   *  the reasoning card's body font (`--nc-reasoning-font`). They follow each
   *  other rather than being two separate knobs — one slider is what users
   *  actually want; differential scaling was over-engineered. */
  applyCssVars() {
    if (!this.rootEl) return;
    const size = Math.max(11, Math.min(18, this.plugin.settings.reasoningFontSize ?? 13));
    setVars(this.rootEl, { ['--nc-base-font']: `${size}px` });
    setVars(this.rootEl, { ['--nc-reasoning-font']: `${size}px` });
    // Derived ratios so everything scales together: small captions, header,
    // pills. Pinned to the base via em values whenever possible, but these
    // explicit-px feeders cover spots that need integer rounding for crispness.
    setVars(this.rootEl, { ['--nc-font-sm']: `${Math.max(10, size - 2)}px` });
    setVars(this.rootEl, { ['--nc-font-xs']: `${Math.max(9, size - 3)}px` });
  }

  async onClose() {
    activeDocument.removeEventListener('selectionchange', this.onDomSelectionChange);
    activeDocument.removeEventListener('keydown', this.onGlobalSelectionTranslateEnter, true);
    this.popup.destroy();
    this.langUnsub?.();
    this.langUnsub = null;
    await this.flushPersistNow();
  }

  /* ============================================================
     Header
     ============================================================ */
  private modeToggle: HTMLElement;

  private buildHeader() {
    const header = el('div', { className: 'nc-header', parent: this.rootEl });

    // Plan / Act segmented control — aurora knob slides between the two
    // options. Click anywhere on the container toggles; the click handler
    // resolves the target mode from the segment that was hit so clicking
    // the already-active side is a no-op rather than a flip.
    this.modeToggle = el('div', { className: 'nc-mode-seg', parent: header });
    this.modeToggle.setAttribute('role', 'group');
    this.modeToggle.setAttribute('aria-label', 'Run mode');
    const planSeg = el('button', { className: 'nc-mode-seg-opt', parent: this.modeToggle, text: 'Plan', type: 'button' });
    planSeg.setAttribute('data-opt', 'plan');
    planSeg.setAttribute('aria-label', 'Plan mode');
    const actSeg = el('button', { className: 'nc-mode-seg-opt', parent: this.modeToggle, text: 'Act', type: 'button' });
    actSeg.setAttribute('data-opt', 'act');
    actSeg.setAttribute('aria-label', 'Act mode');
    this.updateModeToggle();
    const pickMode = async (target: 'plan' | 'act') => {
      if (this.plugin.settings.runMode === target) return;
      this.plugin.settings.runMode = target;
      await this.plugin.saveSettings();
      this.updateModeToggle();
    };
    planSeg.onclick = () => pickMode('plan');
    actSeg.onclick  = () => pickMode('act');

    this.tokenBadge = el('span', { className: 'nc-token-badge', parent: header, title: t('token_total') });
    this.updateTokenBadge();

    this.updatePillEl = el('button', { className: 'nc-update-pill', parent: header, type: 'button' });
    this.updatePillEl.onclick = () => this.toggleUpdatePopover();
    this.updateUpdatePill();

    el('span', { className: 'nc-header-spacer', parent: header });

    const newBtn = el('button', { className: 'nc-icon-btn', parent: header, title: t('new_chat'), type: 'button', attrs: { 'aria-label': t('new_chat') } });
    setTrustedSvg(newBtn, ICON.plus);
    newBtn.onclick = () => this.startNewSession();

    const histBtn = el('button', { className: 'nc-icon-btn', parent: header, title: t('chat_history'), type: 'button', attrs: { 'aria-label': t('chat_history') } });
    setTrustedSvg(histBtn, ICON.history);
    histBtn.onclick = () => this.toggleHistoryPopover(histBtn);

    const exportBtn = el('button', { className: 'nc-icon-btn', parent: header, title: t('export_chat'), type: 'button', attrs: { 'aria-label': t('export_chat') } });
    setTrustedSvg(exportBtn, ICON.upload);
    exportBtn.onclick = () => { void this.exportChatToNote(); };

    const settingsBtn = el('button', { className: 'nc-icon-btn', parent: header, title: t('settings'), type: 'button', attrs: { 'aria-label': t('settings') } });
    setTrustedSvg(settingsBtn, ICON.cog);
    settingsBtn.onclick = () => this.openPluginSettings();
  }

  /** Public — called by plugin after settings save so chrome stays fresh. */
  refreshFromSettings() {
    this.updateModelBtn();
    this.updateModeToggle();
    this.updateUpdatePill();
    this.renderCostBar();
    this.refreshComposerPills?.();
  }

  private updateUpdatePill() {
    if (!this.updatePillEl) return;
    const info = this.plugin.updateInfo;
    if (!info) {
      setStyle(this.updatePillEl, { display: 'none' });
      this.hideUpdatePopover();
      return;
    }
    setStyle(this.updatePillEl, { display: '' });
    this.updatePillEl.empty();
    const icon = el('span', { className: 'nc-update-pill-icon', parent: this.updatePillEl });
    setTrustedSvg(icon, ICON.sparkles);
    el('span', { className: 'nc-update-pill-text', text: `Update ${info.latestVersion}`, parent: this.updatePillEl });
  }

  private toggleUpdatePopover() {
    if (this.updatePopoverEl?.isConnected) { this.hideUpdatePopover(); return; }
    this.showUpdatePopover();
  }

  private showUpdatePopover() {
    const info = this.plugin.updateInfo;
    if (!info || !this.rootEl || !this.updatePillEl) return;
    this.hideUpdatePopover();
    const pop = el('div', { className: 'nc-update-popover', parent: this.rootEl });
    const head = el('div', { className: 'nc-update-popover-head', parent: pop });
    const mark = el('span', { className: 'nc-update-popover-icon', parent: head });
    setTrustedSvg(mark, ICON.sparkles);
    const title = el('div', { className: 'nc-update-popover-title', parent: head });
    el('strong', { text: bi('Update available', '发现新版本'), parent: title });
    el('span', { text: `${info.currentVersion} → ${info.latestVersion}`, parent: title });
    const close = el('button', { className: 'nc-update-popover-close', parent: head, type: 'button' });
    setTrustedSvg(close, ICON.x);
    close.onclick = () => this.hideUpdatePopover();

    const body = el('div', { className: 'nc-update-popover-body', parent: pop });
    if (info.notes.length) {
      const list = el('ul', { parent: body });
      for (const note of info.notes.slice(0, 4)) el('li', { text: note, parent: list });
    } else {
      el('p', {
        text: bi(
          'Open the in-app plugin page to update. If it has not synced yet, GitHub is available as a fallback.',
          '打开 Obsidian 客户端内的插件页面更新。如果还没同步，再用 GitHub 兜底。',
        ),
        parent: body,
      });
    }
    const actions = el('div', { className: 'nc-update-popover-actions', parent: pop });
    const market = el('button', { className: 'nc-update-action primary', text: bi('Update in Obsidian', '在 Obsidian 中更新'), parent: actions, type: 'button' });
    market.onclick = () => { this.openObsidianPluginPage(info.obsidianUrl); };
    const release = el('button', { className: 'nc-update-action', text: 'GitHub Release', parent: actions, type: 'button' });
    release.onclick = () => { window.open(info.releaseUrl); };
    const dismiss = el('button', { className: 'nc-update-action subtle', text: bi('Dismiss this version', '忽略此版本'), parent: actions, type: 'button' });
    dismiss.onclick = () => { this.plugin.dismissUpdate(info.latestVersion).catch(() => {}); };

    const pillRect = this.updatePillEl.getBoundingClientRect();
    const rootRect = this.rootEl.getBoundingClientRect();
    const left = Math.max(8, Math.min(rootRect.width - 332, pillRect.left - rootRect.left - 8));
    setStyle(pop, { top: `${pillRect.bottom - rootRect.top + 8}px`, left: `${left}px` });
    this.updatePopoverEl = pop;

    const onDocClick = (evt: MouseEvent) => {
      const target = evt.target as HTMLElement;
      if (pop.contains(target) || this.updatePillEl.contains(target)) return;
      this.hideUpdatePopover();
      activeDocument.removeEventListener('mousedown', onDocClick, true);
    };
    window.setTimeout(() => activeDocument.addEventListener('mousedown', onDocClick, true), 0);
  }

  private hideUpdatePopover() {
    this.updatePopoverEl?.remove();
    this.updatePopoverEl = null;
  }

  private openObsidianPluginPage(url: string) {
    try {
      window.open(url);
      return;
    } catch {
      // Fall through to the internal settings pane below.
    }
    try {
      (this.app as AnyValue).setting?.open?.();
      (this.app as AnyValue).setting?.openTabById?.('community-plugins');
    } catch {
      quickNotice(bi('Open Settings → Community plugins and search Glossa.', '打开设置 → 第三方插件，搜索 Glossa。'), 5000);
    }
  }

  private updateModeToggle() {
    if (!this.modeToggle) return;
    const mode = this.plugin.settings.runMode;
    // The knob slide is driven entirely by data-mode + CSS — no DOM rebuild.
    // Preserving the children avoids re-attaching click handlers and lets
    // the slide animation play continuously when toggled.
    this.modeToggle.setAttribute('data-mode', mode);
    this.modeToggle.classList.toggle('plan', mode === 'plan');
    this.modeToggle.classList.toggle('act', mode === 'act');
    this.modeToggle.title = mode === 'plan' ? t('plan_tooltip') : t('act_tooltip');
    for (const btn of Array.from(this.modeToggle.querySelectorAll<HTMLButtonElement>('.nc-mode-seg-opt'))) {
      btn.setAttribute('aria-pressed', String(btn.dataset.opt === mode));
    }
  }
  /** History popover anchored to the history icon. Click toggles, Esc / outside
   *  click closes. Self-contained floating layer — does NOT mutate the layout
   *  of the messages area, so it can't trigger the hover-scrollbar oscillation
   *  the earlier drawer suffered from. */
  private histPopEl: HTMLElement | null = null;
  private histPopCleanup: (() => void) | null = null;
  private async toggleHistoryPopover(anchor: HTMLElement) {
    this.popup.hide();
    if (this.histPopEl) { this.closeHistoryPopover(); return; }
    const { renderHistoryPopover } = await import('./history_modal');
    // NO backdrop — earlier feedback: dimming the rest of the page makes the
    // popover feel like a modal. We want a Raycast / Cursor task-list feel
    // (small floating panel, surrounding page stays alive). Outside-click
    // still closes via the document-level listener below.
    const host = activeDocument.createElement('div');
    host.className = 'nc-history-popover';
    activeDocument.body.appendChild(host);
    this.histPopEl = host;

    // Position below the anchor, right-aligned. Use rAF so we measure after
    // the host has been laid out.
    window.requestAnimationFrame(() => this.positionHistoryPopover(anchor));

    const cleanupView = renderHistoryPopover(host, this.plugin, {
      onPick: (s) => {
        this.closeHistoryPopover({ immediate: true });
        window.requestAnimationFrame(() => { void this.loadSession(s.id); });
      },
      onClose: () => this.closeHistoryPopover(),
      onDelete: (id) => this.handleHistorySessionDeleted(id),
      onClear: () => this.handleHistoryCleared(),
    });

    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') { ev.preventDefault(); this.closeHistoryPopover(); }
    };
    const onDocClick = (ev: MouseEvent) => {
      const t = ev.target as Node;
      if (host.contains(t) || anchor.contains(t)) return;
      this.closeHistoryPopover();
    };
    const onScroll = () => this.positionHistoryPopover(anchor);
    activeDocument.addEventListener('keydown', onKey, true);
    // Defer mousedown registration so the same click that opened the
    // popover doesn't immediately close it.
    window.setTimeout(() => activeDocument.addEventListener('mousedown', onDocClick, true), 0);
    window.addEventListener('resize', onScroll);
    this.histPopCleanup = () => {
      activeDocument.removeEventListener('keydown', onKey, true);
      activeDocument.removeEventListener('mousedown', onDocClick, true);
      window.removeEventListener('resize', onScroll);
      cleanupView();
    };
  }
  private positionHistoryPopover(anchor: HTMLElement) {
    if (!this.histPopEl) return;
    const r = anchor.getBoundingClientRect();
    const popW = 320;
    const popMaxH = Math.min(460, window.innerHeight - r.bottom - 24);
    setStyle(this.histPopEl, { width: `${popW}px` });
    setStyle(this.histPopEl, { maxHeight: `${popMaxH}px` });
    // Right-align with the anchor, clamped inside viewport.
    let left = r.right - popW;
    left = Math.max(8, Math.min(window.innerWidth - popW - 8, left));
    const top = Math.min(window.innerHeight - popMaxH - 8, r.bottom + 6);
    setStyle(this.histPopEl, { left: `${left}px` });
    setStyle(this.histPopEl, { top: `${top}px` });
  }
  private closeHistoryPopover(opts: { immediate?: boolean } = {}) {
    if (!this.histPopEl) return;
    this.histPopCleanup?.();
    this.histPopCleanup = null;
    const el = this.histPopEl;
    this.histPopEl = null;
    if (opts.immediate) {
      el.remove();
      return;
    }
    el.classList.add('closing');
    window.setTimeout(() => el.remove(), 140);
  }

  private openPluginSettings() {
    const settings = (this.app as AnyValue).setting;
    settings?.open?.();
    settings?.openTabById?.(this.plugin.manifest.id);
  }

  private updateTokenBadge() {
    if (!this.tokenBadge) return;
    const ctxN = this.ctx.totalTokens();
    const selN = this.currentSelection ? Math.max(1, Math.ceil(this.currentSelection.text.length / 4)) : 0;
    const total = ctxN + selN;
    this.tokenBadge.textContent = formatTokenCount(total);
    this.tokenBadge.title = `Context: ${ctxN} tok${selN ? ` + Selection: ${selN} tok` : ''} = ${total}`;
    this.tokenBadge.toggleClass('warn', total > this.plugin.settings.warnTokenThreshold);
  }

  private effectiveContextWindow(model: string | undefined | null = this.activeEndpoint()?.model): {
    maxCtx: number;
    inferred: number | null;
    settingsMax: number;
    source: 'model' | 'settings';
  } {
    const settingsMax = this.plugin.settings.maxContextTokens;
    const inferred = modelContextWindow(model);
    if (inferred && inferred > 0) {
      return { maxCtx: Math.min(inferred, settingsMax), inferred, settingsMax, source: 'model' };
    }
    return { maxCtx: settingsMax, inferred: null, settingsMax, source: 'settings' };
  }

  /* ============================================================
     Context bar / selection preview (inline above input)
     ============================================================ */
  private async refreshAutoContext() {
    const refreshSeq = ++this.autoContextRefreshSeq;
    if (!this.plugin.settings.autoAttachCurrentFile) {
      this.ctx.updateCurrent(null);
    } else {
      const af = this.app.workspace.getActiveFile();
      // Clear the "dismissed" sentinel as soon as the user navigates to a
      // different file — the dismissal was about THAT specific file, not a
      // permanent opt-out of the auto-attach feature.
      if (this.dismissedCurrentPath && (!af || af.path !== this.dismissedCurrentPath)) {
        this.dismissedCurrentPath = null;
      }
      const userDismissed = !!(af && af.path === this.dismissedCurrentPath);
      if (userDismissed) {
        this.ctx.updateCurrent(null);
      } else if (af && af.extension === 'md') {
        const content = await this.app.vault.cachedRead(af);
        if (refreshSeq !== this.autoContextRefreshSeq || this.app.workspace.getActiveFile()?.path !== af.path) return;
        this.ctx.updateCurrent(makeCurrentFileItem(af, content));
      } else if (af) {
        this.ctx.updateCurrent({
          id: 'current-' + af.path, kind: 'file',
          label: af.basename + '.' + af.extension,
          detail: af.path,
          content: `### Current file: ${af.path}\n(content loads at send time according to the requested task.)`,
          tokens: 0, pinned: false, isCurrent: true,
        });
      } else {
        this.ctx.updateCurrent(null);
      }
    }
    this.refreshSelection();
  }

  /** Refresh the open source at send time. Markdown picks up the latest edit;
   * PDF/image resolution stays lazy, and the prompt determines whether a PDF
   * needs summary sampling, title inspection, or a broader read. */
  private async hydrateCurrentContextForPrompt(userText: string, sourceAlreadyEmbedded: boolean): Promise<void> {
    if (!this.plugin.settings.autoAttachCurrentFile) return;
    const file = this.currentContextFile();
    if (!file || file.path === this.dismissedCurrentPath || sourceAlreadyEmbedded) return;
    const expectedPath = file.path;
    let item: ContextItem;
    try {
      item = file.extension === 'md'
        ? makeCurrentFileItem(file, await this.app.vault.cachedRead(file))
        : await resolveFile(this.app, file, { pdfTask: pdfReadTaskForPrompt(userText) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      item = {
        id: `current-${expectedPath}`,
        kind: 'file',
        label: file.name,
        detail: expectedPath,
        content: `### Current file read failed: ${expectedPath}\n\n${message}`,
        tokens: 0,
        pinned: false,
        isCurrent: true,
      };
      quickNotice(`Could not read current file: ${message}`);
    }
    if (this.currentContextFile()?.path !== expectedPath || expectedPath === this.dismissedCurrentPath) return;
    this.ctx.updateCurrent({
      ...item,
      id: `current-${expectedPath}`,
      pinned: false,
      isCurrent: true,
    });
  }

  private currentContextFile(): TFile | null {
    const active = this.app.workspace.getActiveFile();
    if (active) return active;
    const path = this.ctx.list().find(item => item.isCurrent)?.detail;
    if (!path) return null;
    const file = this.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile ? file : null;
  }

  private refreshSelection() {
    if (!this.plugin.settings.autoAttachSelection) {
      this.currentSelection = null;
      this.renderSelectionPreview();
      this.updateTokenBadge();
      return;
    }
    const sel = getCurrentSelection(this.app);
    if (sel && sel.text.trim().length >= 2) {
      const sameSelection = this.currentSelection
        && this.currentSelection.text === sel.text
        && this.currentSelection.source === sel.source
        && this.currentSelection.file?.path === sel.file?.path;
      if (!sameSelection) {
        this.currentSelection = sel;
        this.renderSelectionPreview();
        this.updateTokenBadge();
      }
      return;
    }
    // Selection is empty. Only KEEP the existing one if the user is *actively typing*
    // in our chat textarea (i.e., the textarea is the focused element). Any other focus
    // state — editor pane, status bar, ribbon, another sidebar — counts as "deselected".
    const typingInChat = activeDocument.activeElement === this.inputEl;
    if (!typingInChat) {
      if (this.currentSelection) {
        this.currentSelection = null;
        this.renderSelectionPreview();
        this.updateTokenBadge();
      }
    }
  }

  private renderSelectionPreview() {
    if (!this.selectionPreviewEl) return;
    clear(this.selectionPreviewEl);
    this.updateInputPlaceholder();
    if (!this.currentSelection) { setStyle(this.selectionPreviewEl, { display: 'none' }); return; }
    const sel = this.currentSelection;
    const text = sel.text;
    const lineCount = this.selectionLineCount(text);
    const isLarge = text.length > 360 || lineCount > 6;
    const source = this.selectionSourceLabel(sel.source);
    const title = this.selectionTitle(text, source);
    const preview = this.compactSelectionPreview(text, isLarge ? 140 : 220);
    setStyle(this.selectionPreviewEl, { display: '' });
    this.selectionPreviewEl.classList.toggle('is-large', isLarge);
    const body = el('div', { className: 'nc-selection-preview-body', parent: this.selectionPreviewEl });
    const head = el('div', { className: 'nc-selection-preview-head', parent: body });
    el('span', { className: 'nc-selection-preview-title', text: title, parent: head });
    const meta = el('div', { className: 'nc-selection-preview-meta', parent: body });
    el('span', { className: 'nc-selection-preview-source', text: source, parent: meta });
    el('span', {
      className: 'nc-selection-preview-language',
      text: sourceLanguageLabel(inferSelectionLanguage(text), currentLanguage()),
      parent: meta,
    });
    if (sel.file) {
      el('span', { className: 'nc-selection-preview-file', text: sel.file.basename, title: sel.file.path, parent: meta });
    }
    el('span', { className: 'nc-selection-preview-chars', text: `${text.length.toLocaleString()} chars${lineCount > 1 ? ` · ${lineCount.toLocaleString()} lines` : ''}`, parent: meta });
    el('div', { className: 'nc-selection-preview-text', text: preview, title: text.length > preview.length ? text.slice(0, 1200) : undefined, parent: body });
    const close = el('button', { className: 'nc-selection-preview-close', parent: this.selectionPreviewEl, title: 'Detach selection', type: 'button', attrs: { 'aria-label': 'Detach selection' } });
    setTrustedSvg(close, ICON.x);
    close.onclick = () => { this.currentSelection = null; this.renderSelectionPreview(); };
  }

  private updateInputPlaceholder() {
    if (!this.inputEl) return;
    const hasSelection = !!this.currentSelection?.text.trim();
    const hasDraft = !!this.inputEl.value.trim();
    this.inputEl.placeholder = hasSelection && !hasDraft
      ? bi('Ask about the selected content', '询问选中内容')
      : t('placeholder_input');
  }

  private selectionSourceLabel(source: string) {
    if (source === 'markdown') return 'Markdown';
    if (source === 'pdf') return 'PDF';
    if (source === 'html') return 'HTML';
    if (source === 'glossa') return 'Glossa output';
    return 'Selection';
  }

  private selectionLineCount(text: string) {
    if (!text) return 0;
    return text.split(/\r\n|\r|\n/).length;
  }

  private selectionTitle(text: string, source: string) {
    const lines = text.split(/\r\n|\r|\n/).map(s => s.trim()).filter(Boolean);
    const tableLines = lines.filter(s => /^\|.+\|$/.test(s)).length;
    if (tableLines >= 2) return 'Table selection';
    if (text.length > 1200 || lines.length > 12) return 'Large selection';
    if (source === 'PDF') return 'PDF selection';
    if (source === 'Glossa output') return 'Glossa output';
    return 'Selected text';
  }

  private compactSelectionPreview(text: string, maxChars: number) {
    const normalized = text
      .replace(/\|[-:\s|]+\|/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!normalized) return '';
    if (normalized.length <= maxChars) return normalized;
    return normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd() + '…';
  }

  private compactSelectionEcho(text: string) {
    const limit = 1600;
    if (text.length <= limit) return text;
    return text.slice(0, limit).trimEnd() + `\n...[truncated ${text.length.toLocaleString()} chars]`;
  }

  private contextBarSig = '';
  private renderContextBar() {
    if (!this.contextBarEl) return;
    // Skip the re-render (and its fade-in animation) when the visible pills are unchanged.
    const sig = this.ctx.list().map(it => `${it.kind}:${it.label}:${it.detail}:${it.pinned ? 1 : 0}:${it.isCurrent ? 1 : 0}`).join('|');
    if (sig === this.contextBarSig) return;
    this.contextBarSig = sig;
    clear(this.contextBarEl);
    const items = this.ctx.list();
    const explicit = items.filter(it => !it.isCurrent);
    const current = items.filter(it => it.isCurrent);
    const groups: Array<[string, ContextItem[]]> = [];
    if (explicit.length) groups.push([bi('Attached', '附件'), explicit]);
    if (current.length) groups.push([bi('Current', '当前'), current]);
    for (const [label, groupItems] of groups) {
      const group = el('div', { className: 'nc-context-group' + (groupItems.some(it => it.isCurrent) ? ' current' : ' attached'), parent: this.contextBarEl });
      el('span', { className: 'nc-context-group-label', text: label, parent: group });
      const row = el('div', { className: 'nc-context-group-items', parent: group });
    for (const it of groupItems) {
      const pill = el('span', {
        className: 'nc-pill' + (it.pinned ? ' pinned' : '') + (it.isCurrent ? ' current' : '') + (it.kind === 'image' ? ' image' : ''),
        parent: row,
      });
      if (it.kind === 'image' && it.content.startsWith('data:image/')) {
        const thumb = el('img', { className: 'nc-pill-thumb', parent: pill });
        (thumb).src = it.content;
      } else {
        const ic = el('span', { className: 'nc-pill-icon', parent: pill });
        setTrustedSvg(ic, pillIcon(it));
      }
      el('span', { className: 'nc-pill-label', text: it.label, title: it.detail || it.label, parent: pill });
      if (it.isCurrent) {
        // The group label already says Current; repeating it inside the chip
        // makes the composer read as "CURRENT ... CURRENT".
      } else if (it.kind === 'image') {
        el('span', { className: 'nc-pill-meta', text: 'IMG', parent: pill });
      } else {
        el('span', { className: 'nc-pill-meta', text: formatTokenCount(it.tokens), parent: pill });
      }
      const close = el('span', { className: 'nc-pill-close', parent: pill, title: 'Remove' });
      setTrustedSvg(close, ICON.x);
      // Single removal routine shared by both close-button and context-menu paths.
      // The "current file" pill has TWO subtleties the regular ctx.remove
      // path can't handle on its own:
      //   1. `auto-attach current file` re-runs makeCurrentFileItem on every
      //      active-leaf-change / file-open and assigns a fresh uid() each
      //      time. The id captured in this closure can therefore be stale,
      //      and ctx.remove(staleId) becomes a no-op. → For current pills,
      //      use ctx.updateCurrent(null) which keys off `isCurrent` not id.
      //   2. Even after removal, refreshAutoContext would silently re-attach
      //      the same file on the next event. → Park the file path in
      //      `dismissedCurrentPath` so refreshAutoContext skips re-attach
      //      until the user opens a different file.
      const removeThis = () => {
        if (it.isCurrent) {
          if (it.detail) this.dismissedCurrentPath = it.detail;
          this.ctx.updateCurrent(null);
        } else {
          this.ctx.remove(it.id);
        }
      };
      close.onclick = (e) => {
        e.stopPropagation();
        removeThis();
      };
      pill.onclick = () => this.openContextItem(it);
      makeButtonLike(pill, it.detail ? `Open ${it.detail}` : `Open ${it.label}`);
      pill.oncontextmenu = (e) => {
        e.preventDefault();
        const m = new Menu();
        m.addItem(i => i.setTitle(it.pinned ? 'Unpin' : 'Pin').onClick(() => this.ctx.togglePin(it.id)));
        if (it.kind === 'file' && it.detail) {
          m.addItem(i => i.setTitle('Open file').onClick(() => this.openContextItem(it)));
        }
        m.addItem(i => i.setTitle('Remove').onClick(removeThis));
        m.showAtMouseEvent(e);
      };
    }
    }
  }

  private openContextItem(it: ContextItem) {
    if (it.kind === 'file' && it.detail) {
      const f = this.app.vault.getAbstractFileByPath(it.detail);
      if (f instanceof TFile) void this.app.workspace.getLeaf(false).openFile(f);
    }
  }

  /* ============================================================
     Empty state
     ============================================================ */
  private renderEmpty() {
    clear(this.messagesEl);
    this.rootEl.classList.remove('has-messages');
    this.resetThreadRail();
    this.emptyEl = el('div', { className: 'nc-empty', parent: this.messagesEl });
    // Aurora orb — replaces the prior bot glyph as the hero artwork.
    // Breathing scale animation lives entirely in CSS (.g-orb-halo, .g-orb-core)
    // so this method stays pure DOM.
    const orb = el('div', { className: 'nc-empty-icon nc-empty-orb', parent: this.emptyEl });
    setTrustedSvg(orb, AURORA_ORB_SVG);
    // Title wordmark styling lives in CSS so theme refinements stay centralized.
    el('div', { className: 'nc-empty-title', text: t('empty_title'), parent: this.emptyEl });

    // Chips live in a group container with a list role so screen readers
    // announce them as "List, 4 items"; each chip is a button so Tab
    // navigation works and Enter activates (matches click semantics).
    const chips = el('div', { className: 'nc-example-chips', parent: this.emptyEl, attrs: { role: 'list' } });
    const examples = [
      { cmd: '/translate', text: bi('Translate the selection',     '翻译选中段落') },
      { cmd: '/summarize', text: bi('Summarise the current note',   '总结当前笔记') },
      { cmd: '/explain',   text: bi('Explain the selected concept', '解释选中的概念') },
      { cmd: '@',          text: bi('Attach another note as context', '把另一篇笔记加进上下文') },
    ];
    examples.forEach((ex, i) => {
      // <button> so keyboard nav + screen reader semantics come for free
      // (was <div>, which screen readers skipped entirely).
      const chip = activeDocument.createElement('button');
      chip.className = 'nc-example-chip';
      chip.type = 'button';
      chip.setAttribute('role', 'listitem');
      chip.setAttribute('aria-label', `${ex.cmd} — ${ex.text}`);
      chips.appendChild(chip);
      setVars(chip, { ['--g-stagger']: `${i * 60}ms` });
      el('span', { className: 'nc-example-chip-cmd', text: ex.cmd, parent: chip });
      el('span', { className: 'nc-example-chip-text', text: ex.text, parent: chip });
      const arrow = el('span', { className: 'nc-example-chip-arrow', parent: chip });
      setTrustedSvg(arrow, ICON.arrowRight);
      const fire = () => {
        this.inputEl.value = ex.cmd + (ex.cmd === '@' ? '' : ' ');
        this.inputEl.focus();
        this.inputEl.dispatchEvent(new Event('input'));
      };
      chip.onclick = fire;
      // Keyboard activation is automatic for <button>, but we also handle
      // Space the same way for visual parity with Enter.
    });
  }

  /* ============================================================
     Messages rendering
     ============================================================ */
  private renderSessionHistory(options: { anchorMessageId?: string; scrollToBottom?: boolean } = {}) {
    const selected = selectChatHistory(this.session.messages, this.historyWindow);
    this.historyWindow = selected.window;
    this.msgUIs.clear();
    clear(this.messagesEl);
    this.resetThreadRail();
    if (!selected.messages.length) {
      this.renderEmpty();
      return;
    }

    this.messagesEl.classList.add('no-anim');
    if (selected.hasEarlier) this.renderHistoryNavigation('earlier', selected.window, selected.totalTurns);
    for (const message of selected.messages) this.renderMessage(message);
    if (selected.hasNewer) this.renderHistoryNavigation('newer', selected.window, selected.totalTurns);
    this.compactAllProcessGroups();

    window.requestAnimationFrame(() => {
      this.messagesEl.classList.remove('no-anim');
      if (options.anchorMessageId) {
        const anchor = this.msgUIs.get(options.anchorMessageId)?.wrap;
        if (anchor) this.messagesEl.scrollTop = Math.max(0, anchor.offsetTop - this.messagesEl.offsetTop - 16);
      } else if (options.scrollToBottom || !selected.hasNewer) {
        this.scrollToBottom(true);
      }
    });
  }

  private renderHistoryNavigation(kind: 'earlier' | 'newer', window: ChatHistoryWindow, totalTurns: number) {
    const button = el('button', {
      className: `nc-history-window-nav ${kind}`,
      parent: this.messagesEl,
      type: 'button',
      attrs: { 'aria-label': kind === 'earlier' ? 'Load earlier conversation turns' : 'Load newer conversation turns' },
    });
    const icon = el('span', { className: 'nc-history-window-nav-icon', parent: button });
    setTrustedSvg(icon, ICON.arrowDown);
    el('span', {
      parent: button,
      text: kind === 'earlier'
        ? `Earlier turns · showing ${window.startTurn + 1}-${window.endTurn + 1} of ${totalTurns}`
        : `Newer turns · showing ${window.startTurn + 1}-${window.endTurn + 1} of ${totalTurns}`,
    });
    button.onclick = () => {
      const firstVisibleId = selectChatHistory(this.session.messages, this.historyWindow).messages[0]?.id;
      this.historyWindow = kind === 'earlier'
        ? earlierHistoryWindow(this.session.messages, this.historyWindow)
        : newerHistoryWindow(this.session.messages, this.historyWindow);
      const next = selectChatHistory(this.session.messages, this.historyWindow);
      this.renderSessionHistory({
        anchorMessageId: kind === 'earlier' ? firstVisibleId : next.messages[0]?.id,
        scrollToBottom: kind === 'newer' && !next.hasNewer,
      });
    };
  }

  private renderMessage(m: ChatMessage): MsgUI {
    if (this.emptyEl?.isConnected) { this.emptyEl.remove(); this.emptyEl = null; }
    this.rootEl.classList.add('has-messages');
    // "Continuation" = this assistant msg shares a turnId with the immediately
    // previous assistant msg. Used to collapse role row + footer between
    // segments so multi-segment codex turns read as one continuous reply.
    let isContinuation = false;
    let previousAssistant: HTMLElement | null = null;
    if (m.role === 'assistant' && m.turnId) {
      const last = this.messagesEl.lastElementChild as HTMLElement | null;
      if (last?.classList.contains('nc-msg') && last.classList.contains('assistant')) {
        const prevTurn = last.getAttribute('data-turn-id');
        if (prevTurn && prevTurn === m.turnId) {
          isContinuation = true;
          previousAssistant = last;
        }
      }
    }
    if (previousAssistant) previousAssistant.classList.add('has-next-continuation');
    const continuationCls = isContinuation ? ' nc-asst-continuation' : '';
    const wrap = el('div', { className: `nc-msg ${m.role}${m.compactSummary ? ' compact-summary collapsed' : ''}${continuationCls}`, parent: this.messagesEl });
    wrap.setAttribute('data-message-id', m.id);
    if (m.role === 'assistant' && m.turnId) wrap.setAttribute('data-turn-id', m.turnId);

    const role = el('div', { className: 'nc-msg-role', parent: wrap });
    const ricon = el('span', { className: 'nc-role-icon', parent: role });
    let elapsedEl: HTMLElement | undefined;
    if (m.compactSummary) {
      // Distinct icon + label + interactive collapse/undo controls
      setTrustedSvg(ricon, ICON.folderFile);
      const depthBadge = (m.summaryDepth && m.summaryDepth > 1) ? ` · L${m.summaryDepth}` : '';
      const tag = m.summaryOfCount
        ? `Compacted · ${m.summaryOfCount} msgs · ~${formatTokenCount(m.summaryTokensSaved ?? 0)} tok saved${depthBadge}`
        : 'Compacted summary' + depthBadge;
      el('span', { text: tag, className: 'nc-compact-tag', parent: role });
      // Actions row inside the header
      const acts = el('span', { className: 'nc-compact-actions', parent: role });
      // Expand / collapse toggle
      const toggleBtn = el('button', { className: 'nc-compact-toggle', parent: acts });
      setTrustedSvg(toggleBtn, ICON.chevronDown);
      toggleBtn.title = 'Toggle summary';
      toggleBtn.setAttribute('aria-label', 'Toggle compact summary');
      toggleBtn.setAttribute('aria-expanded', String(!wrap.classList.contains('collapsed')));
      toggleBtn.onclick = (e) => {
        e.stopPropagation();
        wrap.classList.toggle('collapsed');
        toggleBtn.setAttribute('aria-expanded', String(!wrap.classList.contains('collapsed')));
      };
      // Undo button — only present if a snapshot exists for this summary
      const hasSnapshot = (this.session.compactHistory ?? []).some(s => s.summaryId === m.id);
      if (hasSnapshot) {
        const undoBtn = el('button', { className: 'nc-compact-undo', parent: acts, attrs: { title: 'Restore the pre-compact messages' } });
        setTrustedSvg(undoBtn, ICON.undo);
        undoBtn.createEl('span', { text: 'Undo' });
        undoBtn.onclick = (e) => { e.stopPropagation(); void this.undoCompact(m.id); };
      }
      // Whole header row toggles collapse too (but ignore clicks on action buttons)
      role.onclick = (e) => {
        if ((e.target as HTMLElement).closest('.nc-compact-actions')) return;
        wrap.classList.toggle('collapsed');
      };
      makeButtonLike(role, 'Toggle compact summary');
    } else if (m.role === 'user') {
      // No role row for user — the darker bubble bg is the visual marker.
      role.classList.add('hidden-role');
    } else {
      setTrustedSvg(ricon, ICON.bot);
      el('span', { text: 'Glossa', className: 'nc-role-name', parent: role });
      // Live elapsed-time counter — only updates while the message is in the
      // `.streaming` state. Surfaces during the long codex-CLI "Thinking…" wait
      // (xhigh reasoning can take 30–60s before a single token surfaces).
      elapsedEl = el('span', { className: 'nc-msg-elapsed', parent: role, text: '' });
    }

    // DOM order matches the model's thought→speech progression: reasoning FIRST,
    // then prose, then tool actions. Read top-to-bottom = chronologically correct.

    let activityEl: HTMLElement | undefined;
    let activityTimeEl: HTMLElement | undefined;

    // Persistent reasoning card (separate from inline <thinking> blocks). Goes ABOVE
    // the body so reasoning visually precedes the prose it produced.
    let reasoningCard: HTMLElement | undefined;
    let reasoningBody: HTMLElement | undefined;
    if (m.role === 'assistant') {
      reasoningCard = el('details', { className: 'nc-thinking-card nc-reasoning', parent: wrap });
      const sum = el('summary', { className: 'nc-thinking-summary', parent: reasoningCard });
      const lbl = el('span', { parent: sum });
      lbl.textContent = `🧠 Reasoning ${m.reasoningContent ? `(${m.reasoningContent.length.toLocaleString()} chars)` : '(streaming…)'}`;
      reasoningBody = el('div', { className: 'nc-thinking-body', parent: reasoningCard });
      const lazyRender = () => {
        if (!reasoningCard?.hasAttribute('open') || !m.reasoningContent || !reasoningBody) return;
        renderInto(this.app, m.reasoningContent, reasoningBody, this).catch(() => {});
      };
      reasoningCard.addEventListener('toggle', lazyRender);
      if (!m.reasoningContent) setStyle(reasoningCard, { display: 'none' });
    }

    // Inline <thinking>…</thinking> / <reasoning>…</reasoning> blocks extracted
    // from the model's text content are MERGED into the unified reasoning card
    // above (m.reasoningContent), not rendered as a separate card. Previously
    // we showed two distinct "🧠 Reasoning" cards per turn for models that mix
    // both channels — confusing.
    // Prefer the user-facing pretty form (e.g. just "/summarize") over the
     // full expanded template that was actually sent to the model. Falls back
     // to `content` for legacy messages and all assistant messages.
    const bodySrc = m.displayContent ?? m.content ?? '';
    const { visible, thinking } = extractThinking(bodySrc);
    if (thinking && reasoningCard && m.role === 'assistant' && !(m as AnyValue)._mergedInlineThinking) {
      // Append the extracted block to the existing reasoningContent so the
      // single unified card displays everything. Persist on the message so
      // export / replay see the merged form.
      //
      // Guarded by `_mergedInlineThinking` so re-renders (loadSession,
      // compact, history modal) don't append the same block again — without
      // the guard, every reload doubled `reasoningContent` length, which
      // surfaced as ever-growing "Reasoning (N chars)" labels.
      const merged = m.reasoningContent
        ? `${m.reasoningContent}\n\n---\n\n${thinking}`
        : thinking;
      m.reasoningContent = merged;
      (m as AnyValue)._mergedInlineThinking = true;
      // Update the unified card label
      const lbl = reasoningCard.querySelector('.nc-thinking-summary');
      if (lbl) lbl.textContent = `🧠 Reasoning (${merged.length.toLocaleString()} chars)`;
      setStyle(reasoningCard, { display: '' });
    }

    // Main visible content. Use Obsidian MarkdownRenderer directly. A previous
    // HTML-string cache reinserted rendered markup; the community review flags
    // that pattern, so replay now keeps the safer renderer path.
    const body = el('div', { className: 'nc-msg-body', parent: wrap });
    renderInto(this.app, visible, body, this)
      .then(() => {
        if (m.role === 'assistant') decorateCodeBlocks(body, this.codeBlockHandlers());
      })
      .catch(() => {});

    if (m.role === 'user') this.renderContextSnapshot(wrap, m);

    // Selection echo (user-side): show the quoted snippet that went into the prompt.
    if (m.role === 'user' && m.selectionEcho) {
      const echo = el('details', { className: 'nc-selection-echo', parent: wrap });
      const src = this.selectionSourceLabel(m.selectionEcho.source);
      const lines = this.selectionLineCount(m.selectionEcho.text);
      const title = this.selectionTitle(m.selectionEcho.text, src);
      el('summary', {
        className: 'nc-selection-echo-summary',
        text: `📎 ${title} · ${src}${m.selectionEcho.file ? ' · ' + m.selectionEcho.file : ''} (${m.selectionEcho.text.length.toLocaleString()} chars${lines > 1 ? ` · ${lines.toLocaleString()} lines` : ''})`,
        parent: echo,
      });
      const pre = el('pre', { className: 'nc-selection-echo-body', parent: echo });
      let rendered = false;
      const renderEcho = () => {
        if (rendered || !echo.open) return;
        rendered = true;
        pre.textContent = this.compactSelectionEcho(m.selectionEcho.text);
      };
      echo.addEventListener('toggle', renderEcho);
    }

    // Tool event stack (after body — actions follow the explanation that triggered them).
    let toolStack: HTMLElement | undefined;
    if (m.role === 'assistant') {
      toolStack = el('div', { className: 'nc-tool-events-stack', parent: wrap });
      const visibleToolEvents = (m.toolEvents ?? []).filter(shouldRenderToolEvent);
      if (visibleToolEvents.length) {
        for (const ev of visibleToolEvents) this.appendToolCard(toolStack, ev);
        this.updateToolStackCollapse(toolStack);
      }
    }

    // Live activity belongs at the bottom of the current assistant segment.
    // It is the one persistent "still working" signal while text/reasoning/tools
    // are inserted above it.
    if (m.role === 'assistant') {
      activityEl = el('div', { className: 'nc-turn-activity', parent: wrap });
      el('span', { className: 'nc-turn-activity-dot', parent: activityEl });
      el('span', { className: 'nc-turn-activity-text', text: 'Thinking...', parent: activityEl });
      activityTimeEl = el('span', { className: 'nc-turn-activity-time', parent: activityEl });
    }

    const ui: MsgUI = { msg: m, wrap, body, activityEl, elapsedEl, activityTimeEl, toolStack, reasoningCard, reasoningBody };
    this.msgUIs.set(m.id, ui);
    this.registerThreadRailItem(m, ui);

    this.renderMessageActions(wrap, m);
    ui.actionsEl = wrap.querySelector('.nc-msg-actions');

    // History replay: apply preamble style for messages with text+tools loaded from storage.
    if (m.role === 'assistant') this.applyPreambleStyle(ui, m);

    if (!this.messagesEl.classList.contains('no-anim')) this.scrollToBottom();
    return ui;
  }

  private resetThreadRail() {
    if (this.railActiveUpdateRaf) {
      window.cancelAnimationFrame(this.railActiveUpdateRaf);
      this.railActiveUpdateRaf = 0;
    }
    this.railItems = [];
    this.activeRailId = null;
    this.threadRailEl?.empty();
    this.hideThreadRailPreview();
  }

  private registerThreadRailItem(m: ChatMessage, ui: MsgUI) {
    if (!this.threadRailEl) return;
    // The rail is a question navigator, not a full transcript minimap. Keeping
    // only user turns mirrors Codex's "jump back to my prompt" workflow and
    // avoids duplicate/stacked previews from assistant/tool segments.
    if (m.role !== 'user') return;
    const kind: ThreadRailItem['kind'] = 'user';
    const title = this.threadRailTitle(m);
    const snippet = this.threadRailSnippet(m);
    const marker = el('button', {
      className: `nc-thread-rail-marker ${kind}`,
      parent: this.threadRailEl,
      attrs: {
        type: 'button',
      },
    });
    setVars(marker, { ['--rail-i']: String(this.railItems.length) });
    marker.onclick = () => {
      this.hideThreadRailPreview();
      ui.wrap.scrollIntoView({ block: 'start', behavior: 'smooth' });
      this.setActiveRailItem(m.id);
    };
    marker.onmouseenter = () => this.showThreadRailPreview(m.id);
    marker.onmouseleave = () => this.scheduleHideThreadRailPreview();
    marker.onfocus = () => this.showThreadRailPreview(m.id);
    marker.onblur = () => this.scheduleHideThreadRailPreview();
    this.railItems.push({
      id: m.id,
      role: m.role,
      kind,
      title,
      snippet,
      time: m.timestamp,
      messageEl: ui.wrap,
      markerEl: marker,
    });
    this.threadRailEl.classList.toggle('dense', this.railItems.length > 28);
    this.threadRailEl.classList.toggle('very-dense', this.railItems.length > 56);
    this.scheduleThreadRailActiveUpdate();
  }

  private threadRailTitle(m: ChatMessage): string {
    if (m.compactSummary) return 'Compacted summary';
    return this.oneLine(m.displayContent || m.content || bi('User message', '用户消息'), 64);
  }

  private threadRailSnippet(m: ChatMessage): string {
    const context = (m.contextSnapshot ?? []).filter(it => !it.isCurrent).map(it => it.label).slice(0, 3);
    return context.length ? `${bi('Attachments', '附件')}: ${context.join(', ')}` : '';
  }

  private oneLine(text: string, max: number): string {
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    return s.length > max ? `${s.slice(0, Math.max(0, max - 1)).trim()}…` : s;
  }

  private scheduleThreadRailActiveUpdate() {
    if (this.railActiveUpdateRaf) return;
    this.railActiveUpdateRaf = window.requestAnimationFrame(() => {
      this.railActiveUpdateRaf = 0;
      this.updateActiveRailItem();
    });
  }

  private updateActiveRailItem() {
    if (!this.messagesEl || this.railItems.length === 0) return;
    const top = this.messagesEl.getBoundingClientRect().top;
    let best: ThreadRailItem | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const item of this.railItems) {
      if (!item.messageEl.isConnected) continue;
      const rect = item.messageEl.getBoundingClientRect();
      const dist = Math.abs(rect.top - top - 36);
      if (rect.bottom < top + 8) {
        if (!best) best = item;
        continue;
      }
      if (dist < bestDist) {
        best = item;
        bestDist = dist;
      }
      if (rect.top > top + this.messagesEl.clientHeight) break;
    }
    if (best) this.setActiveRailItem(best.id);
  }

  private setActiveRailItem(id: string) {
    if (this.activeRailId === id) return;
    this.activeRailId = id;
    this.updateRailFocus();
  }

  private railPreviewHideTimer = 0;
  private showThreadRailPreview(id: string) {
    const item = this.railItems.find(x => x.id === id);
    if (!item || !this.rootEl) return;
    if (this.railPreviewHideTimer) {
      window.clearTimeout(this.railPreviewHideTimer);
      this.railPreviewHideTimer = 0;
    }
    this.hideThreadRailPreview();
    this.hoverRailId = id;
    this.updateRailFocus();
    const preview = el('div', { className: `nc-thread-preview ${item.kind}`, parent: this.rootEl });
    preview.onmouseenter = () => {
      if (this.railPreviewHideTimer) window.clearTimeout(this.railPreviewHideTimer);
      this.railPreviewHideTimer = 0;
    };
    preview.onmouseleave = () => this.scheduleHideThreadRailPreview();
    const header = el('div', { className: 'nc-thread-preview-head', parent: preview });
    el('span', { className: 'nc-thread-preview-title', text: item.title, parent: header });
    el('span', { className: 'nc-thread-preview-time', text: this.relativePreviewTime(item.time), parent: header });
    if (item.snippet) {
      const body = el('div', { className: 'nc-thread-preview-body', parent: preview });
      body.textContent = item.snippet;
    }
    const railRect = item.markerEl.getBoundingClientRect();
    const rootRect = this.rootEl.getBoundingClientRect();
    const top = Math.max(8, Math.min(rootRect.height - 116, railRect.top - rootRect.top - 28));
    setStyle(preview, { top: `${top}px` });
    this.railPreviewEl = preview;
  }

  private scheduleHideThreadRailPreview() {
    if (this.railPreviewHideTimer) window.clearTimeout(this.railPreviewHideTimer);
    this.railPreviewHideTimer = window.setTimeout(() => this.hideThreadRailPreview(), 120);
  }

  private hideThreadRailPreview() {
    if (this.railPreviewHideTimer) {
      window.clearTimeout(this.railPreviewHideTimer);
      this.railPreviewHideTimer = 0;
    }
    this.railPreviewEl?.remove();
    this.railPreviewEl = null;
    this.hoverRailId = null;
    this.updateRailFocus();
  }

  private updateRailFocus() {
    const hoverIndex = this.hoverRailId ? this.railItems.findIndex(x => x.id === this.hoverRailId) : -1;
    for (let i = 0; i < this.railItems.length; i++) {
      const marker = this.railItems[i].markerEl;
      const distance = hoverIndex >= 0 ? Math.abs(i - hoverIndex) : 99;
      marker.classList.toggle('active', this.activeRailId === this.railItems[i].id);
      marker.classList.toggle('hover-focus', this.hoverRailId === this.railItems[i].id);
      marker.classList.toggle('near-1', distance === 1);
      marker.classList.toggle('near-2', distance === 2);
      marker.classList.toggle('near-3', distance === 3);
      marker.classList.toggle('near-4', distance === 4);
      marker.classList.toggle('near-5', distance === 5);
    }
  }

  private relativePreviewTime(ts: number): string {
    const diff = Date.now() - ts;
    if (diff < 60_000) return bi('now', '刚刚');
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
    return `${Math.floor(diff / 86_400_000)}d`;
  }

  private renderContextSnapshot(parent: HTMLElement, m: ChatMessage) {
    const items = (m.contextSnapshot ?? []).filter(it => !it.isCurrent);
    if (items.length === 0) return;
    const box = el('div', { className: 'nc-message-attachments', parent });
    for (const it of items) {
      const chip = el('span', { className: `nc-message-attachment ${it.kind}`, title: it.detail || it.label, parent: box });
      const icon = el('span', { className: 'nc-message-attachment-icon', parent: chip });
      setTrustedSvg(icon, pillIcon({ kind: it.kind } as ContextItem));
      el('span', { className: 'nc-message-attachment-label', text: it.label, parent: chip });
      el('span', { className: 'nc-message-attachment-meta', text: it.kind === 'image' ? 'IMG' : formatTokenCount(it.tokens), parent: chip });
    }
  }

  private setTurnActivity(ui: MsgUI | null, label: string, status: 'thinking' | 'tool' | 'idle' = 'thinking') {
    if (!ui?.activityEl) return;
    if (status === 'idle') {
      ui.activityEl.classList.remove('active', 'tool', 'thinking');
      ui.activityEl.removeAttribute('data-started-at');
      if (ui.activityTimeEl) ui.activityTimeEl.textContent = '';
      return;
    }
    ui.activityEl.classList.add('active');
    ui.activityEl.classList.toggle('tool', status === 'tool');
    ui.activityEl.classList.toggle('thinking', status === 'thinking');
    if (!ui.activityEl.getAttribute('data-started-at')) {
      ui.activityEl.setAttribute('data-started-at', String(Date.now()));
    }
    const text = ui.activityEl.querySelector('.nc-turn-activity-text');
    if (text) text.textContent = label;
  }

  /* ---------- Plan board (todo_write sticky) ---------- */
  private updatePlanBoard(items: AnyValue[]) {
    this.session.plan = items
      .filter(it => it && typeof it.content === 'string')
      .map(it => ({
        content: String(it.content),
        activeForm: typeof it.activeForm === 'string' ? it.activeForm : undefined,
        status: (['pending','in_progress','completed'].includes(it.status) ? it.status : 'pending') as PlanItem['status'],
      }));
    this.renderPlanBoard();
    // Persist so the plan survives a reload / session switch
    this.persistSession();
  }

  private closeOpenPlanItems(status: 'completed' | 'stopped') {
    const shouldClose = (p: PlanItem) => status === 'completed'
      ? p.status !== 'completed'
      : p.status !== 'completed';
    if (!this.session.plan?.some(shouldClose)) return;
    this.session.plan = this.session.plan.map(p => {
      if (!shouldClose(p)) return p;
      if (status === 'completed') return { ...p, status: 'completed' as const };
      const stopped = /\s\(stopped\)$/.test(p.content) ? p.content : `${p.content} (stopped)`;
      return { ...p, content: stopped, status: 'pending' as const };
    });
    this.renderPlanBoard();
  }

  private renderPlanBoard() {
    if (!this.planBoardEl) return;
    if (this.currentPlan.length === 0) { setStyle(this.planBoardEl, { display: 'none' }); clear(this.planBoardEl); return; }

    const done = this.currentPlan.filter(i => i.status === 'completed').length;
    const total = this.currentPlan.length;
    const allDone = total > 0 && done === total;
    const hasLiveWork = this.streaming && this.currentPlan.some(i =>
      i.status === 'in_progress' ||
      (i.status === 'pending' && !/\s\(stopped\)$/.test(i.content)));
    if (allDone || !hasLiveWork) {
      setStyle(this.planBoardEl, { display: 'none' });
      clear(this.planBoardEl);
      return;
    }

    setStyle(this.planBoardEl, { display: '' });
    clear(this.planBoardEl);
    this.planBoardEl.classList.remove('collapsed');

    const header = el('div', { className: 'nc-plan-header', parent: this.planBoardEl });
    header.setAttribute('aria-expanded', 'true');
    const titleWrap = el('div', { className: 'nc-plan-title-wrap', parent: header });
    const titleIcon = el('span', { className: 'nc-plan-title-icon', parent: titleWrap });
    setTrustedSvg(titleIcon, ICON.check);
    el('span', { className: 'nc-plan-title', text: 'Plan', parent: titleWrap });
    el('span', { className: 'nc-plan-progress', text: `${done} / ${total}`, parent: header });
    const toggle = el('span', { className: 'nc-plan-toggle', text: '▾', parent: header });

    const list = el('div', { className: 'nc-plan-list', parent: this.planBoardEl });
    for (let i = 0; i < this.currentPlan.length; i++) {
      const it = this.currentPlan[i];
      const row = el('div', { className: `nc-plan-item ${it.status}`, parent: list });
      const mark = el('span', { className: 'nc-plan-mark', parent: row });
      mark.textContent = it.status === 'completed' ? '✓'
                       : it.status === 'in_progress' ? '◐'
                       : '○';
      // Show activeForm for the currently-running step; imperative form otherwise.
      const label = it.status === 'in_progress' && it.activeForm ? it.activeForm : it.content;
      el('span', { className: 'nc-plan-text', text: label, parent: row });
    }
    // Click on header collapses the body
    header.onclick = () => {
      const open = !this.planBoardEl.classList.contains('collapsed');
      this.planBoardEl.classList.toggle('collapsed', open);
      toggle.textContent = open ? '▸' : '▾';
      header.setAttribute('aria-expanded', String(!open));
    };
    makeButtonLike(header, 'Toggle plan');
  }

  /** When loading a session from history, recover the latest plan from messages.
   *  Only used as fallback for sessions saved before `session.plan` existed. */
  private rebuildPlanFromSession() {
    if (this.session.plan && this.session.plan.length > 0) { this.renderPlanBoard(); return; }
    let recovered: PlanItem[] = [];
    for (let i = this.session.messages.length - 1; i >= 0; i--) {
      const m = this.session.messages[i];
      for (const ev of m.toolEvents ?? []) {
        if (ev.name === 'todo_write' && Array.isArray(ev.args?.items)) {
          recovered = ev.args.items.map((it: AnyValue) => ({
            content: String(it?.content ?? ''),
            activeForm: typeof it?.activeForm === 'string' ? it.activeForm : undefined,
            status: (['pending','in_progress','completed'].includes(it?.status) ? it.status : 'pending') as PlanItem['status'],
          }));
          break;
        }
      }
      if (recovered.length > 0) break;
    }
    if (recovered.length > 0) this.session.plan = recovered;
    this.renderPlanBoard();
  }

  /* ---------- Tool event cards ---------- */
  private appendToolCard(stack: HTMLElement, ev: ToolEvent): HTMLElement {
    const attrs: Record<string, string> = { 'data-tool-id': ev.id, 'data-started-at': String(ev.startedAt) };
    if (ev.endedAt) attrs['data-ended-at'] = String(ev.endedAt);
    const box = el('div', {
      className: `nc-tool-event ${ev.status}` + (ev.status === 'success' ? ' collapsed' : ''),
      parent: stack,
      attrs,
    });
    this.renderToolCard(box, ev);
    return box;
  }

  private renderToolCard(box: HTMLElement, ev: ToolEvent) {
    clear(box);
    box.classList.remove('pending', 'running', 'success', 'error', 'denied');
    box.classList.add(ev.status);
    const meta = metaFor(ev.name);
    setVars(box, { ['--tool-color']: meta.color });

    const hdr = el('div', { className: 'nc-tool-event-header', parent: box });
    hdr.setAttribute('aria-expanded', String(!box.classList.contains('collapsed')));

    // Icon
    const icon = el('span', { className: 'nc-tool-icon', parent: hdr });
    setTrustedSvg(icon, meta.icon);

    // Header text — prefer the tool's own renderer for custom-formatted
    // headers (e.g. a tool that wants to colorize args or show a badge).
    // Falls back to the default verb+summary split layout when the tool
    // didn't register a renderer.
    const isRunning = ev.status === 'running' || ev.status === 'pending';
    const custom = isRunning ? null : toolUseMessage(ev.name, ev.args);
    const summary = meta.summarize ? meta.summarize(ev.args) : '';
    if (isHTMLElementNode(custom)) {
      // Tool returned a DOM node — attach as a single header chunk.
      custom.classList.add('nc-tool-event-name');
      hdr.appendChild(custom);
    } else {
      // Default 2-span layout: short action name + target summary. Long paths
      // stay in the secondary span so status rows keep a stable rhythm.
      const verbOrLabel = isRunning ? meta.verb : meta.label;
      el('span', { className: 'nc-tool-event-name', text: verbOrLabel, parent: hdr });
      if (summary) el('span', { className: 'nc-tool-event-args', text: summary, title: summary, parent: hdr });
    }

    // Elapsed time
    const elapsed = ev.endedAt ? ev.endedAt - ev.startedAt : Date.now() - ev.startedAt;
    const elapsedEl = el('span', { className: 'nc-tool-event-elapsed', text: formatElapsed(elapsed), parent: hdr });

    // Status pill
    const statusText = ev.status === 'success' ? '✓' : ev.status === 'error' ? '✕' : ev.status === 'denied' ? '−' : '·';
    const statusEl = el('span', { className: `nc-tool-event-status ${ev.status}`, text: statusText, parent: hdr });
    (box as AnyValue)._elapsedEl = elapsedEl;
    (box as AnyValue)._statusEl = statusEl;

    // Chevron
    const chev = el('span', { className: 'nc-tool-event-chev', parent: hdr });
    setTrustedSvg(chev, ICON.arrowRight);

    const body = el('div', { className: 'nc-tool-event-body', parent: box });
    const argsDetails = el('details', { parent: body });
    el('summary', { text: 'args', parent: argsDetails });
    el('pre', { text: JSON.stringify(ev.args ?? {}, null, 2), parent: argsDetails });

    // Result / error / denied — each branch consults the tool's own renderer
    // first, then falls back to a default `<pre>` block. Custom renderers
    // return either an HTMLElement (mounted directly) or a string (wrapped
    // in <pre>).
    const attachCustom = (parent: HTMLElement, node: HTMLElement | string | null): boolean => {
      if (node == null) return false;
      if (isHTMLElementNode(node)) { parent.appendChild(node); return true; }
      if (typeof node === 'string' && node.length > 0) {
        el('pre', { text: node, parent });
        return true;
      }
      return false;
    };

    if (ev.status === 'denied') {
      const denDetails = el('details', { parent: body, attrs: { open: 'true' } });
      el('summary', { text: 'denied', parent: denDetails });
      const customDen = toolRejectedMessage(ev.name, ev.args);
      if (!attachCustom(denDetails, customDen)) {
        el('pre', { text: String(ev.result ?? 'User denied this action.'), parent: denDetails });
      }
    } else if (ev.status === 'error') {
      const errDetails = el('details', { parent: body, attrs: { open: 'true' } });
      el('summary', { text: 'error', parent: errDetails });
      const customErr = toolErrorMessage(ev.name, String(ev.result ?? ''), ev.args);
      if (!attachCustom(errDetails, customErr)) {
        el('pre', { text: String(ev.result ?? '(no error message)').slice(0, 4000), parent: errDetails });
      }
    } else if (ev.result != null) {
      const resDetails = el('details', { parent: body, attrs: { open: 'true' } });
      el('summary', { text: 'result', parent: resDetails });
      const customRes = toolResultMessage(ev.name, String(ev.result), ev.args);
      if (!attachCustom(resDetails, customRes)) {
        el('pre', { text: String(ev.result).slice(0, 4000), parent: resDetails });
      }
    }
    hdr.onclick = (e) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'PRE' || t.tagName === 'SUMMARY' || t.tagName === 'DETAILS') return;
      box.classList.toggle('collapsed');
      hdr.setAttribute('aria-expanded', String(!box.classList.contains('collapsed')));
    };
    makeButtonLike(hdr, `Toggle ${meta.label} details`);
  }

  private upsertToolEvent(ui: MsgUI, ev: ToolEvent) {
    if (!shouldRenderToolEvent(ev)) {
      ui.toolStack?.querySelector(`[data-tool-id="${ev.id}"]`)?.remove();
      if (ui.toolStack) this.updateToolStackCollapse(ui.toolStack);
      this.scrollToBottom();
      return;
    }
    if (!ui.toolStack) ui.toolStack = el('div', { className: 'nc-tool-events-stack', parent: ui.wrap });
    const existingCard = ui.toolStack.querySelector(`[data-tool-id="${ev.id}"]`);
    const card = isHTMLElementNode(existingCard) ? existingCard : null;
    if (!card) {
      this.appendToolCard(ui.toolStack, ev);
    } else {
      this.renderToolCard(card, ev);
      card.classList.toggle('collapsed', ev.status === 'success');
      if (ev.endedAt) (card).dataset.endedAt = String(ev.endedAt);
    }
    this.updateToolStackCollapse(ui.toolStack);
    this.scrollToBottom();
  }

  /** When a stack has 5+ cards AND every one is success (no error/denied/running),
   *  auto-collapse to a single "⚙ Ran N tools · Xs · all ✓" summary line. Below
   *  the threshold, just show the cards. Any pending/failed state keeps the
   *  stack fully expanded — those need to stay visible.
   *
   *  Clicking the summary toggles expansion. */
  private updateToolStackCollapse(stack: HTMLElement) {
    // Aurora v0.4: threshold lowered from 5 to 3 so most multi-tool turns
    // present as a single ribbon by default. 1-2 cards still expand inline
    // (a "🔧 2 actions ▾" ribbon for two would feel like over-collapsing).
    const AUTO_COLLAPSE = 3;
    const cards = Array.from(stack.querySelectorAll(':scope > [data-tool-id]'))
      .filter(isHTMLElementNode);
    stack.querySelector(':scope > .nc-tool-stack-summary')?.remove();
    stack.querySelector(':scope > .nc-tool-stack-more')?.remove();

    const allDone = cards.every(c => {
      const s = c.querySelector('.nc-tool-event-status');
      return s && (s.classList.contains('success'));
    });
    const hasFailure = cards.some(c => c.querySelector('.nc-tool-event-status.error, .nc-tool-event-status.denied'));
    const shouldCollapse = cards.length >= AUTO_COLLAPSE && allDone && !stack.classList.contains('expanded');

    if (!shouldCollapse) {
      stack.classList.remove('truncated');
      for (const c of cards) c.classList.remove('hidden');
      if (cards.length >= AUTO_COLLAPSE && allDone) {
        // Currently expanded — offer a collapse pill back to the summary.
        const collapse = el('button', { className: 'nc-tool-stack-more nc-tool-stack-collapse', parent: stack });
        collapse.type = 'button';
        el('span', { className: 'nc-tool-stack-more-label', text: `Collapse · ${cards.length} tools`, parent: collapse });
        collapse.onclick = () => { stack.classList.remove('expanded'); this.updateToolStackCollapse(stack); };
      }
      return;
    }

    // Collapsed state: hide all tool cards, show summary line.
    for (const c of cards) c.classList.add('hidden');
    stack.classList.add('truncated');
    let totalMs = 0;
    for (const c of cards) {
      const started = parseInt((c).dataset.startedAt ?? '0');
      const ended = parseInt((c).dataset.endedAt ?? `${Date.now()}`);
      if (started && ended >= started) totalMs += ended - started;
    }
    const dur = totalMs < 1000 ? `${totalMs}ms` : `${(totalMs / 1000).toFixed(1)}s`;
    const summary = el('button', { className: 'nc-tool-stack-summary', parent: stack });
    summary.type = 'button';
    summary.setAttribute('aria-expanded', 'false');
    el('span', { className: 'nc-tool-stack-summary-icon', text: '⚙', parent: summary });
    summary.appendText(` Ran ${cards.length} tools · ${dur} · `);
    el('span', { className: 'nc-tool-stack-summary-ok', text: 'all ✓', parent: summary });
    summary.appendText(' ');
    el('span', { className: 'nc-tool-stack-summary-chev', text: '▸', parent: summary });
    summary.onclick = () => { summary.setAttribute('aria-expanded', 'true'); stack.classList.add('expanded'); this.updateToolStackCollapse(stack); };
    if (hasFailure) {
      const okLabel = summary.querySelector('.nc-tool-stack-summary-ok');
      if (okLabel) okLabel.textContent = 'Some failed';
    }
  }

  private compactProcessForTurn(turnId: string | undefined) {
    if (!turnId) return;
    const uis = this.session.messages
      .filter(m => m.role === 'assistant' && m.turnId === turnId)
      .map(m => this.msgUIs.get(m.id))
      .filter((ui): ui is MsgUI => !!ui);
    const processUis = uis.filter(ui => {
      const hasProcessTools = (ui.msg.toolEvents ?? []).some(shouldRenderToolEvent);
      const hasReasoning = !!ui.msg.reasoningContent?.trim();
      const hasBodyText = !!ui.msg.content?.trim();
      return hasProcessTools || (hasReasoning && !hasBodyText);
    });
    if (processUis.length < 2) return;

    const first = processUis[0];
    // Collapsed process rows are the visible start of this assistant turn, so
    // they must keep the Glossa role even if the first segment was a preamble
    // or continuation whose role is normally hidden.
    first.wrap.classList.add('nc-process-has-role');
    first.wrap.querySelector(':scope > .nc-process-summary')?.remove();
    for (const ui of processUis) {
      ui.wrap.classList.remove('nc-process-folded-away', 'nc-process-anchor', 'nc-process-expanded');
    }

    const reasoningCount = processUis.filter(ui => ui.msg.reasoningContent?.trim()).length;
    const toolCount = processUis.reduce((n, ui) => n + (ui.msg.toolEvents ?? []).filter(shouldRenderToolEvent).length, 0);
    const summary = el('button', { className: 'nc-process-summary' });
    summary.type = 'button';
    const roleRow = first.wrap.querySelector(':scope > .nc-msg-role');
    first.wrap.insertBefore(summary, roleRow?.nextSibling ?? first.wrap.firstChild);
    const label = `Run · ${reasoningCount} reasoning · ${toolCount} action${toolCount === 1 ? '' : 's'}`;
    el('span', { className: 'nc-process-dot', parent: summary });
    el('span', { text: label, parent: summary });
    el('span', { className: 'nc-process-chev', text: '▸', parent: summary });

    const setExpanded = (expanded: boolean) => {
      summary.classList.toggle('expanded', expanded);
      summary.setAttribute('aria-expanded', String(expanded));
      const chev = summary.querySelector('.nc-process-chev');
      if (chev) chev.textContent = expanded ? '▾' : '▸';
      for (let i = 0; i < processUis.length; i++) {
        const ui = processUis[i];
        ui.wrap.classList.toggle('nc-process-expanded', expanded);
        ui.wrap.classList.toggle('nc-process-anchor', !expanded && i === 0);
        ui.wrap.classList.toggle('nc-process-folded-away', !expanded && i > 0);
      }
    };
    summary.onclick = () => setExpanded(!summary.classList.contains('expanded'));
    setExpanded(false);
  }

  private compactAllProcessGroups() {
    const seen = new Set<string>();
    for (const m of this.session.messages) {
      if (m.role === 'assistant' && m.turnId && !seen.has(m.turnId)) {
        seen.add(m.turnId);
        this.compactProcessForTurn(m.turnId);
      }
    }
  }

  private renderMessageActions(wrap: HTMLElement, m: ChatMessage) {
    // Footer row: timestamp on the left + small action icons on the right,
    // ALWAYS visible (no hover gating). Mirrors the iMessage / Slack pattern.
    const footer = el('div', { className: 'nc-msg-footer', parent: wrap });
    const ts = el('span', { className: 'nc-msg-time', parent: footer });
    ts.textContent = this.formatMessageTime(m.timestamp);
    const actions = el('div', { className: 'nc-msg-actions', parent: footer });
    const mkBtn = (icon: string, label: string, onClick: () => void) => {
      const b = el('button', { parent: actions, title: label, className: 'nc-icon-action' });
      setTrustedSvg(b, icon);
      b.onclick = onClick;
      return b;
    };
    if (m.role === 'assistant') {
      mkBtn(ICON.refresh, t('regenerate'), () => { void this.regenerateLast(); });
      // Insert / Apply require an active markdown editor and many users never
      // use them — hidden in 0.3 to declutter the footer. They live in the
      // command palette (Glossa: Edit selection with AI…) if needed.
      mkBtn(ICON.file, t('save_as_note'), () => { void this.saveResponseAsNote(m); });
      mkBtn(ICON.history, t('fork_from'), () => this.forkFromMessage(m));
      void this.plugin.checkpoint.listForSession(this.session.id).then(list => {
        const cp = list.find(c => c.turnId === m.id && c.snapshots.length > 0);
        if (cp) {
          mkBtn(ICON.refresh, 'Rollback file edits made in this turn', () => {
            void (async () => {
            const paths = cp.snapshots.map(s => s.path).join('\n  • ');
            const { confirmModal } = await import('./confirm_modal');
            const ok = await confirmModal(this.app, {
              title: 'Rollback file edits',
              body: `Rollback will overwrite ${cp.snapshots.length} file(s):\n  • ${paths}\n\nContinue?`,
              confirmText: 'Rollback',
              danger: true,
            });
            if (!ok) return;
            const { restored, failed } = await this.plugin.checkpoint.rollback(this.session.id, m.id);
            quickNotice(`Rolled back ${restored} file(s)${failed.length ? `, ${failed.length} failed` : ''}.`);
            })();
          });
        }
      });
    }
  }

  private formatMessageTime(ts: number): string {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  private forkFromMessage(m: ChatMessage) {
    const idx = this.session.messages.findIndex(x => x.id === m.id);
    if (idx < 0) return;
    const kept = this.session.messages.slice(0, idx + 1);
    const forked: ChatSession = {
      id: uid(),
      title: `Fork of ${this.session.title || 'chat'}`,
      createdAt: Date.now(), updatedAt: Date.now(),
      mode: this.session.mode,
      endpointId: this.session.endpointId,
      messages: JSON.parse(JSON.stringify(kept)),
    };
    this.persistSession();
    void this.plugin.store.saveSession(forked);
    void this.loadSession(forked.id);
    quickNotice(`Forked: ${forked.title}`);
  }


  private codeBlockHandlers() {
    return {
      copy: (_s: string) => { void _s; quickNotice('Copy is disabled in the community review build.'); },
      insert: (s: string) => this.insertAtCursor(s),
      apply: (s: string) => this.applyEdit(s),
    };
  }

  private isMessagesNearBottom(thresholdPx = 40) {
    const msgsEl = this.messagesEl;
    const distanceFromBottom = msgsEl.scrollHeight - (msgsEl.scrollTop + msgsEl.clientHeight);
    return distanceFromBottom <= thresholdPx;
  }

  private scrollToBottom(force = false) {
    // Auto-follow is stateful: once the user scrolls away from the bottom, new
    // streamed text must not yank the viewport down. Checking only after DOM
    // growth is unreliable because the added content itself increases
    // scrollHeight; `stickToBottom` preserves the user's pre-growth intent.
    if (!force && !this.stickToBottom && !this.isMessagesNearBottom()) return;
    const msgsEl = this.messagesEl;
    msgsEl.scrollTop = msgsEl.scrollHeight;
    this.stickToBottom = true;
  }

  /* ============================================================
     Streaming render — Obsidian MarkdownRenderer everywhere.
     Throttle 100ms; serialize concurrent renders; re-fire if buffer changed during render.
     ============================================================ */
  private streamRenderTimer: AnyValue;
  private streamRenderInFlight = false;
  private scheduleStreamingRender() {
    if (this.streamRenderTimer || this.streamRenderInFlight || !this.streamingMsgUI) return;
    this.streamRenderTimer = window.setTimeout(() => {
      this.streamRenderTimer = null;
      void this.doStreamingRender();
    }, 150);     // 150ms to reduce math flicker
  }
  /** Incremental render strategy: split the buffer at \n\n boundaries; render
   *  the COMPLETED paragraphs once and append them, then re-render only the
   *  trailing incomplete paragraph each tick. This avoids reparsing the whole
   *  message (and re-typesetting all math) on every 150ms streaming tick.
   *
   *  Tracking state lives on streamingMsgUI: `committedParas` counts paragraphs
   *  already appended (immutable); `tailEl` holds the in-progress last
   *  paragraph that gets re-rendered. */
  private async doStreamingRender() {
    if (this.streamRenderInFlight || !this.streamingMsgUI) return;
    this.streamRenderInFlight = true;
    const snapshot = this.streamingBuf;
    try {
      const safe = trimIncompleteMath(snapshot);
      const ui = this.streamingMsgUI as MsgUI & { _committedParas?: number; _tailEl?: HTMLElement; _tailRaw?: string; _tailPlain?: string };
      const paras = safe.split('\n\n');
      const committed = ui._committedParas ?? 0;
      // Stable paragraphs: everything except the last one (which is still
      // growing). Append any new ones (paras.length - 1 > committed).
      if (paras.length - 1 > committed) {
        for (let i = committed; i < paras.length - 1; i++) {
          const wrap = activeDocument.createElement('div');
          wrap.className = 'nc-stream-para';
          // Insert BEFORE the tail element so paragraph order is correct.
          if (ui._tailEl?.isConnected) ui.body.insertBefore(wrap, ui._tailEl);
          else ui.body.appendChild(wrap);
          await renderInto(this.app, paras[i], wrap, this);
        }
        ui._committedParas = paras.length - 1;
      }
      // Render the trailing (incomplete) paragraph — reuses tailEl so we don't
      // accumulate orphan nodes.
      if (!ui._tailEl || !ui._tailEl.isConnected) {
        ui._tailEl = activeDocument.createElement('div');
        ui._tailEl.className = 'nc-stream-para nc-stream-tail';
        ui.body.appendChild(ui._tailEl);
      }
      const tailText = paras[paras.length - 1] ?? '';
      // Fast-path: if the trailing paragraph has NO markdown syntax that
      // would need a real parse (no math `$`, no code fences/backticks, no
      // wikilinks/embeds, no callouts, no list/heading prefix), skip the
      // markdown renderer + MathJax typeset and just set textContent. For
      // pure-prose streaming (the common case during a long answer) this
      // turns each tick from ~10-30ms into <1ms.
      const hasMarkdown = /[`$]|^\s*[#>\-*\d]|\[\[/m.test(tailText)
        || tailText.includes('\\(')
        || tailText.includes('\\[');
      if (!hasMarkdown) {
        if (ui._tailPlain !== tailText) {
          ui._tailEl.textContent = tailText;
          ui._tailPlain = tailText;
          ui._tailRaw = tailText;
        }
      } else {
        if (ui._tailRaw !== tailText) {
          await renderInto(this.app, tailText, ui._tailEl, this);
          ui._tailRaw = tailText;
          ui._tailPlain = undefined;
        }
      }
    } catch (e) { /* ignore */ }
    this.streamRenderInFlight = false;
    this.scrollToBottom();
    if (this.streamingMsgUI && this.streamingBuf !== snapshot) this.scheduleStreamingRender();
  }

  /** Finalize the current streaming assistant message and immediately start
   *  a fresh one. Called from `onText` when a tool ran in this same step and
   *  text resumes — codex emits multiple agent_messages per turn interspersed
   *  with tool calls, and we render each as its own bubble for readability. */
  private flushAndStartNewAsstSegment() {
    if (this.currentAsstMsg && this.streamingMsgUI) {
      this.currentAsstMsg.content = this.streamingBuf;
      this.streamingMsgUI.wrap.classList.remove('streaming');
      this.setTurnActivity(this.streamingMsgUI, '', 'idle');
      this.finalizeReasoningLabel(this.streamingMsgUI, this.currentAsstMsg);
      // Synchronously apply preamble/has-tools styling — fire-and-forget the
      // markdown re-render so we don't block the new text from showing.
      this.finalizeAsstRender(this.streamingMsgUI, this.currentAsstMsg).catch(() => {});
    }
    this.currentAsstMsg = { id: uid(), role: 'assistant', content: '', timestamp: Date.now(), toolEvents: [], turnId: this.currentTurnId ?? undefined };
    this.session.messages.push(this.currentAsstMsg);
    this.streamingBuf = '';
    this.streamingMsgUI = this.renderMessage(this.currentAsstMsg);
    this.streamingMsgUI.wrap.classList.add('streaming');
    this.currentActivityStartedAt = Date.now();
    this.setTurnActivity(this.streamingMsgUI, 'Thinking...', 'thinking');
    this.streamingStartedAt = Date.now();    // per-segment timer
  }

  /* ============================================================
     Inline approval — replaces the modal popup
     ============================================================ */
  private askInlineApproval(tool: ToolImpl, args: AnyValue): Promise<ApprovalResult> {
    return new Promise(resolve => {
      void (async () => {
      const host = this.streamingMsgUI?.wrap ?? this.messagesEl;
      const wrap = el('div', { className: 'nc-inline-approval', parent: host });
      const hdr = el('div', { className: 'nc-inline-approval-hdr', parent: wrap });
      const ic = el('span', { className: 'nc-inline-approval-icon', parent: hdr });
      setTrustedSvg(ic, metaFor(tool.spec.name).icon);
      // Header text — let the tool override via `renderToolUseMessage`; fall
      // back to `<verb> — <describe>` to keep parity with prior behavior.
      const customHdr = toolUseMessage(tool.spec.name, args);
      if (isHTMLElementNode(customHdr)) {
        customHdr.classList.add('nc-inline-approval-title');
        hdr.appendChild(customHdr);
      } else {
        const headerText = typeof customHdr === 'string' && customHdr.length > 0
          ? `${customHdr} — ${tool.describe(args) ?? tool.spec.name}`
          : `${metaFor(tool.spec.name).verb} — ${tool.describe(args) ?? tool.spec.name}`;
        el('span', { className: 'nc-inline-approval-title', text: headerText, parent: hdr });
      }

      // Compact diff preview for known write tools (collapsed by default)
      try {
        const name = tool.spec.name;

        // apply_patch + envelope → multi-file colored preview
        if (name === 'apply_patch' && typeof args.patch === 'string' && (await import('../agent/patch_envelope')).looksLikeEnvelope(args.patch)) {
          const { previewEnvelope } = await import('../agent/patch_envelope');
          const { files, parseError } = await previewEnvelope(args.patch, async (p) => {
            const f = this.app.vault.getAbstractFileByPath(p);
            return f && 'extension' in (f as AnyValue) ? await this.app.vault.read(f as AnyValue) : null;
          });
          if (parseError) {
            el('div', { className: 'nc-inline-approval-warning', text: `Parse error: ${parseError}`, parent: wrap });
          } else {
            const det = el('details', { parent: wrap });
            el('summary', { className: 'nc-inline-approval-diff-summary', text: `Show diff (${files.length} file${files.length === 1 ? '' : 's'})`, parent: det });
            for (const fp of files) {
              const sec = el('div', { className: 'nc-inline-file-section', parent: det });
              const head = el('div', { className: 'nc-inline-approval-file', parent: sec });
              el('span', { className: `nc-approval-op-pill ${fp.kind}`, text: fp.kind, parent: head });
              const label = fp.movePath && fp.movePath !== fp.path ? `${fp.path} → ${fp.movePath}` : fp.path;
              el('span', { text: label, parent: head });
              if (fp.warning) el('div', { className: 'nc-inline-approval-warning', text: '⚠ ' + fp.warning, parent: sec });
              if (fp.kind === 'delete') {
                el('div', { className: 'nc-diff-line del', text: `(file will be deleted)`, parent: sec });
              } else if (fp.oldText !== (fp.newText ?? '')) {
                const box = el('div', { className: 'nc-diff-box nc-inline-diff-box', parent: sec });
                renderDiffInto(box, fp.oldText, fp.newText ?? '');
              } else {
                el('div', { className: 'nc-diff-line eq', text: '(no changes)', parent: sec });
              }
            }
          }
        } else {
          // Legacy / single-file path
          let oldText = '', newText = '', label = '';
          if (name === 'file_edit') {
            label = args.file_path ?? '';
            if (args.old_string === '') {
              oldText = ''; newText = args.new_string ?? '';
            } else {
              const f = this.app.vault.getAbstractFileByPath(args.file_path);
              if (f && 'extension' in (f as AnyValue)) {
                try { oldText = await this.app.vault.read(f as AnyValue); } catch { /* ignore */ }
              }
              if (typeof args.old_string === 'string' && oldText.includes(args.old_string)) {
                newText = args.replace_all
                  ? oldText.split(args.old_string).join(args.new_string ?? '')
                  : oldText.replace(args.old_string, args.new_string ?? '');
              } else {
                newText = oldText;
              }
            }
          } else if (name === 'write_note' || name === 'create_note' || name === 'edit_section' || name === 'apply_patch' || name === 'append_to_note') {
            label = args.path ?? '';
            const f = this.app.vault.getAbstractFileByPath(args.path);
            if (f && 'extension' in (f as AnyValue)) {
              try { oldText = await this.app.vault.read(f as AnyValue); } catch { /* ignore */ }
            }
            if (name === 'write_note' || name === 'create_note') newText = args.content ?? '';
            else if (name === 'edit_section' && typeof args.find === 'string' && args.find && oldText.includes(args.find)) newText = oldText.replace(args.find, args.replace ?? '');
            else if (name === 'append_to_note') newText = oldText + (oldText.endsWith('\n') ? '' : '\n') + (args.text ?? '');
            else if (name === 'apply_patch' && Array.isArray(args.edits)) {
              let cur = oldText;
              for (const ed of args.edits) if (typeof ed?.search === 'string' && cur.includes(ed.search)) cur = cur.replace(ed.search, ed.replace ?? '');
              newText = cur;
            }
          }
          if (label) el('div', { className: 'nc-inline-approval-file', text: label, parent: wrap });
          if (oldText !== newText) {
            const det = el('details', { parent: wrap });
            el('summary', { className: 'nc-inline-approval-diff-summary', text: 'Show diff', parent: det });
            const box = el('div', { className: 'nc-diff-box nc-inline-diff-box', parent: det });
            renderDiffInto(box, oldText, newText);
          }
        }
      } catch { /* ignore */ }

      /* --- "Always allow" rule selector --- */
      // Show only when the tool has a path-ish arg (so folder/path scopes make sense)
      const path = (args?.path ?? args?.file_path ?? args?.target_path ?? args?.to ?? args?.from ?? args?.base_path ?? args?.template_path) as string | undefined;
      const folder = path ? path.split('/').slice(0, -1).join('/') : undefined;
      type RuleChoice = 'once' | 'session-tool' | 'always-tool' | 'always-folder' | 'always-path' | 'always-mcp-server';
      let ruleChoice: RuleChoice = 'once';
      const ruleRow = el('div', { className: 'nc-inline-rule-row', parent: wrap });
      el('span', { text: 'Persist:', className: 'nc-inline-rule-label', parent: ruleRow });
      const opts: { value: RuleChoice; label: string }[] = [
        { value: 'once', label: 'Just this once' },
        { value: 'session-tool', label: `Allow ${tool.spec.name} this session` },
        { value: 'always-tool', label: `Always allow ${tool.spec.name}` },
      ];
      if (folder) opts.push({ value: 'always-folder', label: `…in /${folder}` });
      if (path)   opts.push({ value: 'always-path',   label: `…for ${path.split('/').slice(-1)[0]}` });
      // MCP namespaced tool: "<server>__<tool>" → offer server-level allow
      const mcpServer = tool.spec.name.includes('__') ? tool.spec.name.split('__')[0] : null;
      if (mcpServer) opts.push({ value: 'always-mcp-server', label: `Always allow MCP server "${mcpServer}"` });
      const sel = el('select', { className: 'nc-inline-rule-select', parent: ruleRow });
      for (const o of opts) {
        const optEl = activeDocument.createElement('option');
        optEl.value = o.value; optEl.textContent = o.label;
        sel.appendChild(optEl);
      }
      sel.onchange = () => { ruleChoice = sel.value as RuleChoice; };

      const acts = el('div', { className: 'nc-inline-approval-actions', parent: wrap });
      // Hint row: discreet keyboard shortcuts to the left of the buttons so the
      // user knows Enter/Esc/A work without having to hover for tooltips.
      const hints = el('span', { className: 'nc-inline-approval-hints', parent: acts });
      hints.createEl('kbd', { text: '↵' });
      hints.appendText(' approve · ');
      hints.createEl('kbd', { text: 'Esc' });
      hints.appendText(' deny · ');
      hints.createEl('kbd', { text: 'A' });
      hints.appendText(' always');
      const deny = el('button', { className: 'nc-inline-deny', parent: acts, title: 'Deny (Esc)' });
      deny.textContent = 'Deny';
      const approve = el('button', { className: 'nc-inline-approve', parent: acts, title: 'Approve (Enter)' });
      approve.textContent = 'Approve';

      const buildRule = (): import('../types').PermissionRule | undefined => {
        if (ruleChoice === 'once') return undefined;
        const base = { addedAt: Date.now(), behavior: 'allow' as const };
        if (ruleChoice === 'session-tool')      return { ...base, tool: tool.spec.name, scope: 'global', scopedToSessionId: this.session.id };
        if (ruleChoice === 'always-tool')       return { ...base, tool: tool.spec.name, scope: 'global' };
        if (ruleChoice === 'always-folder' && folder !== undefined)
                                                 return { ...base, tool: tool.spec.name, scope: 'folder', value: folder };
        if (ruleChoice === 'always-path' && path) return { ...base, tool: tool.spec.name, scope: 'path', value: path };
        if (ruleChoice === 'always-mcp-server' && mcpServer)
                                                 return { ...base, tool: `mcp:${mcpServer}:*`, scope: 'global' };
        return undefined;
      };
      const finish = (ok: boolean) => {
        wrap.remove();
        if (!ok) return resolve({ ok });
        resolve({ ok, persistRule: buildRule() });
      };
      deny.onclick = () => finish(false);
      approve.onclick = () => finish(true);
      this.scrollToBottom();

      const keyH = (e: KeyboardEvent) => {
        if (!wrap.isConnected) { activeDocument.removeEventListener('keydown', keyH, true); return; }
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); activeDocument.removeEventListener('keydown', keyH, true); finish(true); }
        else if (e.key === 'Escape') { e.preventDefault(); activeDocument.removeEventListener('keydown', keyH, true); finish(false); }
        // 'a' (always-allow this tool globally) — only when focus isn't inside an input.
        else if ((e.key === 'a' || e.key === 'A') && !(activeDocument.activeElement?.instanceOf(HTMLInputElement) || activeDocument.activeElement?.instanceOf(HTMLTextAreaElement))) {
          e.preventDefault();
          ruleChoice = 'always-tool';
          activeDocument.removeEventListener('keydown', keyH, true);
          finish(true);
        }
      };
      activeDocument.addEventListener('keydown', keyH, true);
      })().catch((err: unknown) => {
        console.warn('[Glossa] inline approval failed', err);
        resolve({ ok: false });
      });
    });
  }

  private reasoningRenderTimer: AnyValue;
  private scheduleReasoningRender() {
    if (this.reasoningRenderTimer || !this.streamingMsgUI?.reasoningCard) return;
    this.reasoningRenderTimer = window.setTimeout(() => {
      void (async () => {
      this.reasoningRenderTimer = null;
      const ui = this.streamingMsgUI;
      const content = this.currentAsstMsg?.reasoningContent ?? '';
      if (!ui?.reasoningCard || !ui.reasoningBody) return;
      setStyle(ui.reasoningCard, { display: '' });
      // Stay COLLAPSED — user clicks to peek. Only update the summary label.
      const sum = ui.reasoningCard.querySelector('.nc-thinking-summary span');
      if (sum) sum.textContent = `🧠 Reasoning (${content.length.toLocaleString()} chars${this.streaming ? ' · streaming' : ''})`;
      // Only render the body content if the user has actually opened it.
      if (ui.reasoningCard.hasAttribute('open')) {
        try { await renderInto(this.app, content, ui.reasoningBody, this); } catch { /* ignore */ }
      }
      })();
    }, 300);
  }

  private elapsedTimer: AnyValue;
  private startElapsedTicker() {
    if (this.elapsedTimer) return;
    this.elapsedTimer = window.setInterval(() => this.tickElapsed(), 250);
  }
  private stopElapsedTicker() {
    if (this.elapsedTimer) { window.clearInterval(this.elapsedTimer); this.elapsedTimer = null; }
  }
  private tickElapsed() {
    // Update the per-message elapsed counter on the role label.
    if (this.streamingMsgUI && this.streamingStartedAt > 0) {
      const elapsed = (Date.now() - this.streamingStartedAt) / 1000;
      const elEl = this.streamingMsgUI.elapsedEl;
      if (elEl) {
        if (elapsed < 1.0) elEl.textContent = '';
        else if (elapsed < 60) elEl.textContent = `${elapsed.toFixed(1)}s`;
        else elEl.textContent = `${Math.floor(elapsed / 60)}m${(elapsed % 60).toFixed(0).padStart(2, '0')}s`;
      }
    }
    const activity = this.streamingMsgUI?.activityEl;
    if (activity?.classList.contains('active')) {
      const time = this.streamingMsgUI?.activityTimeEl;
      const started = parseInt(activity.getAttribute('data-started-at') || String(this.currentActivityStartedAt || Date.now()));
      if (time && started) time.textContent = formatElapsed(Date.now() - started);
    }
    if (!this.streamingMsgUI?.toolStack) return;
    const now = Date.now();
    for (const card of Array.from(this.streamingMsgUI.toolStack.children) as HTMLElement[]) {
      if (!card.classList.contains('nc-tool-event')) continue;
      const statusEl = (card as AnyValue)._statusEl as HTMLElement | undefined;
      if (!statusEl) continue;
      const isActive = statusEl.classList.contains('running') || statusEl.classList.contains('pending');
      if (!isActive) continue;
      const elapsedEl = (card as AnyValue)._elapsedEl as HTMLElement | undefined;
      const startedAttr = card.dataset.startedAt;
      if (elapsedEl && startedAttr) {
        elapsedEl.textContent = formatElapsed(now - parseInt(startedAttr));
      }
    }
  }

  /* ============================================================
     Input
     ============================================================ */
  private inputRafPending = false;
  /** Single source of truth for textarea auto-sizing. Coalesces concurrent
   *  recomputes into one rAF frame, sets `height:auto` first (so shrinking
   *  works), then clamps to [min-height (from CSS), 240px]. Used by typing,
   *  slash insertion, history recall, submit clear — every path that
   *  mutates `inputEl.value`. */
  private recomputeInputHeight() {
    if (this.inputRafPending) return;
    this.inputRafPending = true;
    window.requestAnimationFrame(() => {
      this.inputRafPending = false;
      if (!this.inputEl) return;
      setStyle(this.inputEl, { height: 'auto' });
      // Force a synchronous reflow so scrollHeight reflects the new content,
      // not the prior (potentially taller) box.
      void this.inputEl.offsetHeight;
      const h = Math.min(this.inputEl.scrollHeight, 240);
      setStyle(this.inputEl, { height: h + 'px' });
    });
  }

  // Composer DOM refs that survive across rebuilds.
  private permPillEl!: HTMLElement;
  private reasoningPillEl!: HTMLElement;

  private buildInput() {
    const wrap = el('div', { className: 'nc-input-wrap', parent: this.rootEl });
    this.inputWrap = wrap;

    this.selectionPreviewEl = el('div', { className: 'nc-selection-preview', parent: wrap });
    setStyle(this.selectionPreviewEl, { display: 'none' });
    this.contextBarEl = el('div', { className: 'nc-context-bar', parent: wrap });

    const inputId = `glossa-input-${uid()}`;
    const labelId = `${inputId}-label`;
    el('label', {
      className: 'nc-sr-only',
      text: bi('Glossa message input', 'Glossa 消息输入框'),
      parent: wrap,
      attrs: { id: labelId, for: inputId },
    });

    this.inputEl = el('textarea', {
      className: 'nc-input', parent: wrap,
      attrs: {
        id: inputId,
        placeholder: t('placeholder_input'),
        // Avoid aria-label here: Obsidian's tooltip system may surface it as
        // a hover bubble over the composer. The hidden label keeps screen
        // reader support without creating an in-app tooltip.
        'aria-labelledby': labelId,
        role: 'textbox',
        'aria-multiline': 'true',
      },
    });

    this.inputEl.addEventListener('input', () => {
      this.handleTrigger();
      this.historyCursor = -1;
      this.recomputeInputHeight();
      this.renderSelectionPreview();
    });
    this.inputEl.addEventListener('keydown', (e) => {
      // IME composition guard: Chinese / Japanese / Korean input methods open
      // a candidate-selection panel while the user types. Pressing Enter then
      // COMMITS the IME selection — we must NOT treat that keydown as a
      // "send" intent. `e.isComposing` is the modern flag; legacy WebKit
      // doesn't set it but reports keyCode 229. Cover both.
      if (e.isComposing || (e as AnyValue).keyCode === 229) return;
      if (this.popup.onKey(e)) { e.preventDefault(); return; }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (this.inputEl.value.trim() && !this.streaming) void this.submit();
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (this.inputEl.value.trim() && !this.streaming) void this.submit();
        return;
      }
      if (e.key === 'ArrowUp' && this.caretAtTop()) {
        if (this.recallHistory(-1)) e.preventDefault();
      } else if (e.key === 'ArrowDown' && this.caretAtBottom()) {
        if (this.recallHistory(+1)) e.preventDefault();
      }
    });

    /* Footer (Cursor-style):
       [+]  [permissions ▼]   (spacer)   [reasoning ▼]  [send] */
    const footer = el('div', { className: 'nc-input-footer', parent: wrap });

    // (1) Attach button — hidden file input + button
    const fileInput = el('input', { className: 'nc-file-input', parent: footer, type: 'file', attrs: { multiple: 'true', accept: '*/*' } });
    setStyle(fileInput, { display: 'none' });
    fileInput.onchange = async () => {
      if (fileInput.files) for (const f of Array.from(fileInput.files)) this.ctx.add(await resolveDroppedFile(f));
      fileInput.value = '';
    };
    const attachBtn = el('button', { className: 'nc-composer-icon-btn', parent: footer, title: t('attach_file'), type: 'button', attrs: { 'aria-label': t('attach_file') } });
    setTrustedSvg(attachBtn, ICON.plusThin);
    attachBtn.onclick = () => fileInput.click();

    // (2) Permission pill — quick toggle of read-only / workspace-write / full
    this.permPillEl = el('button', { className: 'nc-composer-pill nc-perm-pill', parent: footer, type: 'button' });
    this.updatePermPill();
    this.permPillEl.onclick = () => this.openPermissionMenu();

    // (3) Model chip — moved below the textarea per user feedback. Sits right
    //     after the permission pill so the "current behaviour" cluster
    //     (permissions + model) reads as a single group on the left.
    this.modelBtn = el('button', { className: 'nc-model-chip', parent: footer, title: 'Pick endpoint / model', type: 'button' });
    this.updateModelBtn();
    this.modelBtn.onclick = () => this.openEndpointMenu();

    // (spacer)
    el('span', { className: 'nc-input-footer-spacer', parent: footer });

    // (3) Reasoning effort pill — brain + level
    this.reasoningPillEl = el('button', { className: 'nc-composer-pill nc-reasoning-pill', parent: footer, type: 'button', attrs: { 'aria-label': 'Reasoning effort' } });
    this.updateReasoningPill();
    this.reasoningPillEl.onclick = () => { void this.openReasoningMenu(); };

    // (4) Send / stop
    this.submitBtn = el('button', { className: 'nc-submit-btn nc-submit-icon-only', parent: footer, type: 'button' });
    this.updateSubmitBtn();
    this.submitBtn.onclick = () => {
      if (this.streaming) this.cancelStream();
      else void this.submit();
    };

    this.installDropZone(wrap);
  }

  /* ---------- Composer pills (permissions + reasoning) ---------- */

  private permLabel(): string {
    const lvl = this.plugin.settings.permissionLevel;
    if (lvl === 'read-only')       return bi('Read only', '只读');
    if (lvl === 'workspace-write') return bi('Workspace write', '可写 vault');
    return bi('Full access', '完全权限');
  }
  private updatePermPill() {
    if (!this.permPillEl) return;
    clear(this.permPillEl);
    const lvl = this.plugin.settings.permissionLevel;
    // Lucide `shield` family — keyed to the permission level. Drawn at
    // viewBox 24×24, stroke 2 (Lucide native) so they render at canonical
    // weight when the pill renders the SVG at 14px.
    let path: string;
    if (lvl === 'read-only') {
      // shield-check
      path = `<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>`;
    } else if (lvl === 'workspace-write') {
      // shield-half
      path = `<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="M12 22V2"/>`;
    } else {
      // shield-alert (full access — flag with a !)
      path = `<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="M12 8v4"/><path d="M12 16h.01"/>`;
    }
    const ic = el('span', { className: 'nc-pill-glyph', parent: this.permPillEl });
    setTrustedSvg(ic, `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`);
    el('span', { className: 'nc-pill-text', text: this.permLabel(), parent: this.permPillEl });
    el('span', { className: 'nc-pill-caret', text: '▾', parent: this.permPillEl });
    this.permPillEl.title = bi('Click to switch permission level', '点击切换权限级别');
    this.permPillEl.setAttribute('aria-label', this.permPillEl.title + `: ${this.permLabel()}`);
    this.permPillEl.classList.toggle('perm-read',  lvl === 'read-only');
    this.permPillEl.classList.toggle('perm-write', lvl === 'workspace-write');
    this.permPillEl.classList.toggle('perm-full',  lvl === 'full');
  }
  /** Show or hide the shared popup against `anchor`. If the popup is already
   *  open against the SAME anchor, second click hides it (toggle). If open
   *  against a different anchor, switch to the new one. */
  private togglePopup(anchor: HTMLElement, items: PopupItem[]) {
    this.closeHistoryPopover();
    if (this.popup.isOpen() && this.popup.currentAnchor() === anchor) {
      this.popup.hide();
      return;
    }
    this.popup.show(anchor, items);
  }

  private openPermissionMenu() {
    const cur = this.plugin.settings.permissionLevel;
    const opts: { v: 'read-only' | 'workspace-write' | 'full'; label: string }[] = [
      { v: 'read-only',       label: bi('Read only',       '只读') },
      { v: 'workspace-write', label: bi('Workspace write', '可写 vault') },
      { v: 'full',            label: bi('Full access',     '完全权限') },
    ];
    const items: PopupItem[] = opts.map(o => ({
      label: o.label,
      checked: cur === o.v,
      onSelect: async () => {
        this.plugin.settings.permissionLevel = o.v;
        await this.plugin.saveSettings();
        this.updatePermPill();
      },
    }));
    this.togglePopup(this.permPillEl, items);
  }

  /** Reasoning effort levels supported by the active endpoint/model. */
  private reasoningOptionsForActive(): { v: import('../types').ReasoningEffort; label: string }[] {
    const ep = this.activeEndpoint();
    if (!ep) return [];
    return reasoningOptionsForEndpoint(ep).map(v => ({ v, label: t(`effort_${v}`) }));
  }
  private updateReasoningPill() {
    if (!this.reasoningPillEl) return;
    clear(this.reasoningPillEl);
    const ep = this.activeEndpoint();
    const effort = (ep?.reasoningEffort ?? 'off');
    const ic = el('span', { className: 'nc-pill-glyph', parent: this.reasoningPillEl });
    // Lucide `sparkles` — same icon ChatGPT and Cursor use for reasoning /
    // thinking. Universally readable, brand-neutral.
    setTrustedSvg(ic, `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.582a.5.5 0 0 1 0 .962L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/></svg>`);
    // Subtle subscript so users see the current level at a glance.
    const map: Record<string, string> = {
      off: '·', none: '0', minimal: 'MIN', low: 'L', medium: 'M', high: 'H', xhigh: 'X', max: 'MAX', ultra: 'U',
    };
    el('span', { className: 'nc-pill-sub', text: map[effort] ?? 'M', parent: this.reasoningPillEl });
    el('span', { className: 'nc-pill-caret', text: '▾', parent: this.reasoningPillEl });
    this.reasoningPillEl.title = bi(`Reasoning effort: ${effort}`, `思考强度：${effort}`);
    this.reasoningPillEl.setAttribute('aria-label', this.reasoningPillEl.title);
    this.reasoningPillEl.setAttribute('aria-disabled', String(!ep));
    this.reasoningPillEl.classList.toggle('disabled', !ep);
  }
  private async openReasoningMenu() {
    const ep = this.activeEndpoint();
    if (!ep) return;
    const cur = ep.reasoningEffort ?? 'off';
    const items: PopupItem[] = this.reasoningOptionsForActive().map(o => ({
      label: o.label,
      checked: cur === o.v,
      onSelect: async () => {
        ep.reasoningEffort = o.v;
        await this.plugin.saveSettings();
        this.updateReasoningPill();
      },
    }));
    this.togglePopup(this.reasoningPillEl, items);
  }

  /** Public — refreshes the composer pills after settings change. */
  refreshComposerPills() {
    this.updatePermPill();
    this.updateReasoningPill();
  }

  private installDropZone(wrap: HTMLElement) {
    let overlay: HTMLElement | null = null;
    const showOverlay = () => {
      if (overlay) return;
      overlay = el('div', { className: 'nc-drop-overlay', parent: wrap, text: 'Drop files to attach' });
    };
    const hideOverlay = () => { overlay?.remove(); overlay = null; };

    wrap.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      showOverlay();
    });
    wrap.addEventListener('dragleave', (e) => {
      if (e.relatedTarget && wrap.contains(e.relatedTarget as Node)) return;
      hideOverlay();
    });
    wrap.addEventListener('drop', (e) => {
      void (async () => {
      e.preventDefault();
      hideOverlay();
      const files = e.dataTransfer?.files;
      if (!files) return;
      for (const f of Array.from(files)) {
        try { this.ctx.add(await resolveDroppedFile(f)); }
        catch (err) { quickNotice(`Failed to attach ${f.name}: ${err.message}`); }
      }
      })();
    });
  }

  /** Aurora v0.4: visual handoff when the user sends. Drops a ghost
   *  element with the textarea content at the input's exact position,
   *  then drifts it up + fades it out so the eye is "carried" toward
   *  where the assistant message will appear. Bails early on
   *  reduced-motion preference or overlong text so we never paint a
   *  giant translucent slab over the canvas. */
  private playSendFlyout(text: string) {
    if (!text) return;
    if (!this.inputEl || !this.inputWrap) return;
    if (text.length > 400) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const rect = this.inputWrap.getBoundingClientRect();
    const ghost = activeDocument.createElement('div');
    ghost.className = 'nc-send-flyout';
    ghost.textContent = text;
    setStyle(ghost, {
      position: 'fixed',
      left: `${rect.left + 8}px`,
      top:  `${rect.top + 8}px`,
      width:  `${rect.width - 16}px`,
      maxHeight: '120px',
    });
    activeDocument.body.appendChild(ghost);
    // Two-frame deferral: one frame for the browser to paint the ghost at
    // its origin, another to apply the .flying class. Without this both
    // states fire in the same paint and the transition is skipped.
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => ghost.classList.add('flying')));
    window.setTimeout(() => ghost.remove(), 520);
  }

  private updateSubmitBtn() {
    clear(this.submitBtn);
    const ic = el('span', { className: 'nc-btn-icon', parent: this.submitBtn });
    if (this.streaming) {
      this.submitBtn.classList.add('stop');
      this.submitBtn.title = 'Stop';
      setTrustedSvg(ic, ICON.stop);
      // Aurora ring on the composer also activates during streaming so
      // the "alive" signal is multi-locus (button morph + ring rotates).
      this.inputWrap?.classList.add('streaming');
      // Clear any stale "just finished" ping in case the user re-sends fast.
      this.inputWrap?.classList.remove('streamed');
    } else {
      // Detect a transition (streaming → idle). The composer briefly flashes
      // a cyan success ring before fading back to its rest state — this is
      // the visual "done" cue tied to result-to-claim cycle completion.
      const wasStreaming = this.inputWrap?.classList.contains('streaming') ?? false;
      this.submitBtn.classList.remove('stop');
      this.submitBtn.title = `Send (⌘/${'Ctrl'}+↵)`;
      setTrustedSvg(ic, ICON.send);
      this.inputWrap?.classList.remove('streaming');
      if (wasStreaming) {
        this.inputWrap?.classList.add('streamed');
        window.setTimeout(() => this.inputWrap?.classList.remove('streamed'), 900);
      }
    }
  }

  private updateModelBtn() {
    clear(this.modelBtn);
    const active = this.activeEndpoint();
    if (!active) {
      el('span', { className: 'nc-model-label', text: bi('No endpoint', '未配置 endpoint'), parent: this.modelBtn });
      const a = el('span', { className: 'nc-arrow', parent: this.modelBtn });
      setTrustedSvg(a, ICON.arrowDown);
      this.modelBtn.title = bi('No endpoint — open settings', '未配置 endpoint — 打开设置');
      this.modelBtn.setAttribute('aria-label', this.modelBtn.title);
      return;
    }
    // Show ONLY the user-defined label. The underlying model id moves into
    // the tooltip — the chip stays compact and the label drives identity.
    el('span', { className: 'nc-model-label', text: active.label, parent: this.modelBtn });
    const a = el('span', { className: 'nc-arrow', parent: this.modelBtn });
    setTrustedSvg(a, ICON.arrowDown);
    const model = active.model ?? bi('(default)', '（默认）');
    this.modelBtn.title = `${active.label}\nmodel: ${model}\n${bi('click to switch', '点击切换')}`;
    this.modelBtn.setAttribute('aria-label', `${active.label}, ${model}`);
  }

  private openEndpointMenu() {
    const active = this.activeEndpoint();
    const eps = this.plugin.settings.endpoints;
    const items: PopupItem[] = [];

    if (!active && eps.length === 0) {
      items.push({
        label: bi('No endpoints — open Settings', '未配置 endpoint — 打开设置'),
        onSelect: () => (this.app as AnyValue).setting.open(),
      });
      this.togglePopup(this.modelBtn, items);
      return;
    }

    // Section 1: models of the active endpoint
    if (active) {
      const models = active.availableModels && active.availableModels.length
        ? active.availableModels
        : (active.model ? [active.model] : []);
      for (const m of models.slice(0, 25)) {
        items.push({
          label: m,
          section: active.label,
          checked: active.model === m,
          onSelect: async () => {
            active.model = m;
            await this.plugin.saveSettings();
          },
        });
      }
      if (active.kind === 'custom-api') {
        items.push({
          label: bi('↻ Detect models', '↻ 检测可用模型'),
          section: active.label,
          onSelect: async () => {
            try {
              quickNotice(bi('Detecting models…', '检测中…'));
              const epDec = await this.plugin.getDecryptedEndpoint(active);
              if (!epDec) {
                quickNotice(bi('Unlock or re-enter this endpoint API key first.', '请先解锁或重新输入该 endpoint 的 API key。'));
                return;
              }
              const list = normalizeModelList(await new CustomApiProvider(epDec).listModels());
              if (list.length) {
                active.availableModels = list;
                await this.plugin.saveSettings();
                quickNotice(bi(`Found ${list.length} models.`, `共发现 ${list.length} 个模型。`));
              } else {
                quickNotice(bi('No models returned by this endpoint.', '该 endpoint 未返回模型列表。'));
              }
            } catch (err) {
              quickNotice(bi(`Detect failed: ${err?.message ?? err}`, `检测失败：${err?.message ?? err}`), 6000);
            }
          },
        });
      }
    }

    // Section 2: switch endpoint
    const others = eps.filter(x => x.id !== this.plugin.settings.activeEndpointId);
    for (const ep of others) {
      items.push({
        label: ep.label,
        section: bi('Switch endpoint', '切换 endpoint'),
        onSelect: async () => {
          this.plugin.settings.activeEndpointId = ep.id;
          await this.plugin.saveSettings();
        },
      });
    }

    // Section 3: manage
    items.push({
      label: bi('Manage endpoints…', '管理 endpoint…'),
      section: bi('More', '更多'),
      onSelect: () => {
        (this.app as AnyValue).setting.open();
        (this.app as AnyValue).setting.openTabById(this.plugin.manifest.id);
      },
    });

    this.togglePopup(this.modelBtn, items);
  }

  /* ============================================================
     @ / / triggers
     ============================================================ */
  private handleTrigger() {
    const v = this.inputEl.value;
    const cur = this.inputEl.selectionStart;
    let i = cur - 1;
    let scanned = 0;
    while (i >= 0 && scanned < INPUT_TRIGGER_LOOKBACK && !/\s/.test(v[i])) {
      i--;
      scanned++;
    }
    // Long CJK / URL-ish runs without whitespace should not make every
    // Backspace scan the whole paragraph. If the token is already too long,
    // it is not a useful @ or / trigger candidate.
    if (i >= 0 && scanned >= INPUT_TRIGGER_LOOKBACK && !/\s/.test(v[i])) {
      this.inputTriggerSig = '';
      if (this.popup.isOpen()) this.popup.hide();
      return;
    }
    const tokenStart = i + 1;
    const token = v.slice(tokenStart, cur);
    const kind = token.startsWith('@') ? '@' : token.startsWith('/') ? '/' : '';
    if (!kind) {
      this.inputTriggerSig = '';
      if (this.popup.isOpen()) this.popup.hide();
      return;
    }
    const query = token.slice(1);
    const sig = `${kind}:${tokenStart}:${query}`;
    if (sig === this.inputTriggerSig) return;
    this.inputTriggerSig = sig;
    if (kind === '@') this.showMentionPopup(query, tokenStart);
    else this.showSlashPopup(query, tokenStart);
  }

  private showMentionPopup(query: string, tokenStart: number) {
    const items: PopupItem[] = [];
    items.push({
      label: query.match(/^https?:\/\//) ? query : 'web URL…', hint: 'fetch page',
      iconSvg: ICON.globe, section: 'GENERIC',
      onSelect: async () => {
        const { promptModal } = await import('./confirm_modal');
        const url = query.match(/^https?:\/\//)
          ? query
          : (await promptModal(this.app, { title: 'URL', placeholder: 'https://…' }) ?? '');
        if (url) { const it = await resolveWebUrl(url); this.ctx.add(it); }
        this.removeToken(tokenStart);
      }
    });
    for (const f of listFilesForPicker(this.app, query, 25)) {
      const ext = (f.file.extension || '').toLowerCase();
      const isImg = /^(png|jpg|jpeg|gif|webp|bmp|svg)$/.test(ext);
      const labelExt = ext && ext !== 'md' ? '.' + ext : '';
      items.push({
        label: f.file.basename + labelExt,
        hint: f.file.path,
        iconSvg: isImg ? ICON.image : ICON.file,
        section: 'FILES',
        onSelect: async () => { this.ctx.add(await resolveFile(this.app, f.file)); this.removeToken(tokenStart); }
      });
    }
    if (items.length === 0) this.popup.hide();
    else { this.closeHistoryPopover(); this.popup.show(this.inputEl, items); }
  }

  private showSlashPopup(query: string, tokenStart: number) {
    const q = query.toLowerCase();

    // Action commands — don't insert a template, run plugin behaviour directly
    const actions: { trigger: string; title: string; run: () => Promise<void> }[] = [
      {
        trigger: '/compact', title: 'Compact conversation',
        run: async () => {
          this.removeToken(tokenStart);
          this.inputEl.value = '';
          this.recomputeInputHeight();
          const ep = this.activeEndpoint();
          if (!ep) { quickNotice('No endpoint configured.'); return; }
          const epReady = await this.plugin.getDecryptedEndpoint(ep);
          if (!epReady) { quickNotice('Endpoint locked or invalid.'); return; }
          await this.runAutoCompact(epReady, 'manual');
        },
      },
    ];
    const actionItems: PopupItem[] = actions
      .filter(a => a.trigger.slice(1).toLowerCase().includes(q) || a.title.toLowerCase().includes(q))
      .map(a => ({
        label: a.trigger, hint: a.title, iconSvg: ICON.wrench, section: 'ACTION',
        onSelect: a.run,
      }));

    const all = [...BUILTIN_SLASH_COMMANDS, ...this.plugin.settings.customSlashCommands];
    const templateItems: PopupItem[] = all
      .filter(c => c.trigger.slice(1).toLowerCase().includes(q) || c.title.toLowerCase().includes(q))
      .map(c => ({
        label: c.trigger, hint: c.title, iconSvg: ICON.wrench,
        section: c.custom ? 'CUSTOM' : 'BUILT-IN',
        // applySlash rewrites the entire textarea value (replacing any partial
        // trigger like "/transl" the user typed). Do NOT also call removeToken
        // — that would re-slice the freshly rewritten string with the stale
        // tokenStart and either over-delete or leave a phantom-tall textarea.
        onSelect: async () => { await this.applySlash(c); }
      }));

    const items = [...actionItems, ...templateItems];
    if (items.length === 0) this.popup.hide();
    else { this.closeHistoryPopover(); this.popup.show(this.inputEl, items); }
  }

  private removeToken(tokenStart: number) {
    const v = this.inputEl.value;
    const cur = this.inputEl.selectionStart;
    this.inputEl.value = v.slice(0, tokenStart) + v.slice(cur);
    this.inputTriggerSig = '';
    this.inputEl.focus();
  }

  /** True iff the textarea caret is at offset 0 (or whole content is empty).
   *  ↑-key history nav only kicks in here so it doesn't fight in-text cursor moves. */
  private caretAtTop(): boolean {
    const v = this.inputEl.value;
    if (!v) return true;
    const s = this.inputEl.selectionStart ?? 0;
    return s === 0;
  }
  private caretAtBottom(): boolean {
    const v = this.inputEl.value;
    if (!v) return true;
    const s = this.inputEl.selectionEnd ?? 0;
    return s === v.length;
  }

  /** Recall a previous user message into the input box. dir=-1 = older, +1 = newer.
   *  Returns true if we consumed the key (i.e., handled history) — caller preventDefaults. */
  private recallHistory(dir: -1 | 1): boolean {
    const userMsgs = this.session.messages.filter(m => m.role === 'user');
    if (userMsgs.length === 0) return false;
    // Entering history mode for the first time → snapshot the current draft so ↓ can restore.
    if (this.historyCursor === -1) {
      if (dir > 0) return false;  // can't go newer than "drafting" state
      this.historyDraft = this.inputEl.value;
      this.historyCursor = userMsgs.length - 1;
    } else {
      this.historyCursor += dir;
      if (this.historyCursor < 0) this.historyCursor = 0;
      if (this.historyCursor >= userMsgs.length) {
        // Past the newest → restore the draft and exit history mode
        this.inputEl.value = this.historyDraft;
        this.recomputeInputHeight();
        const len = this.historyDraft.length;
        this.inputEl.setSelectionRange(len, len);
        this.historyCursor = -1;
        return true;
      }
    }
    const text = visibleUserContent(userMsgs[this.historyCursor]);
    this.inputEl.value = text;
    this.recomputeInputHeight();
    // Park caret at end so the user can keep typing forward immediately.
    const len = text.length;
    this.inputEl.setSelectionRange(len, len);
    return true;
  }

  private async applySlash(cmd: { template: string; trigger?: string; title?: string }) {
    // The textarea must NOT grow when a slash command is picked. Solution: insert
    // ONLY a one-line trigger (e.g. `/translate Chinese`) and expand the full template
    // at submit time. The user sees a compact pill of intent; the model gets the
    // full prompt + content. Default arg is pulled from the ${args:Default} marker.
    const defaultArgMatch = cmd.template.match(/\$\{args(?::([^}]+))?\}/);
    const defaultArg = defaultArgMatch ? (defaultArgMatch[1] ?? '') : '';
    const trigger = cmd.trigger ?? '/cmd';
    const oneLiner = defaultArg ? `${trigger} ${defaultArg}` : `${trigger} `;
    this.inputEl.value = oneLiner;
    this.inputEl.selectionStart = this.inputEl.selectionEnd = oneLiner.length;
    this.recomputeInputHeight();
    this.inputEl.focus();
    this.inputEl.classList.add('nc-flash');
    window.setTimeout(() => this.inputEl.classList.remove('nc-flash'), 380);
  }

  /** If the input starts with a known slash trigger like `/translate Chinese`, expand
   *  that to the full template at submit time. Anything after the first line is appended
   *  as user supplement to the expanded prompt. */
  private async expandSlashTrigger(text: string): Promise<PromptExpansion> {
    const newlineIdx = text.indexOf('\n');
    const firstLine = (newlineIdx >= 0 ? text.slice(0, newlineIdx) : text).trim();
    const supplement = newlineIdx >= 0 ? text.slice(newlineIdx + 1).trim() : '';
    const m = firstLine.match(/^(\/[A-Za-z][\w-]*)(?:\s+(.*))?$/);
    if (!m) return { text, expanded: false, embeddedSelection: false, embeddedCurrentFile: false };
    const trigger = m[1];
    const argStr = (m[2] ?? '').trim();
    const all = [...BUILTIN_SLASH_COMMANDS, ...this.plugin.settings.customSlashCommands];
    const cmd = all.find(c => c.trigger === trigger);
    if (!cmd) return { text, expanded: false, embeddedSelection: false, embeddedCurrentFile: false };

    const af = this.currentContextFile();
    const sel = this.currentSelection?.text ?? '';
    const explicitItems = this.ctx.list().filter(item => !item.isCurrent);
    const markdownFileContent = explicitItems.length === 0 && af && af.extension === 'md'
      ? await this.app.vault.cachedRead(af)
      : '';
    const fileContent = markdownFileContent || buildContextSourceReference(af, explicitItems);
    const expanded = applySlashTemplate({
      template: cmd.template, selection: sel, fileContent,
      fileName: af?.basename ?? '', vaultName: this.app.vault.getName(),
      args: argStr,
    });
    const selectionOrFile = cmd.template.includes('${selection-or-file}');
    const embeddedSelection = !!sel && (cmd.template.includes('${selection}') || selectionOrFile);
    const embeddedCurrentFile = !!markdownFileContent && (
      cmd.template.includes('${file}') || (selectionOrFile && !sel)
    );
    return {
      text: supplement ? `${expanded}\n\n${supplement}` : expanded,
      expanded: true,
      embeddedSelection,
      embeddedCurrentFile,
    };
  }

  /** Legacy compact-marker resolver — still honoured for any `{{...}}` left in by
   *  callers that didn't go through the slash-trigger path (e.g. workflows). */
  private async resolveSlashMarkers(text: string): Promise<PromptExpansion> {
    if (!/\{\{(context|selection|file)\}\}/.test(text)) {
      return { text, expanded: false, embeddedSelection: false, embeddedCurrentFile: false };
    }
    const sel = this.currentSelection?.text ?? '';
    const af = this.currentContextFile();
    const explicitItems = this.ctx.list().filter(item => !item.isCurrent);
    const markdownFileContent = explicitItems.length === 0 && af && af.extension === 'md'
      ? await this.app.vault.cachedRead(af)
      : '';
    const fileContent = markdownFileContent || buildContextSourceReference(af, explicitItems);
    const hasContext = text.includes('{{context}}');
    const hasSelection = text.includes('{{selection}}');
    const hasFile = text.includes('{{file}}');
    return {
      text: text
        .replace(/\{\{context\}\}/g,   sel || fileContent || '')
        .replace(/\{\{selection\}\}/g, sel || '')
        .replace(/\{\{file\}\}/g,      fileContent || ''),
      expanded: true,
      embeddedSelection: !!sel && (hasContext || hasSelection),
      embeddedCurrentFile: !!markdownFileContent && (hasFile || (hasContext && !sel)),
    };
  }

  /** Expand the session's ChatMessage[] into model-facing MessageInput[] for the agent
   *  loop. Critically: preserves PRIOR tool calls and tool results so cross-turn
   *  references like "the third point you just read" work. Each assistant message that
   *  ran tools re-emits its tool_use blocks via `toolCalls`; each toolEvent becomes a
   *  separate role:'tool' message with id + result content.
   *
   *  Skips: tool-role messages that already exist as canonical entries (they're
   *  rebuilt from toolEvents), the active user turn, and the empty placeholder
   *  assistant message we just created.
   *
   *  MEMORY MODEL: This is the single source of truth for the conversation
   *  context across ALL providers. The returned MessageInput[] is reserialized
   *  per provider (OpenAI/Anthropic JSON for custom-api, stdin pipe for
   *  codex/claude CLIs). That's why memory works across mixed-endpoint chats —
   *  the next provider call always sees the full history regardless of which
   *  endpoint produced each prior turn. The trade-off is no provider-side
   *  caching survives between turns (e.g. codex starts a new thread_id every
   *  invocation; Anthropic prompt caching gets a chance only if cache_control
   *  markers happen to land on the same prefix). */
  /** Some reasoner models (DeepSeek R1 family) REQUIRE prior assistant turns
   *  to include reasoning_content or they 4xx. Others (gpt-4o, Claude) ignore
   *  it and just pay extra tokens. Detect by model name + apiStyle. */
  private modelRequiresReasoningPassthrough(): boolean {
    const ep = this.activeEndpoint();
    if (!ep) return false;
    const model = (ep.model ?? '').toLowerCase();
    // DeepSeek-reasoner / Qwen QwQ / R1-distill style models — match common substrings
    if (/reasoner|deepseek-r1|deepseek-v3.*think|qwq|r1-distill/.test(model)) return true;
    return false;
  }

  private buildModelHistory(currentUserId: string, currentAsstId: string | undefined): MessageInput[] {
    const passReasoning = this.modelRequiresReasoningPassthrough();
    const out: MessageInput[] = [];
    const recentToolMessageIds = new Set(this.session.messages
      .filter(m => m.role === 'assistant' && (m.toolEvents?.length ?? 0) > 0)
      .slice(-2)
      .map(m => m.id));
    for (const m of this.session.messages) {
      if (m.id === currentUserId) continue;
      if (currentAsstId && m.id === currentAsstId) continue;
      // Bare role:'tool' messages on a ChatMessage are legacy / accidental — the loop
      // expects them to be reconstructed from toolEvents below. Skip.
      if (m.role === 'tool') continue;
      if (m.compactSummary) {
        out.push({
          role: 'user',
          content: [
            '<context-compaction>',
            'This is an authoritative summary of earlier conversation turns. Continue the same task from it; do not treat it as a new user request.',
            m.content ?? '',
            '</context-compaction>',
          ].join('\n'),
        });
        continue;
      }
      if (m.role === 'assistant' && m.toolEvents && m.toolEvents.length > 0) {
        const keepFullToolContext = recentToolMessageIds.has(m.id);
        // First push the assistant turn with its tool_use blocks
        const toolCalls = m.toolEvents.map(ev => ({
          id: ev.id,
          name: ev.name,
          args: compactHistoricalToolArgs(ev.args ?? {}, keepFullToolContext),
        }));
        out.push({
          role: 'assistant',
          content: m.content ?? '',
          toolCalls,
          reasoningContent: passReasoning ? m.reasoningContent : undefined,
        });
        // Then a role:'tool' message for each tool result (skipped only if the event was denied with no result)
        for (const ev of m.toolEvents) {
          if (ev.result == null && ev.status !== 'success' && ev.status !== 'error' && ev.status !== 'denied') continue;
          out.push({
            role: 'tool',
            toolCallId: ev.id,
            toolName: ev.name,
            content: compactHistoricalToolResult({
              toolName: ev.name,
              result: String(ev.result ?? ''),
              status: ev.status,
              isRecent: keepFullToolContext,
            }),
            toolContentBlocks: keepFullToolContext ? ev.contentBlocks : undefined,
            toolIsError: ev.status === 'error' || ev.status === 'denied',
          });
        }
      } else {
        out.push({
          role: m.role,
          content: m.content ?? '',
          reasoningContent: m.role === 'assistant' && passReasoning ? m.reasoningContent : undefined,
        });
      }
    }
    return out;
  }

  /** Run a one-shot summarisation request, replace the older messages in this session
   *  with the resulting summary, and rerender. Called both pre-submit (auto trigger)
   *  and from the `/compact` slash command (manual trigger). */
  private async runAutoCompact(ep: Endpoint, reason: 'auto' | 'manual') {
    if (this.session.messages.length < 4) { if (reason === 'manual') quickNotice('Not enough history to compact.'); return; }
    const vaultRoot = (this.app.vault.adapter as AnyValue).basePath as string | undefined;
    const provider = buildProvider(ep, this.plugin.settings.globalProxy, vaultRoot);
    const keepRecent = 2;

    // Insert a transient loading card at the END of the messages list
    const loading = el('div', { className: 'nc-compact-loading', parent: this.messagesEl });
    const spinner = el('div', { className: 'nc-compact-loading-spinner', parent: loading });
    setTrustedSvg(spinner, ICON.spinnerRing);
    el('span', { className: 'nc-compact-loading-text',
      text: `Summarising ${this.session.messages.length - keepRecent} older messages…`, parent: loading });
    this.scrollToBottom();

    try {
      const result = await compactSession(this.session, {
        provider,
        model: ep.model,
        keepRecent,
        signal: this.abortCtl?.signal,
      });
      loading.remove();
      if (!result) { if (reason === 'manual') quickNotice('Nothing to compact.'); return; }
      applyCompact(this.session, result, keepRecent);
      this.historyWindow = latestHistoryWindow(this.session.messages);
      this.renderSessionHistory({ scrollToBottom: true });
      await this.flushPersistNow();
      quickNotice(`Compacted ${result.summarisedCount} msgs → 1 summary (~${formatTokenCount(result.tokensSaved)} tok saved)`);
    } catch (e) {
      loading.remove();
      quickNotice(`Compact failed: ${e.message ?? e}`);
    }
  }

  /** Restore the messages that a given summary replaced. */
  private async undoCompact(summaryId: string) {
    const ok = undoCompactInSession(this.session, summaryId);
    if (!ok) { quickNotice('No snapshot for this summary.'); return; }
    this.historyWindow = latestHistoryWindow(this.session.messages);
    this.renderSessionHistory({ scrollToBottom: true });
    await this.flushPersistNow();
    quickNotice('Restored pre-compact history.');
  }

  /* ============================================================
     Submit — runs the agent loop (with tools if endpoint supports it)
     ============================================================ */
  private async submit() {
    if (this.streaming) return;
    const raw = this.inputEl.value.trim();
    if (!raw) return;

    // Clear the input IMMEDIATELY so Enter feels snappy. If a downstream
    // pre-flight check fails (no endpoint, locked keys), we restore the
    // original text so the user can fix the issue and retry.
    const inputBackup = this.inputEl.value;
    const restoreInput = () => {
      this.inputEl.value = inputBackup;
      this.recomputeInputHeight();
      this.inputEl.focus();
    };
    // Aurora v0.4: visual "flying" handoff — a ghost copy of the textarea
    // content drifts upward and fades as the message bubble takes its place.
    // No-op for reduced-motion users; skipped for long inputs to avoid a
    // huge translucent block flashing across the screen.
    this.playSendFlyout(inputBackup);
    this.inputEl.value = '';
    this.recomputeInputHeight();
    this.historyCursor = -1; this.historyDraft = '';

    // 1) If the line starts with a known `/<trigger> [arg]`, expand to its full template
    // 2) Then resolve any legacy {{...}} markers
    // Both happen at submit time so the textarea itself never grew.
    const slashExpansion = await this.expandSlashTrigger(raw);
    const markerExpansion = await this.resolveSlashMarkers(slashExpansion.text);
    const text = markerExpansion.text;
    const ep = this.activeEndpoint();
    if (!ep) { restoreInput(); quickNotice('No endpoint configured. Open settings.'); return; }

    // Decrypt endpoint FIRST — fail before touching UI / message state so we don't leave
    // an empty assistant bubble + cursor on the screen.
    const epReady = await this.plugin.getDecryptedEndpoint(ep);
    if (!epReady) { restoreInput(); quickNotice('Endpoint key locked or invalid. Unlock encryption or re-enter the API key.'); return; }

    // Auto-compact: if the existing session is approaching the context budget, summarise
    // the older messages into a single recap before adding the new user turn.
    // If we run pre-submit compact, we set _preSubmitCompacted = true so the
    // reactive (context_overflow) compaction inside loop.ts is suppressed for
    // this turn — otherwise we'd burn TWO compaction LLM calls back-to-back.
    let preSubmitCompacted = false;
    const effectiveWindow = this.effectiveContextWindow(epReady.model);
    if (this.plugin.settings.autoCompactEnabled) {
      const used = estimateSessionTokens(this.session);
      const budget = effectiveWindow.maxCtx;
      const threshold = budget * (this.plugin.settings.autoCompactThresholdPct / 100);
      if (used > threshold) {
        await this.runAutoCompact(epReady, 'auto');
        preSubmitCompacted = true;
      }
    }

    // Re-validate selection at submit time: if the source DOM no longer has any selection
    // AND focus isn't currently in the sidebar (i.e., user has clicked away from both), drop it.
    {
      const winSel = window.getSelection()?.toString().trim() ?? '';
      const focusInSidebar = this.containerEl.contains(activeDocument.activeElement);
      if (!winSel && !focusInSidebar) {
        this.currentSelection = null;
        this.renderSelectionPreview();
      }
    }
    const selectionContextBlock = this.currentSelection
      ? `### Selection (from ${this.currentSelection.source}${this.currentSelection.file ? `, ${this.currentSelection.file.path}` : ''}):\n\n${this.currentSelection.text}`
      : '';
    const recentUserTexts = this.session.messages
      .filter(message => message.role === 'user')
      .slice(-6)
      .reverse()
      .map(message => message.displayContent ?? message.content ?? '');
    const responseLanguage = inferResponseLanguage({
      currentText: raw,
      recentUserTexts,
      selectionText: this.currentSelection?.text,
      uiLanguage: currentLanguage(),
    });
    const responseLanguageHint = buildResponseLanguageHint(responseLanguage);
    const embeddedSelection = slashExpansion.embeddedSelection || markerExpansion.embeddedSelection;
    const embeddedCurrentFile = slashExpansion.embeddedCurrentFile || markerExpansion.embeddedCurrentFile;

    // Refresh the open source at send time. This picks up current Markdown
    // edits and lazily resolves non-Markdown files using the requested task
    // (for example front + ending pages for /summarize).
    await this.hydrateCurrentContextForPrompt(raw, embeddedSelection || embeddedCurrentFile);
    const turnContextItems = this.ctx.list();
    const hasExplicitAttachments = turnContextItems.some(it => !it.isCurrent);

    // Save only lightweight metadata refs — never the resolved file/image contents.
    const ctxSnap: ContextItemRef[] = turnContextItems.map(it => ({
      kind: it.kind, label: it.label, detail: it.detail, tokens: it.tokens, pinned: it.pinned, isCurrent: it.isCurrent,
    }));
    // `displayContent` always keeps the user-authored form. `content` becomes
    // the exact model-facing prompt snapshot after context assembly below.
    const wasExpanded = slashExpansion.expanded || markerExpansion.expanded;
    const userMsg: ChatMessage = {
      id: uid(), role: 'user', content: text, timestamp: Date.now(), contextSnapshot: ctxSnap,
      // Keep the compact user-authored text for UI/compaction while `content`
      // is replaced below with the exact model-facing prompt snapshot. This is
      // what lets later turns retain attached PDF/file text without persisting
      // image data URIs in chat storage.
      displayContent: raw,
      selectionEcho: this.currentSelection ? {
        text: this.currentSelection.text,
        source: this.currentSelection.source,
        file: this.currentSelection.file?.path,
      } : undefined,
    };
    this.session.messages.push(userMsg);
    this.historyWindow = latestHistoryWindow(this.session.messages);
    this.renderSessionHistory({ scrollToBottom: true });
    this.ctx.resetUnpinned();

    // Input + history cursor were already cleared at the top of submit() so the
    // box feels instant. We just reset the selection echo here.
    this.currentSelection = null;
    this.renderSelectionPreview();

    // Start a new assistant message — fresh turnId for this user turn.
    this.currentTurnId = uid();
    const turnIdForThisRun = this.currentTurnId;
    this.currentAsstMsg = { id: uid(), role: 'assistant', content: '', timestamp: Date.now(), toolEvents: [], turnId: this.currentTurnId };
    this.session.messages.push(this.currentAsstMsg);
    this.streamingBuf = '';
    this.streaming = true;
    // Mirror streaming state to the view root so CSS animations (act pulse,
    // future skeleton effects) can scope themselves to active streams and
    // stay calm when idle. See styles.css .glossa-streaming.
    this.rootEl?.classList.add('glossa-streaming');
    this.updateSubmitBtn();
    this.streamingMsgUI = this.renderMessage(this.currentAsstMsg);
    this.streamingMsgUI.wrap.classList.add('streaming');
    this.currentActivityStartedAt = Date.now();
    this.setTurnActivity(this.streamingMsgUI, 'Thinking...', 'thinking');
    this.streamingStartedAt = Date.now();

    // Wrap everything that follows in try/finally — any thrown error (provider
    // crash, runAgentLoop edge case, finalize bug) MUST still reset the
    // streaming flag. Without this guard the flag stays stuck on `true` and
    // every subsequent submit() returns early at the top check, giving the
    // "model stopped answering after one bad turn" symptom the user reported.
    let loopHadError = false;
    try {

    const vaultRoot = (this.app.vault.adapter as AnyValue).basePath as string | undefined;
    const provider = buildProvider(epReady, this.plugin.settings.globalProxy, vaultRoot);
    // Hard cap = a hair below the effective model window so we leave room for
    // the system prompt + assistant response. The previous code displayed the
    // model window in the footer but still budgeted attachments against the
    // settings cap, which let a 128k model receive a 1M-sized prompt.
    const historyBudgetTokens = estimateSessionTokens(this.session);
    const responseReserve = Math.min(16_000, Math.max(4_000, Math.floor(effectiveWindow.maxCtx * 0.06)));
    const softCap = Math.max(1, Math.floor(effectiveWindow.maxCtx * 0.92) - historyBudgetTokens - responseReserve);
    const hardCap = Math.max(1, Math.floor(effectiveWindow.maxCtx * 0.98) - historyBudgetTokens - responseReserve);
    // Slash templates for Markdown may already contain the selection/current
    // file verbatim. Suppress only that duplicate copy; otherwise the open
    // file is always present and its policy role decides how it is used.
    const suppressEmbeddedCurrent = embeddedSelection || embeddedCurrentFile;
    const { text: ctxBlock, dropped, forcedDrops } = this.ctx.asPromptBlock(softCap, hardCap, {
      suppressAutoCurrent: suppressEmbeddedCurrent,
      items: turnContextItems,
    });
    if (dropped.length > 0) {
      quickNotice(`Context budget: dropped ${dropped.length} unpinned item(s) (${dropped.map(d => d.label).join(', ').slice(0, 80)}) to fit ${formatTokenCount(softCap)} tokens. Pin to keep.`);
    }
    if (forcedDrops.length > 0) {
      // Hard cap kicked in — even pinned/current items had to be dropped. Surface
      // this loudly because it changes what the model sees vs what the user sees pinned.
      new Notice(`⚠ HARD context cap exceeded: had to drop ${forcedDrops.length} pinned/current item(s): ${forcedDrops.map(d => d.label).join(', ')}. Compress or remove items to keep them.`, 10000);
    }
    const sysPrompt = await this.buildSystemPrompt();
    // Slash commands are self-contained task instructions, so they do not need
    // a prior-turn continuity hint. Their attached/open source context still
    // participates unless it was embedded verbatim above.
    const taskContinuityHint = wasExpanded ? '' : buildTaskContinuityHint(text, userMsg.id, this.session.messages, ctxSnap, { hasExplicitSelection: !!selectionContextBlock });
    const currentContextHint = buildCurrentContextPolicyHint(raw, ctxSnap, hasExplicitAttachments);
    const explicitTurnImages = this.ctx.imagesForAPI({ suppressAutoCurrent: suppressEmbeddedCurrent, items: turnContextItems });
    const reuseRecentVisual = explicitTurnImages.length === 0
      && !!this.recentVisualContext
      && shouldReuseRecentVisualContext(raw, !!taskContinuityHint);
    const requestImages = explicitTurnImages.length
      ? explicitTurnImages
      : reuseRecentVisual ? this.recentVisualContext?.images ?? [] : [];
    const inheritedVisualHint = reuseRecentVisual
      ? visualContinuityHint(requestImages.map(image => image.name ?? 'image'))
      : '';
    const finalUserContent = this.pendingRegeneratePrompt ?? [
      responseLanguageHint,
      taskContinuityHint,
      inheritedVisualHint,
      currentContextHint,
      ctxBlock,
      embeddedSelection ? '' : selectionContextBlock,
      text,
    ].filter(Boolean).join('\n\n');
    this.pendingRegeneratePrompt = null;
    captureUserPromptSnapshot(userMsg, raw, finalUserContent);
    if (explicitTurnImages.length) {
      this.recentVisualContext = { images: explicitTurnImages.slice(0, 3) };
    } else if (!reuseRecentVisual) {
      this.recentVisualContext = null;
    }

    // Build a FULL model-facing history that PRESERVES tool calls + tool results from
    // prior turns. Without this, the model loses everything it ever read/wrote and can
    // only guess from its own final replies (#2). Each assistant turn that ran tools
    // re-emits the tool_use blocks; each toolEvent becomes a role:'tool' message.
    const history = this.buildModelHistory(userMsg.id, this.currentAsstMsg.id);

    this.abortCtl = new AbortController();

    // Custom API → we control the tool-use protocol → enable our tool dispatch.
    // CLI providers → either single-shot (no tools) or fullAgent (their own tool dispatch).
    // For read-only permission we still expose read-side tools.
    // requestUrl path is non-streaming + non-tool-aware → must disable.
    const enableTools = ep.kind === 'custom-api' && !ep.useObsidianFetch;
    if (ep.kind === 'custom-api' && ep.useObsidianFetch && this.plugin.settings.runMode === 'act') {
      quickNotice('Tools disabled in "Use Obsidian requestUrl" mode — switch off requestUrl for full agent.');
    }
    this.startElapsedTicker();

    // Session-token race guard: capture the token at the moment this submit
    // begins. Every callback below checks `live()` and silently drops the
    // event if the user switched / cleared the session mid-stream. Without
    // this guard, chunks queued before a switch would write into the new
    // session's messages array and corrupt history.
    const myToken = this.sessionToken;
    const live = () => myToken === this.sessionToken;

    await runAgentLoop({
      app: this.app,
      provider,
      systemPrompt: sysPrompt,
      userContent: finalUserContent,
      history,
      enableTools,
      endpointKind: ep.kind,
      endpointFullAgent: !!(epReady as AnyValue).cliFullAgent,
      permissionLevel: this.plugin.settings.permissionLevel,
      runMode: this.plugin.settings.runMode,
      maxSteps: this.plugin.settings.agentMaxSteps,
      autoApproveTools: this.plugin.settings.agentAlwaysApproveTools,
      neverApproveTools: this.plugin.settings.agentNeverApproveTools,
      permissionRules: this.plugin.settings.permissionRules,
      onPermissionRulePersist: async (rule) => {
        this.plugin.settings.permissionRules = [
          // Drop any superseded duplicate (same tool + scope + value + session scope)
          ...this.plugin.settings.permissionRules.filter(r =>
            !(r.tool === rule.tool && r.scope === rule.scope && r.value === rule.value && r.scopedToSessionId === rule.scopedToSessionId)),
          rule,
        ];
        await this.plugin.saveSettings();
        const scopeStr = rule.scopedToSessionId
          ? 'this session'
          : (rule.value ? rule.scope + ' ' + rule.value : 'globally');
        quickNotice(`Saved: ${rule.behavior} ${rule.tool} ${scopeStr}`);
      },
      onPermissionDecision: (entry) => {
        const log = this.plugin.settings.permissionLog ?? [];
        log.push(entry);
        // FIFO cap at 200
        if (log.length > 200) log.splice(0, log.length - 200);
        this.plugin.settings.permissionLog = log;
        // Fire-and-forget persistence — don't block the loop on disk write
        this.plugin.saveSettings().catch(() => {});
      },
      model: ep.model,
      signal: this.abortCtl.signal,
      attachedImages: requestImages,
      checkpoint: this.plugin.checkpoint,
      sessionId: this.session.id,
      turnId: this.currentAsstMsg?.id,
      mcp: this.plugin.mcp,
      approver: (tool, args) => this.askInlineApproval(tool, args),

      // Reactive compaction: when the server says the prompt is too long, summarise
      // the session and return a fresh message array for the loop to retry with.
      // Skip if we already compacted pre-submit in this turn (loop.ts also has
      // its own once-per-turn guard, but defence-in-depth here saves the LLM call).
      onContextOverflow: async () => {
        if (preSubmitCompacted) {
          quickNotice('Pre-submit compaction already happened — refusing second pass to avoid burning a duplicate LLM call. Increase context window or open a fresh chat.', 6000);
          return null;
        }
        // Drop the empty assistant bubble that the failed turn created
        if (this.currentAsstMsg) {
          this.session.messages = this.session.messages.filter(m => m.id !== this.currentAsstMsg.id);
          if (this.streamingMsgUI) this.streamingMsgUI.wrap.remove();
        }
        quickNotice('Context window exceeded — compacting and retrying…', 3000);
        await this.runAutoCompact(epReady, 'auto');
        preSubmitCompacted = true;     // suppress further reactive compactions this turn
        // Reinstate the assistant bubble at the tail (loop will continue streaming into it)
        if (this.currentAsstMsg) {
          this.session.messages.push(this.currentAsstMsg);
          this.streamingMsgUI = this.renderMessage(this.currentAsstMsg);
          this.streamingMsgUI.wrap.classList.add('streaming');
          this.currentActivityStartedAt = Date.now();
          this.setTurnActivity(this.streamingMsgUI, 'Compacted, retrying...', 'thinking');
        }
        // Rebuild the message array for the loop from the compacted session, excluding
        // the assistant placeholder + the user turn itself (the loop appends both).
        const history = this.buildModelHistory(userMsg.id, this.currentAsstMsg?.id);
        return [
          ...history,
          { role: 'user', content: finalUserContent },
        ];
      },
      onText: (delta) => {
        if (!live()) return;
        if (this.lastChunkWasTool) {
          this.flushAndStartNewAsstSegment();
        }
        this.lastChunkWasTool = false;
        this.streamingBuf += delta;
        if (this.currentAsstMsg) this.currentAsstMsg.content = this.streamingBuf;
        this.scheduleStreamingRender();
      },
      onReasoning: (delta) => {
        if (!live()) return;
        if (!this.currentAsstMsg) return;
        this.currentAsstMsg.reasoningContent = (this.currentAsstMsg.reasoningContent ?? '') + delta;
        this.setTurnActivity(this.streamingMsgUI, 'Thinking...', 'thinking');
        this.scheduleReasoningRender();
      },
      onToolStart: (ev) => {
        if (!live()) return;
        if (!this.currentAsstMsg || !this.streamingMsgUI) return;
        this.currentAsstMsg.toolEvents = this.currentAsstMsg.toolEvents ?? [];
        if (!this.currentAsstMsg.toolEvents.find(t => t.id === ev.id)) this.currentAsstMsg.toolEvents.push(ev);
        this.upsertToolEvent(this.streamingMsgUI, ev);
        this.currentActivityStartedAt = ev.startedAt || Date.now();
        this.setTurnActivity(this.streamingMsgUI, activityDescriptionFor(ev.name, ev.args), 'tool');
        this.streamingMsgUI.wrap.classList.add('has-tools');
        this.lastChunkWasTool = true;
      },
      onToolEnd: (ev) => {
        if (!live()) return;
        if (!this.currentAsstMsg || !this.streamingMsgUI) return;
        const list = this.currentAsstMsg.toolEvents ?? [];
        const idx = list.findIndex(t => t.id === ev.id);
        if (idx >= 0) list[idx] = ev; else list.push(ev);
        this.currentAsstMsg.toolEvents = list;
        this.upsertToolEvent(this.streamingMsgUI, ev);
        if (ev.status === 'running' || ev.status === 'pending') {
          this.currentActivityStartedAt = ev.startedAt || Date.now();
          this.setTurnActivity(this.streamingMsgUI, activityDescriptionFor(ev.name, ev.args), 'tool');
        } else {
          this.currentActivityStartedAt = Date.now();
          this.setTurnActivity(this.streamingMsgUI, ev.status === 'success' ? 'Processing result...' : 'Handling tool result...', 'thinking');
        }
        if (ev.name === 'todo_write' && Array.isArray(ev.args?.items)) {
          this.updatePlanBoard(ev.args.items);
        }
        this.lastChunkWasTool = true;
      },
      onStepBoundary: async () => {
        if (!live()) return;
        if (this.currentAsstMsg && this.streamingMsgUI) {
          this.currentAsstMsg.content = this.streamingBuf;
          this.streamingMsgUI.wrap.classList.remove('streaming');
          this.setTurnActivity(this.streamingMsgUI, '', 'idle');
          this.finalizeReasoningLabel(this.streamingMsgUI, this.currentAsstMsg);
          await this.finalizeAsstRender(this.streamingMsgUI, this.currentAsstMsg);
        }
        // Re-check after the await — session may have switched while
        // finalizeAsstRender was awaiting (markdown/MathJax can be slow).
        if (!live()) return;
        this.currentAsstMsg = { id: uid(), role: 'assistant', content: '', timestamp: Date.now(), toolEvents: [], turnId: this.currentTurnId ?? undefined };
        this.session.messages.push(this.currentAsstMsg);
        this.streamingBuf = '';
        this.lastChunkWasTool = false;
        this.streamingMsgUI = this.renderMessage(this.currentAsstMsg);
        this.streamingMsgUI.wrap.classList.add('streaming');
        this.currentActivityStartedAt = Date.now();
        this.setTurnActivity(this.streamingMsgUI, 'Thinking...', 'thinking');
        this.streamingStartedAt = Date.now();
      },
      onError: (err) => {
        if (!live()) return;
        loopHadError = true;
        this.streamingBuf += `\n\n**[error]** ${err}`;
        if (this.currentAsstMsg) this.currentAsstMsg.content = this.streamingBuf;
        this.scheduleStreamingRender();
      },
      onFinal: (usage) => {
        if (!live()) return;
        if (usage && this.currentAsstMsg) {
          this.currentAsstMsg.usage = usage;
          if (usage.input) this.sessionInputTokens += usage.input;
          if (usage.output) this.sessionOutputTokens += usage.output;
          if (usage.costUSD) this.sessionCostUSD += usage.costUSD;
        }
      },
    });

    // Flush + finalize — runs for ALL termination paths (success / error / abort / max-steps).
    // Strip streaming class + reasoning "streaming…" label from EVERY assistant message
    // in the current session, not just the latest, so leftover state from earlier steps
    // can't survive a max-steps termination.
    if (this.currentAsstMsg && this.streamingMsgUI) {
      this.currentAsstMsg.content = this.streamingBuf;
      this.streamingMsgUI.wrap.classList.remove('streaming');
      this.setTurnActivity(this.streamingMsgUI, '', 'idle');
      this.finalizeReasoningLabel(this.streamingMsgUI, this.currentAsstMsg);
      await this.finalizeAsstRender(this.streamingMsgUI, this.currentAsstMsg);
    }
    for (const ui of this.msgUIs.values()) {
      ui.wrap.classList.remove('streaming');
      this.setTurnActivity(ui, '', 'idle');
      this.finalizeReasoningLabel(ui, ui.msg);
      // Belt-and-suspenders: any tool card left in 'running' / 'pending' state
      // (because the provider was SIGTERM'd mid-flight) gets marked 'denied'
      // so the pulse animation stops. Without this the purple status pill
      // keeps animating forever on the dead card.
      for (const ev of (ui.msg.toolEvents ?? [])) {
        if (ev.status === 'running' || ev.status === 'pending') {
          ev.status = 'denied';
          ev.endedAt = Date.now();
          this.upsertToolEvent(ui, ev);
        }
      }
    }
    const cancelled = !!this.abortCtl?.signal.aborted;
    this.closeOpenPlanItems(loopHadError || cancelled ? 'stopped' : 'completed');
    this.compactProcessForTurn(turnIdForThisRun);

    this.renderCostBar();
    this.session.updatedAt = Date.now();
    // Title heuristic: first assistant reply after a user turn, OR the session
    // still has the default 'New chat' title. The old condition `length === 2`
    // broke when the first assistant message was deleted/regenerated — the
    // session would keep 'New chat' forever.
    // Auto-title trigger: the title is still the placeholder. Match both
    // language defaults — the new-session factory hardcodes 'New chat' (EN),
    // but a zh user who blanks the title in history_modal lands on '（无标题）'
    // (per history_modal.ts:217). Without matching all forms, zh users'
    // sessions silently keep their stale default forever.
    const placeholderTitles = new Set(['New chat', '新对话', '(untitled)', '（无标题）']);
    const needsTitle = !this.session.title || placeholderTitles.has(this.session.title);
    if (needsTitle && text.trim()) this.session.title = text.slice(0, 60);
    await this.flushPersistNow();
    } catch (err) {
      this.closeOpenPlanItems('stopped');
      // Surface the error to the user AND release the streaming lock.
      console.error('[Glossa] submit failed', err);
      quickNotice(bi(`Error: ${err?.message ?? err}`, `出错：${err?.message ?? err}`));
      // Clean up the empty assistant bubble we optimistically pushed before
      // the loop started. Without this, a failed submit leaves a permanent
      // empty card in the saved session (and the DOM); reloading the
      // session shows a ghost message-of-air for every prior failed turn.
      try {
        const a = this.currentAsstMsg;
        if (a && (!a.content || a.content.length === 0) && (!a.toolEvents || a.toolEvents.length === 0)) {
          this.session.messages = this.session.messages.filter(m => m.id !== a.id);
          // Remove the rendered bubble too.
          try { this.streamingMsgUI?.wrap?.remove(); } catch { /* ignore */ }
        }
      } catch (e) { console.warn('[Glossa] empty-assistant cleanup failed', e); }
    } finally {
      this.stopElapsedTicker();
      this.streaming = false;
      this.setTurnActivity(this.streamingMsgUI, '', 'idle');
      // Drop the view-root streaming class so the act pulse stops animating
      // (paired with .add() at submit start).
      this.rootEl?.classList.remove('glossa-streaming');
      this.updateSubmitBtn();
      this.streamingMsgUI = null;
      this.currentAsstMsg = null;
    }
    // Drop one-shot context (images, ephemeral attachments) after submit; keep pinned + current.
    this.ctx.resetUnpinned();
  }

  /** After streaming ends, render the final message via Obsidian (math / wikilinks / mermaid). */
  private async finalizeAsstRender(ui: MsgUI, m: ChatMessage) {
    if (this.streamRenderTimer) { window.clearTimeout(this.streamRenderTimer); this.streamRenderTimer = null; }
    // Wait for any in-flight stream render to settle
    while (this.streamRenderInFlight) await new Promise(r => window.setTimeout(r, 20));
    await renderInto(this.app, m.content || '', ui.body, this, this.app.workspace.getActiveFile()?.path ?? '');
    decorateCodeBlocks(ui.body, this.codeBlockHandlers());
    this.applyPreambleStyle(ui, m);
  }

  /** Drop the "streaming…" suffix from a reasoning card's summary when the step ends.
   *  Also hides the card entirely if no reasoning was captured this step.
   *  Force-collapses the card so the next agent step doesn't reuse a previously
   *  opened state (the user complained: reasoning would stay open after the
   *  model finished thinking). User can still click to expand the finished
   *  reasoning explicitly. */
  private finalizeReasoningLabel(ui: MsgUI, m: ChatMessage) {
    if (!ui.reasoningCard) return;
    const content = m.reasoningContent ?? '';
    if (!content) {
      setStyle(ui.reasoningCard, { display: 'none' });
      return;
    }
    const sum = ui.reasoningCard.querySelector('.nc-thinking-summary span');
    if (sum) sum.textContent = `🧠 Reasoning (${content.length.toLocaleString()} chars)`;
    // Collapse once thinking ends. Users want the finished thoughts out of the
    // way unless they explicitly request to read them.
    ui.reasoningCard.removeAttribute('open');
  }

  /** A "preamble" message is a short assistant text immediately followed by tool calls.
   *  We mute its styling so it reads like the codex-style intent statement before the action. */
  private applyPreambleStyle(ui: MsgUI, m: ChatMessage) {
    const text = (m.content ?? '').trim();
    const hasTools = (m.toolEvents?.length ?? 0) > 0;
    // Heuristic: short (<= 220 chars), single short paragraph, ends naturally, tools follow.
    const isShort = text.length > 0 && text.length <= 220 && !text.includes('\n\n');
    if (hasTools && isShort) ui.wrap.classList.add('preamble');
    else ui.wrap.classList.remove('preamble');
    // Intermediate messages (any assistant message that ran tools) shouldn't show their
    // own action row — those actions disrupt the visual flow between turns. They're only
    // meaningful on a real final answer.
    if (hasTools) ui.wrap.classList.add('has-tools');
    else ui.wrap.classList.remove('has-tools');
  }

  private cancelStream() {
    this.abortCtl?.abort();
  }

  /** Mirrors upstream Claude Code's two-zone system prompt:
   *  [STATIC cacheable head]  +  SYSTEM_PROMPT_DYNAMIC_BOUNDARY  +  [DYNAMIC tail]
   *
   *  The boundary is a literal marker the provider layer scans for to split the prompt
   *  into two cache_control blocks (ephemeral on the head only). Even providers that
   *  don't honour the split still receive a syntactically valid single prompt. */
  private async buildSystemPrompt(): Promise<string> {
    const af = this.app.workspace.getActiveFile();
    const folderOverride = af && this.plugin.settings.customPrompts.find(p =>
      p.folderScope && af.path.startsWith(p.folderScope));

    // ----- STATIC (cacheable) -----
    // Persona + invariant instructions. NO date, NO mode toggle, NO project context here —
    // those are volatile per-turn / per-session and would invalidate the cache.
    const staticHead = folderOverride?.systemPrompt ||
      `You are Glossa, an AI assistant embedded in the user's Obsidian vault. ` +
      `Be precise and concise. When the user has attached <context>...</context>, treat it as authoritative. ` +
      `Preserve markdown structure. Keep formulas, code, and proper nouns intact when translating. ` +
      `Follow each turn's <response-language> instruction; source-document language alone never decides reply language. ` +
      `Write math with Obsidian-compatible $...$ and $$...$$ delimiters, not \\(...\\) or \\[...\\].`;

    // ----- DYNAMIC tail -----
    const dyn: string[] = [];
    dyn.push(`# Environment\nToday: ${new Date().toISOString().slice(0, 10)}\nVault: "${this.app.vault.getName()}"`);

    if (this.plugin.settings.runMode === 'plan') {
      dyn.push(`# Mode: PLAN\nYou are in **Plan mode** — discuss the user's task and propose what you would do, but DO NOT call any write/edit/delete tools. You may still call read/search tools to investigate. Wait for the user to switch to Act mode before making changes.`);
    } else {
      dyn.push(`# Mode: ACT\nYou are in **Act mode** — full agent capability. Call tools to read, search, AND modify files as needed to complete the user's task.`);
    }

    const lvl = this.plugin.settings.permissionLevel;
    if (lvl === 'read-only') dyn.push(`# Permission: read-only\nWrite/edit/delete tools are disabled at this permission level. Only read-side tools are available.`);
    else if (lvl === 'workspace-write') dyn.push(`# Permission: workspace-write\nYou may modify files inside this vault. Each write requires user approval.`);

    if (this.plugin.settings.loadProjectContext) {
      const proj = await loadProjectContext(this.app);
      if (proj) dyn.push('# Project instructions\n\n' + proj);
    }

    return staticHead + '\n\n<<<SYSTEM_PROMPT_DYNAMIC_BOUNDARY>>>\n\n' + dyn.join('\n\n');
  }

  /* ============================================================
     Cost bar
     ============================================================ */
  private renderCostBar() {
    const hasUsage = this.sessionInputTokens > 0 || this.sessionOutputTokens > 0 || this.sessionCostUSD > 0;
    const ctxTokens = this.ctx.totalTokens();
    // Show the REAL model context window when we can infer it from the active
    // model id — that's what users compare against (Codex's own UI displays
    // 256k for codex-cli, not the plugin's 1M soft cap). Fall back to the
    // settings maximum when the model is unknown.
    const active = this.activeEndpoint();
    const { maxCtx, inferred, settingsMax, source } = this.effectiveContextWindow(active?.model);
    const hardCap = Math.floor(maxCtx * 0.92);

    // Session/history contribution
    const sessionCtxTokens = estimateSessionTokens(this.session);
    const totalPromptTokens = ctxTokens + sessionCtxTokens;
    const showBudget = totalPromptTokens > 0 && maxCtx > 0;

    if (!this.plugin.settings.showCostBar || (!hasUsage && !showBudget)) {
      setStyle(this.costBar, { display: 'none' }); return;
    }
    setStyle(this.costBar, { display: '' });
    clear(this.costBar);

    if (showBudget) {
      const pct = Math.min(100, (totalPromptTokens / maxCtx) * 100);
      const overHard = totalPromptTokens > hardCap;
      const tooltip = [
        `Current attachments: ${formatTokenCount(ctxTokens)}`,
        `History: ${formatTokenCount(sessionCtxTokens)}`,
        `Total: ${formatTokenCount(totalPromptTokens)} / ${formatTokenCount(maxCtx)} (${pct.toFixed(0)}%)`,
        `Window source: ${source === 'model' ? `model table (${active?.model ?? 'unknown'})` : `settings fallback (${formatTokenCount(settingsMax)})`}`,
        inferred && inferred !== maxCtx ? `Model window: ${formatTokenCount(inferred)}; settings cap: ${formatTokenCount(settingsMax)}` : '',
        `Soft hard-cap marker: ${formatTokenCount(hardCap)} — attachments are dropped/compaction is attempted before sending`,
      ].join('\n');
      const bar = el('div', { className: 'nc-budget-bar', parent: this.costBar, title: tooltip });
      // Sub-segments to show ctx vs. history split
      if (ctxTokens > 0) {
        const ctxFill = el('div', { className: 'nc-budget-fill nc-budget-ctx', parent: bar });
        setStyle(ctxFill, { width: Math.min(100, (ctxTokens / maxCtx) * 100).toFixed(1) + '%' });
      }
      if (sessionCtxTokens > 0) {
        const hist = el('div', { className: 'nc-budget-fill nc-budget-history', parent: bar });
        setStyle(hist, { left: Math.min(100, (ctxTokens / maxCtx) * 100).toFixed(1) + '%' });
        setStyle(hist, { width: Math.min(100, (sessionCtxTokens / maxCtx) * 100).toFixed(1) + '%' });
      }
      if (pct > 85 || overHard) bar.classList.add('danger');
      else if (pct > 60) bar.classList.add('warn');
      // Hard-cap marker
      if (hardCap < maxCtx) {
        const marker = el('div', { className: 'nc-budget-hard-cap', parent: bar });
        setStyle(marker, { left: ((hardCap / maxCtx) * 100).toFixed(1) + '%' });
      }
      const label = `ctx ${formatTokenCount(totalPromptTokens)} / ${formatTokenCount(maxCtx)}`;
      const lbl = el('span', { className: 'nc-budget-label' + (overHard ? ' over' : ''), text: label, parent: this.costBar });
      lbl.title = tooltip;
    }
    if (hasUsage) {
      el('span', { text: `usage in ${formatTokenCount(this.sessionInputTokens)}`, parent: this.costBar });
      el('span', { text: `out ${formatTokenCount(this.sessionOutputTokens)}`, parent: this.costBar });
      if (this.sessionCostUSD > 0) el('span', { text: `$${this.sessionCostUSD.toFixed(4)}`, parent: this.costBar });
    }
  }

  /* ============================================================
     Helpers / actions
     ============================================================ */
  private activeEndpoint(): Endpoint | undefined {
    const id = this.plugin.settings.activeEndpointId;
    return this.plugin.settings.endpoints.find(e => e.id === id);
  }

  private newSession(): ChatSession {
    return {
      id: uid(), title: 'New chat',
      createdAt: Date.now(), updatedAt: Date.now(),
      mode: this.plugin.settings.mode,
      endpointId: this.plugin.settings.activeEndpointId,
      messages: [],
      plan: [],
    };
  }

  startNewSession() {
    if (this.streaming) this.cancelStream();
    this.persistSession();
    // Bump session token so in-flight chunks from the cancelled stream get
    // dropped by the gates in submit() / on* callbacks.
    this.sessionToken++;
    this.session = this.newSession();
    this.historyWindow = latestHistoryWindow(this.session.messages);
    this.pendingRegeneratePrompt = null;
    this.recentVisualContext = null;
    this.sessionCostUSD = 0; this.sessionInputTokens = 0; this.sessionOutputTokens = 0;
    this.msgUIs.clear();
    clear(this.messagesEl);
    this.resetThreadRail();
    this.renderPlanBoard();   // empty since session.plan is undefined
    this.renderEmpty();
    this.renderCostBar();
  }

  private async loadSession(id: string) {
    const s = this.plugin.store.getSession(id);
    if (!s) {
      if (this.session.id === id) this.resetToEmptySession();
      return;
    }
    if (this.streaming) this.cancelStream();
    await this.flushPersistNow();
    // Bump BEFORE swapping session so any chunk callback that was queued
    // mid-await reads the new token and aborts. (The await above creates
    // a microtask window where late chunks can fire — without the bump
    // they'd write into `this.session.messages` AFTER the swap on the
    // next line and corrupt the loaded session.)
    this.sessionToken++;
    this.session = s;
    this.historyWindow = latestHistoryWindow(this.session.messages);
    this.pendingRegeneratePrompt = null;
    this.recentVisualContext = null;
    if (this.session.messages.length === 0) {
      this.msgUIs.clear();
      clear(this.messagesEl);
      this.resetThreadRail();
      this.renderEmpty();
    } else {
      this.renderSessionHistory({ scrollToBottom: true });
    }
    this.rebuildPlanFromSession();
  }

  /** Debounced save. Long agent runs call this from every onText/onTool tick.
   *  Without coalescing, chats.json is rewritten 10-20×/turn (~5MB each) which
   *  thrashes SSDs and makes iCloud/Dropbox loud. flushPersistNow() forces an
   *  immediate write at terminal points (stream end, view close, snapshot). */
  private _persistTimer: AnyValue = null;
  private sessionHasMeaningfulContent(session: ChatSession): boolean {
    return (session.messages ?? []).some(m =>
      (m.content ?? '').trim().length > 0 ||
      (m.displayContent ?? '').trim().length > 0 ||
      (m.reasoningContent ?? '').trim().length > 0 ||
      ((m.toolEvents ?? []).length > 0));
  }

  private persistSession() {
    if (!this.sessionHasMeaningfulContent(this.session)) return;
    if (this._persistTimer) return;
    const session = this.session;
    this._persistTimer = window.setTimeout(() => {
      this._persistTimer = null;
      void this.plugin.store.saveSession(session);
    }, 1000);
  }

  private clearPendingPersist() {
    if (!this._persistTimer) return;
    window.clearTimeout(this._persistTimer);
    this._persistTimer = null;
  }

  private resetToEmptySession() {
    if (this.streaming) this.cancelStream();
    this.clearPendingPersist();
    this.sessionToken++;
    this.session = this.newSession();
    this.historyWindow = latestHistoryWindow(this.session.messages);
    this.pendingRegeneratePrompt = null;
    this.recentVisualContext = null;
    this.sessionCostUSD = 0;
    this.sessionInputTokens = 0;
    this.sessionOutputTokens = 0;
    this.currentTurnId = null;
    this.streamingBuf = '';
    this.streamingMsgUI = null;
    this.currentAsstMsg = null;
    this.msgUIs.clear();
    clear(this.messagesEl);
    this.resetThreadRail();
    this.renderPlanBoard();
    this.renderEmpty();
    this.renderCostBar();
    this.stickToBottom = true;
  }

  private handleHistorySessionDeleted(id: string) {
    if (this.session.id !== id) return;
    this.closeHistoryPopover({ immediate: true });
    this.resetToEmptySession();
  }

  private handleHistoryCleared() {
    this.closeHistoryPopover({ immediate: true });
    this.resetToEmptySession();
  }

  /** Force-write the current session now (bypasses debounce). Use at stream
   *  end, before navigation, or before destructive operations like compact. */
  private async flushPersistNow() {
    if (this._persistTimer) { window.clearTimeout(this._persistTimer); this._persistTimer = null; }
    if (!this.sessionHasMeaningfulContent(this.session)) return;
    await this.plugin.store.saveSession(this.session);
  }

  private async exportChatToNote() {
    if (this.session.messages.length === 0) {
      quickNotice(bi('There is no conversation to export yet.', '当前还没有可导出的对话。'));
      return;
    }
    const folder = this.plugin.settings.chatsFolder || 'Chats';
    try { await this.app.vault.createFolder(folder); } catch { /* ignore */ }
    const safeTitle = (this.session.title || 'chat').replace(/[\\/:*?"<>|]/g, '-').slice(0, 60);
    const path = `${folder}/${new Date().toISOString().slice(0,10)}_${safeTitle}.md`;

    const renderMessage = (m: typeof this.session.messages[number]): string => {
      const parts: string[] = [];
      const heading = m.compactSummary
        ? `## Compacted summary (replaces ${m.summaryOfCount ?? '?'} earlier messages)`
        : `## ${m.role === 'assistant' ? 'Glossa' : m.role === 'user' ? 'You' : m.role}`;
      parts.push(heading, '');
      // Reasoning (from API reasoning_content) — folded as a markdown callout so it
      // round-trips with the visible thinking. Obsidian renders [!note]- as collapsed.
      if (m.reasoningContent && m.reasoningContent.trim()) {
        parts.push('> [!note]- Reasoning');
        for (const line of m.reasoningContent.split('\n')) parts.push('> ' + line);
        parts.push('');
      }
      const visibleContent = m.role === 'user' ? visibleUserContent(m) : m.content;
      if (visibleContent && visibleContent.trim()) {
        parts.push(visibleContent.trim(), '');
      }
      // Tool calls + their results
      if (m.toolEvents?.length) {
        parts.push('> [!info]- Tool calls (' + m.toolEvents.length + ')');
        for (const ev of m.toolEvents) {
          const argStr = JSON.stringify(ev.args ?? {}, null, 2);
          parts.push('> ');
          parts.push(`> **${ev.name}** · ${ev.status}` + (ev.endedAt ? ` · ${ev.endedAt - ev.startedAt}ms` : ''));
          parts.push('> ```json');
          for (const line of argStr.split('\n')) parts.push('> ' + line);
          parts.push('> ```');
          if (ev.result) {
            parts.push('> ');
            parts.push('> Result:');
            parts.push('> ```');
            for (const line of String(ev.result).slice(0, 4000).split('\n')) parts.push('> ' + line);
            parts.push('> ```');
          }
        }
        parts.push('');
      }
      return parts.join('\n');
    };

    const body = [
      `---`,
      `tags: [chat]`,
      `date: ${new Date().toISOString()}`,
      `mode: ${this.session.mode}`,
      `messages: ${this.session.messages.length}`,
      `---`,
      '',
      `# ${this.session.title}`,
      '',
      ...this.session.messages.map(renderMessage),
    ].join('\n');
    try {
      await this.app.vault.create(path, body);
    } catch (e) {
      quickNotice('Could not write file (already exists?).');
      return;
    }
    quickNotice(`Saved to ${path}`);
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) void this.app.workspace.getLeaf(true).openFile(f);
  }

  private async saveResponseAsNote(m: ChatMessage) {
    const folder = this.plugin.settings.chatsFolder || 'Chats';
    try { await this.app.vault.createFolder(folder); } catch { /* ignore */ }
    const path = `${folder}/${new Date().toISOString().replace(/[:.]/g,'-')}_assistant.md`;
    await this.app.vault.create(path, m.content);
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) void this.app.workspace.getLeaf(true).openFile(f);
    quickNotice(`Saved to ${path}`);
  }

  private insertAtCursor(text: string) {
    const md = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!md?.editor) { quickNotice('No active markdown editor.'); return; }
    md.editor.replaceSelection(text);
  }

  private applyEdit(text: string) {
    const md = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!md?.editor) { quickNotice('No active markdown editor.'); return; }
    if (md.editor.getSelection()) md.editor.replaceSelection(text);
    else md.editor.replaceRange(text + '\n\n', md.editor.getCursor());
  }

  private async regenerateLast() {
    if (this.streaming) return;
    while (this.session.messages.length && this.session.messages[this.session.messages.length - 1].role !== 'user') {
      this.session.messages.pop();
    }
    const lastUser = this.session.messages.pop();
    if (!lastUser) return;
    this.historyWindow = latestHistoryWindow(this.session.messages);
    this.renderSessionHistory({ scrollToBottom: true });
    // Persist the trimmed history before re-submit. Without this, an Obsidian
    // crash / quick reload between "regenerate" and the new turn finishing
    // leaves the on-disk session out of sync with what's in the bubble.
    await this.flushPersistNow();
    this.pendingRegeneratePrompt = lastUser.content;
    this.inputEl.value = visibleUserContent(lastUser);
    this.recomputeInputHeight();
    void this.submit();
  }
}

function extractThinking(src: string): { visible: string; thinking: string } {
  if (!src) return { visible: '', thinking: '' };
  const re = /<(?:thinking|reasoning)>([\s\S]*?)<\/(?:thinking|reasoning)>/gi;
  let thinking = '';
  const visible = src.replace(re, (_, inner) => { thinking += (thinking ? '\n\n---\n\n' : '') + inner.trim(); return ''; }).trim();
  return { visible, thinking };
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000); const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m${s}s`;
}

function pillIcon(it: ContextItem): string {
  switch (it.kind) {
    case 'file':       return ICON.file;
    case 'folder':     return ICON.folder;
    case 'tag':        return ICON.tag;
    case 'selection':  return ICON.selection;
    case 'web':        return ICON.globe;
    case 'image':      return ICON.image;
    default:           return ICON.file;
  }
}
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return -- Re-enable review lint rules after dynamic boundary module. */
