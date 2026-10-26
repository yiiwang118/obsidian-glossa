import { errorMessage } from '../utils/unknown_data';
import { App, Component, ItemView, Notice, WorkspaceLeaf, normalizePath, type Menu, type ViewStateResult } from 'obsidian';
import type GlossaPlugin from '../main';
import type { ChatSession, Endpoint } from '../types';
import { SIDE_CHAT_LIMITS, TemporaryChat, sideChatBudget, sideChatMarkdown, type ChatExcerpt, type TemporaryMessage } from '../temporary_chat';
import { buildProvider } from '../providers/registry';
import { el, setStyle, setTrustedSvg } from '../utils/dom';
import { bi, currentLanguage } from '../utils/i18n';
import { decorateCodeBlocks, renderInto, trimIncompleteMath } from '../utils/markdown';
import { confirmModal } from './confirm_modal';
import { ICON } from './icons';

export const VIEW_TYPE_TEMPORARY_CHAT = 'glossa-temporary-chat';
const opening = new WeakMap<TemporaryChat, Promise<void>>();

/** API endpoints only: a CLI agent would bring its own tools and vault access. */
const apiEndpoints = (plugin: GlossaPlugin) => plugin.settings.endpoints.filter(endpoint => endpoint.kind === 'custom-api');
const endpointName = (endpoint: Endpoint) => endpoint.model && endpoint.model !== endpoint.label ? `${endpoint.label} · ${endpoint.model}` : endpoint.label;

export async function openTemporaryChat(plugin: GlossaPlugin, session: ChatSession, excerpts: ChatExcerpt[] = []) {
  const endpoints = apiEndpoints(plugin);
  const endpoint = endpoints.find(item => item.id === plugin.settings.activeEndpointId) ?? endpoints[0];
  const chat = plugin.temporaryChats.forParent(session, endpoint?.id ?? '');
  chat.addExcerpts(excerpts);
  if (excerpts.some(excerpt => excerpt.truncated)) {
    const limit = SIDE_CHAT_LIMITS.excerpt.toLocaleString('en-US');
    new Notice(bi(`A quote longer than ${limit} characters keeps only its first ${limit}.`, `引用超过 ${limit} 字符，只保留前 ${limit} 字符。`), 6000);
  }
  const viewOf = (leaf: WorkspaceLeaf) => leaf.view instanceof TemporaryChatView && leaf.view.chat === chat ? leaf.view : null;
  const existing = plugin.app.workspace.getLeavesOfType(VIEW_TYPE_TEMPORARY_CHAT).find(leaf => viewOf(leaf));
  if (existing) { await plugin.app.workspace.revealLeaf(existing); viewOf(existing)?.focusComposer(); return; }
  if (opening.has(chat)) { await opening.get(chat); return; }
  const pending = (async () => {
    let leaf: WorkspaceLeaf;
    try { leaf = plugin.app.workspace.openPopoutLeaf({ size: { width: 560, height: 740 } }); }
    catch { leaf = plugin.app.workspace.getLeaf('tab'); }
    try {
      await leaf.setViewState({ type: VIEW_TYPE_TEMPORARY_CHAT, active: true, state: { id: chat.id } });
      await plugin.app.workspace.revealLeaf(leaf);
      viewOf(leaf)?.focusComposer();
    } catch (error: unknown) { leaf.detach(); throw error; }
  })();
  opening.set(chat, pending);
  try { await pending; } finally { opening.delete(chat); }
}

/** Windows restored from a saved layout have nothing to show; close them instead of leaving empty panes. */
export function closeEndedTemporaryChats(app: App) {
  for (const leaf of app.workspace.getLeavesOfType(VIEW_TYPE_TEMPORARY_CHAT)) {
    if (!(leaf.view instanceof TemporaryChatView) || !leaf.view.chat) leaf.detach();
  }
}

interface MessageUI {
  root: HTMLElement;
  body: HTMLElement;
  footer?: HTMLElement;
  footerKey?: string;
  reasoning?: HTMLDetailsElement;
  reasoningBody?: HTMLElement;
  component?: Component;
  rendered?: string;
  phase?: string;
  timer?: number;
  rendering?: boolean;
}

/** Only the question box is always on screen. Save, clear, the source chat and the
 *  model live in the window's own title bar and its ⋯ menu. */
export class TemporaryChatView extends ItemView {
  chat?: TemporaryChat;
  private unsubscribe?: () => void;
  private closed = true;
  private preparing = false;
  private lifecycle = 0;
  private composing = false;
  private syncTimer = 0;
  private saveAction?: HTMLElement;
  private clearAction?: HTMLElement;
  private messagesEl?: HTMLElement;
  private emptyEl?: HTMLElement;
  private omittedEl?: HTMLElement;
  private noticeEl?: HTMLElement;
  private pendingEl?: HTMLElement;
  private input?: HTMLTextAreaElement;
  private send?: HTMLButtonElement;
  private keys = { pending: '', empty: '', notice: '', send: '' };
  private readonly messageUIs = new Map<string, MessageUI>();
  constructor(leaf: WorkspaceLeaf, private readonly plugin: GlossaPlugin) { super(leaf); }
  getViewType() { return VIEW_TYPE_TEMPORARY_CHAT; }
  getDisplayText() {
    const title = this.chat ? this.sourceTitle(this.chat) : '';
    return bi('Temporary chat', '临时聊天') + (title ? ` · ${title}` : '');
  }
  getIcon() { return 'message-circle-plus'; }
  // Obsidian saves view state in workspace.json. Never put excerpts, history or a recoverable ID there.
  getState(): Record<string, unknown> { return {}; }
  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const id = state && typeof state === 'object' && 'id' in state && typeof state.id === 'string' ? state.id : '';
    this.unsubscribe?.(); this.chat = this.plugin.temporaryChats.get(id);
    if (!this.closed) this.build();
    await super.setState({}, result);
  }
  async onOpen() {
    this.closed = false;
    // Title-bar actions are prepended, so this order shows Save before Clear.
    this.clearAction ??= this.addAction('eraser', bi('Clear', '清空'), () => { void this.clearChat(); });
    this.saveAction ??= this.addAction('file-down', bi('Save as note', '保存为笔记'), () => { void this.saveAsNote(); });
    this.build();
  }
  async onClose() {
    this.closed = true; this.lifecycle++; this.preparing = false; this.unsubscribe?.(); this.chat?.stop();
    window.clearTimeout(this.syncTimer); this.syncTimer = 0;
    this.clearMessageUIs(); this.contentEl.empty();
  }
  endSession() {
    this.unsubscribe?.(); this.chat?.stop(); this.chat = undefined;
    if (!this.closed) this.build();
  }
  /** Settings changed: endpoints and the notice follow without rebuilding the transcript. */
  refresh() { this.sync(); }
  focusComposer() {
    if (this.closed || !this.input?.isConnected) return;
    this.input.focus();
    this.input.setSelectionRange(this.input.value.length, this.input.value.length);
  }

  onPaneMenu(menu: Menu, source: string) {
    super.onPaneMenu(menu, source);
    const chat = this.chat;
    if (!chat || this.closed) return;
    menu.addItem(item => item.setTitle(bi('Open the source chat', '打开来源主聊')).setIcon('message-square').onClick(() => { void this.openSource(); }));
    menu.addItem(item => item.setTitle(bi('Save as note', '保存为笔记')).setIcon('file-down').setDisabled(!this.canSave(chat)).onClick(() => { void this.saveAsNote(); }));
    menu.addItem(item => item.setTitle(bi('Clear', '清空')).setIcon('eraser').setDisabled(!this.canClear(chat)).onClick(() => { void this.clearChat(); }));
    const endpoints = apiEndpoints(this.plugin);
    if (endpoints.length < 2) return;
    menu.addSeparator();
    menu.addItem(item => item.setTitle(bi('Model', '模型')).setIsLabel(true));
    for (const endpoint of endpoints) {
      menu.addItem(item => item.setTitle(endpointName(endpoint)).setChecked(endpoint.id === chat.endpointId).setDisabled(chat.busy || this.preparing)
        .onClick(() => { chat.endpointId = endpoint.id; this.sync(); this.focusComposer(); }));
    }
  }

  private sourceTitle(chat: TemporaryChat) { return this.plugin.store?.loadedSession(chat.parentId)?.title || chat.parentTitle; }
  private canSave(chat: TemporaryChat) { return !chat.busy && !this.preparing && chat.messages.length > 0; }
  private canClear(chat: TemporaryChat) { return !chat.busy && !this.preparing && (!chat.fresh || !!chat.draft); }
  private clearMessageUIs() { for (const [id, ui] of [...this.messageUIs]) this.dropMessageUI(id, ui); }
  private dropMessageUI(id: string, ui: MessageUI) {
    window.clearTimeout(ui.timer);
    if (ui.component) this.removeChild(ui.component);
    ui.root.remove();
    this.messageUIs.delete(id);
  }

  private build() {
    this.lifecycle++; this.preparing = false;
    this.unsubscribe?.(); this.unsubscribe = undefined;
    this.clearMessageUIs(); this.keys = { pending: '', empty: '', notice: '', send: '' }; this.omittedEl = undefined;
    const root = this.contentEl; root.empty(); root.addClass('nc-temporary-chat');
    const chat = this.chat;
    this.syncActions();
    if (!chat) {
      const ended = el('div', { className: 'nc-side-ended', parent: root });
      el('p', { text: bi('This temporary chat has ended. Temporary chats live in memory only and are cleared when Glossa reloads.', '这段临时聊天已结束。临时聊天只存在内存里，Glossa 重新加载后会清空。'), parent: ended });
      el('button', { text: bi('Close', '关闭'), type: 'button', parent: ended, onClick: () => this.leaf.detach() });
      return;
    }
    this.messagesEl = el('div', { className: 'nc-side-messages', parent: root, attrs: { 'aria-label': bi('Temporary conversation', '临时对话') } });
    this.emptyEl = el('div', { className: 'nc-side-empty', parent: this.messagesEl });
    const composer = el('div', { className: 'nc-side-composer', parent: root });
    this.noticeEl = el('div', { className: 'nc-side-notice', parent: composer });
    this.pendingEl = el('div', { className: 'nc-side-pending', parent: composer });
    const row = el('div', { className: 'nc-side-input-row', parent: composer });
    this.input = el('textarea', { parent: row, attrs: { rows: '1', maxlength: String(SIDE_CHAT_LIMITS.prompt), 'aria-label': bi('Temporary chat question', '临时聊天问题') } });
    this.input.value = chat.draft;
    this.input.oninput = () => { chat.draft = this.input.value; this.fitInput(); this.syncComposer(chat); this.syncActions(); };
    this.input.addEventListener('compositionstart', () => { this.composing = true; });
    this.input.addEventListener('compositionend', () => { this.composing = false; });
    this.input.addEventListener('keydown', event => {
      if (event.key === 'Escape' && chat.busy) { event.preventDefault(); chat.stop(); return; }
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing || this.composing) return;
      event.preventDefault();
      if (!chat.busy) void this.run('send');
    });
    this.send = el('button', { type: 'button', className: 'nc-side-send', parent: row });
    this.send.onclick = () => { if (chat.busy) chat.stop(); else void this.run('send'); };
    this.unsubscribe = chat.subscribe(() => this.scheduleSync());
    this.sync();
    this.fitInput();
  }

  /** Streaming notifies on every chunk; the window redraws at most every 50 ms. */
  private scheduleSync() {
    if (this.syncTimer || this.closed) return;
    this.syncTimer = window.setTimeout(() => { this.syncTimer = 0; this.sync(); }, 50);
  }

  private sync() {
    const chat = this.chat;
    if (this.closed || !chat || !this.messagesEl) return;
    const stick = this.nearBottom();
    this.syncActions();
    this.renderEmpty(chat);
    this.renderNotice();
    this.renderPending(chat);
    const ids = new Set(chat.messages.map(message => message.id));
    for (const [id, ui] of [...this.messageUIs]) if (!ids.has(id)) this.dropMessageUI(id, ui);
    chat.messages.forEach((message, index) => this.syncMessage(chat, message, index === chat.messages.length - 1));
    this.syncOmitted(chat);
    this.syncComposer(chat);
    if (stick) this.scrollToBottom();
  }

  /** A line under the oldest turns once they no longer fit the model's context. */
  private syncOmitted(chat: TemporaryChat) {
    const count = chat.omittedTurns;
    // Turns are question–answer pairs, so the last omitted one ends at message 2n − 1.
    const anchor = count ? this.messageUIs.get(chat.messages[count * 2 - 1]?.id ?? '')?.root : undefined;
    if (!anchor) { this.omittedEl?.remove(); return; }
    this.omittedEl ??= el('div', { className: 'nc-side-omitted', parent: this.messagesEl });
    this.omittedEl.textContent = bi(`The ${count} earlier turn${count === 1 ? '' : 's'} above no longer fit the model's context and are not sent`, `以上 ${count} 轮已超出模型上下文，不再发送`);
    if (anchor.nextSibling !== this.omittedEl) anchor.after(this.omittedEl);
  }

  private syncActions() {
    const chat = this.chat;
    const state: Array<[HTMLElement | undefined, boolean]> = [[this.saveAction, !!chat && this.canSave(chat)], [this.clearAction, !!chat && this.canClear(chat)]];
    for (const [action, enabled] of state) {
      if (!action) continue;
      (action as HTMLButtonElement).disabled = !enabled;
      action.setAttribute('aria-disabled', String(!enabled));
    }
  }

  private renderEmpty(chat: TemporaryChat) {
    const noEndpoint = !apiEndpoints(this.plugin).length;
    const key = JSON.stringify([chat.messages.length > 0, chat.pending.length > 0, noEndpoint]);
    if (key === this.keys.empty) return;
    this.keys.empty = key;
    this.emptyEl.empty();
    this.emptyEl.hidden = chat.messages.length > 0 || noEndpoint;
    el('p', { parent: this.emptyEl, text: chat.pending.length
      ? bi('Replies stay in this window and are not added to the main chat.', '回答只留在这个窗口，不会写进主聊。')
      : bi('Select text in the main chat and choose “Add to temporary chat”, or just ask.', '在主聊选中文字后右键选择“添加到临时聊天”，或直接提问。') });
  }

  /** Without an API endpoint nothing can be asked; say so right above the box. */
  private renderNotice() {
    const noEndpoint = !apiEndpoints(this.plugin).length;
    const key = String(noEndpoint);
    if (key === this.keys.notice) return;
    this.keys.notice = key;
    this.noticeEl.empty();
    this.noticeEl.hidden = !noEndpoint;
    if (!noEndpoint) return;
    el('span', { text: bi('Temporary chat needs an API endpoint. CLI endpoints such as Codex or Claude Code are not used here.', '临时聊天需要一个 API 端点，不使用 Codex、Claude Code 等 CLI 端点。'), parent: this.noticeEl });
    el('button', { text: bi('Open settings', '打开设置'), type: 'button', parent: this.noticeEl, onClick: () => this.openSettings() });
  }

  private renderPending(chat: TemporaryChat) {
    const key = JSON.stringify(chat.pending.map(item => item.id));
    if (key === this.keys.pending) return;
    this.keys.pending = key;
    this.pendingEl.empty();
    this.pendingEl.hidden = !chat.pending.length;
    for (const excerpt of chat.pending) {
      const item = el('div', { className: 'nc-side-pending-item', parent: this.pendingEl });
      this.renderQuote(item, excerpt);
      const remove = this.iconButton(item, ICON.x, bi('Remove quote', '移除引用'), () => { chat.removeExcerpt(excerpt.id); this.sync(); this.focusComposer(); });
      remove.addClass('nc-side-quote-remove');
    }
  }

  /** A quote is one quiet line; clicking it shows the whole passage. */
  private renderQuote(parent: HTMLElement, excerpt: ChatExcerpt) {
    const label = (expanded: boolean) => expanded ? bi('Fold the quote', '收起引用') : bi('Show the whole quote', '展开引用');
    const quote = el('div', { className: 'nc-side-quote', parent, attrs: { role: 'button', tabindex: '0', 'aria-expanded': 'false', title: label(false) } });
    el('div', { className: 'nc-side-quote-text', text: excerpt.text, parent: quote });
    const toggle = () => {
      // Selecting text inside an open quote must not fold it.
      if (quote.ownerDocument.getSelection()?.isCollapsed === false) return;
      const expanded = quote.classList.toggle('is-expanded');
      quote.setAttribute('aria-expanded', String(expanded));
      quote.title = label(expanded);
    };
    quote.onclick = toggle;
    quote.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); } };
  }

  private iconButton(parent: HTMLElement, icon: string, label: string, onClick: () => void) {
    const button = el('button', { className: 'nc-side-icon', type: 'button', parent, attrs: { 'aria-label': label, title: label } });
    setTrustedSvg(button, icon);
    button.onclick = onClick;
    return button;
  }

  private syncMessage(chat: TemporaryChat, message: TemporaryMessage, last: boolean) {
    let ui = this.messageUIs.get(message.id);
    if (!ui) {
      const root = el('article', { className: `nc-side-message ${message.role}`, parent: this.messagesEl });
      if (message.role === 'user') {
        for (const excerpt of message.excerpts ?? []) this.renderQuote(root, excerpt);
        el('div', { className: 'nc-side-body is-plain', text: message.content, parent: root });
        this.messageUIs.set(message.id, { root, body: root });
        return;
      }
      const reasoning = el('details', { className: 'nc-side-reasoning', parent: root });
      el('summary', { text: bi('Thought process', '思考过程'), parent: reasoning });
      const reasoningBody = el('div', { className: 'nc-side-reasoning-body', parent: reasoning });
      reasoning.hidden = true;
      reasoning.addEventListener('toggle', () => { if (reasoning.open) reasoningBody.textContent = message.reasoning ?? ''; });
      ui = { root, reasoning, reasoningBody, body: el('div', { className: 'nc-side-body nc-msg-body', parent: root }), footer: el('div', { className: 'nc-side-message-footer', parent: root }) };
      this.messageUIs.set(message.id, ui);
    }
    if (message.role === 'user') return;
    // The latest answer keeps its actions in view; earlier ones show them on hover.
    ui.root.classList.toggle('is-last', last);
    if (message.reasoning && ui.reasoning) {
      ui.reasoning.hidden = false;
      if (ui.reasoning.open && ui.reasoningBody.textContent !== message.reasoning) ui.reasoningBody.textContent = message.reasoning;
    }
    if (ui.rendered !== message.content || ui.phase !== message.status) this.queueRender(ui, message, message.status === 'streaming' ? 150 : 0);
    const retry = last && chat.canRetry;
    const key = JSON.stringify([message.status, message.error, message.retryError, message.truncated, retry, !!message.content.trim(), message.status === 'streaming' && !message.content && !!message.reasoning]);
    if (key !== ui.footerKey) { ui.footerKey = key; this.renderFooter(ui.footer, message, retry); }
  }

  private renderFooter(footer: HTMLElement, message: TemporaryMessage, retry: boolean) {
    footer.empty();
    if (message.status === 'streaming') {
      el('span', { className: 'nc-side-typing', text: !message.content && message.reasoning ? bi('Thinking…', '正在思考…') : bi('Replying…', '正在回复…'), parent: footer, attrs: { role: 'status' } });
      return;
    }
    const note = message.status === 'error' ? message.error || bi('Request failed.', '请求失败。')
      : message.status === 'cancelled' ? bi('Stopped', '已停止')
      : message.retryError || (message.truncated ? bi('Hit the output limit, so this reply may be incomplete', '达到输出上限，回复可能不完整') : '');
    if (note) el('span', { className: `nc-side-note${message.status === 'error' ? ' is-error' : ''}`, text: note, parent: footer });
    if (message.status === 'error') {
      if (retry) el('button', { className: 'nc-side-retry', text: bi('Retry', '重试'), type: 'button', parent: footer, onClick: () => { void this.run('retry'); } });
      return;
    }
    const actions = el('div', { className: 'nc-side-actions', parent: footer });
    if (message.content.trim()) this.iconButton(actions, ICON.insert, bi('Place in main composer', '放入主聊输入框'), () => { void this.placeInMain(message); });
    if (retry) this.iconButton(actions, ICON.refresh, message.status === 'complete' ? bi('Regenerate', '重新生成') : bi('Retry', '重试'), () => { void this.run('retry'); });
    if (message.model) el('span', { className: 'nc-side-model-name', text: message.model, parent: actions });
  }

  /** Markdown renders off-screen and swaps in, so math and code never flash raw while streaming. */
  private queueRender(ui: MessageUI, message: TemporaryMessage, delay: number) {
    if (ui.rendering) return;
    if (ui.timer) { if (delay) return; window.clearTimeout(ui.timer); }
    ui.timer = window.setTimeout(() => { ui.timer = 0; void this.renderMessage(ui, message); }, delay);
  }

  private async renderMessage(ui: MessageUI, message: TemporaryMessage) {
    const content = message.content, phase = message.status;
    ui.rendering = true;
    const component = new Component();
    this.addChild(component);
    const staging = ui.body.win.createDiv();
    try {
      const source = phase === 'streaming' ? trimIncompleteMath(content) : content;
      if (source.trim()) await renderInto(this.app, source, staging, component);
      // Obsidian's own copy button joins the same compact toolbar as in the main chat.
      decorateCodeBlocks(staging, { labels: { copy: bi('Copy code', '复制代码') } });
    } catch {
      staging.empty(); staging.textContent = content;
    }
    ui.rendering = false;
    if (this.closed || this.messageUIs.get(message.id) !== ui) { this.removeChild(component); return; }
    const stick = this.nearBottom();
    ui.body.replaceChildren(...Array.from(staging.childNodes));
    if (ui.component) this.removeChild(ui.component);
    ui.component = component; ui.rendered = content; ui.phase = phase;
    if (stick) this.scrollToBottom();
    if (message.content !== content || message.status !== phase) this.queueRender(ui, message, message.status === 'streaming' ? 150 : 0);
  }

  private syncComposer(chat: TemporaryChat) {
    const endpoints = apiEndpoints(this.plugin);
    if (!endpoints.some(endpoint => endpoint.id === chat.endpointId)) chat.endpointId = endpoints[0]?.id ?? '';
    if (this.input.value !== chat.draft && !this.composing) { this.input.value = chat.draft; this.fitInput(); }
    // Read-only rather than disabled, so the caret stays in the box between questions.
    this.input.readOnly = this.preparing;
    this.input.placeholder = chat.pending.length ? bi('Ask about the quote…', '针对引用提问…') : chat.messages.length ? bi('Ask a follow-up…', '继续追问…') : bi('Ask a question…', '输入问题…');
    const stop = chat.busy;
    if (this.keys.send !== String(stop)) {
      this.keys.send = String(stop);
      const label = stop ? bi('Stop (Esc)', '停止（Esc）') : bi('Send (Enter)', '发送（Enter）');
      setTrustedSvg(this.send, stop ? ICON.stop : ICON.send);
      this.send.classList.toggle('is-stop', stop);
      this.send.setAttribute('aria-label', label); this.send.title = label;
    }
    this.send.disabled = this.preparing || (!stop && (!chat.endpointId || !chat.draft.trim()));
  }

  private fitInput() {
    if (!this.input) return;
    setStyle(this.input, { height: 'auto' });
    setStyle(this.input, { height: `${Math.min(Math.max(this.input.scrollHeight, 36), 200)}px` });
  }
  private nearBottom() { return !this.messagesEl || this.messagesEl.scrollHeight - this.messagesEl.scrollTop - this.messagesEl.clientHeight < 80; }
  private scrollToBottom() { if (this.messagesEl) this.messagesEl.scrollTop = this.messagesEl.scrollHeight; }

  private async run(kind: 'send' | 'retry') {
    const chat = this.chat;
    if (this.preparing || !chat || chat.busy || (kind === 'send' && !chat.draft.trim())) return;
    this.preparing = true; this.sync();
    const lifecycle = this.lifecycle;
    const prompt = chat.draft;
    try {
      const endpoint = this.plugin.settings.endpoints.find(item => item.id === chat.endpointId && item.kind === 'custom-api');
      if (!endpoint) throw new Error(bi('Add an API endpoint in Glossa settings first.', '请先在 Glossa 设置中添加 API 端点。'));
      const ready: Endpoint | null = await this.plugin.getDecryptedEndpoint(endpoint);
      if (this.closed || this.chat !== chat || this.lifecycle !== lifecycle) return;
      if (!ready) throw new Error(bi('Unlock the endpoint key first.', '请先解锁端点密钥。'));
      this.preparing = false;
      const options = { language: currentLanguage(), model: ready.model, modelLabel: ready.model || ready.label, budgetTokens: sideChatBudget(ready.model, this.plugin.settings.maxContextTokens) };
      const provider = buildProvider({ ...ready }, this.plugin.settings.globalProxy);
      await (kind === 'retry' ? chat.retry(provider, options) : chat.send(provider, prompt, options));
    } catch (error: unknown) {
      if (!this.closed && this.lifecycle === lifecycle) new Notice(errorMessage(error), 6000);
    } finally { if (this.lifecycle === lifecycle) { this.preparing = false; this.sync(); } }
  }

  private async clearChat() {
    const chat = this.chat;
    if (!chat || !this.canClear(chat)) return;
    // Quotes and a draft are cheap to redo; only a conversation asks first.
    if (chat.messages.length) {
      const confirmed = await confirmModal(this.app, { title: bi('Clear temporary chat?', '清空临时聊天？'), body: bi('Its messages, quotes and draft are removed from memory. The main conversation stays as it is.', '这段临时聊天的消息、引用和草稿会从内存中移除。主聊保持原样。'), confirmText: bi('Clear', '清空'), danger: true });
      if (!confirmed || this.closed || this.chat !== chat || chat.busy) return;
    }
    chat.clear();
    this.focusComposer();
  }

  private async saveAsNote() {
    const chat = this.chat;
    if (!chat || !this.canSave(chat)) return;
    const folder = normalizePath(this.plugin.settings.chatsFolder || 'Chats');
    const path = normalizePath(`${folder}/${new Date().toISOString().replace(/[:.]/g, '-')}_temporary-chat.md`);
    const content = sideChatMarkdown(chat, this.sourceTitle(chat));
    try {
      if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
      await this.app.vault.create(path, content);
      new Notice(bi(`Saved to ${path}`, `已保存到 ${path}`));
    } catch (error: unknown) {
      new Notice(bi('Could not save the note: ', '保存笔记失败：') + (errorMessage(error)), 6000);
    }
  }

  private async openSource() {
    const chat = this.chat;
    if (!chat) return;
    await this.plugin.activateView();
    if (!await this.plugin.getView()?.openChat(chat.parentId)) new Notice(bi('The source conversation is no longer available.', '来源主聊已不存在或无法打开。'));
  }

  private async placeInMain(message: TemporaryMessage) {
    const chat = this.chat;
    if (!chat) return;
    await this.plugin.activateView();
    const view = this.plugin.getView();
    if (await view?.placeInComposer(chat.parentId, message.content.trim())) new Notice(bi('Placed in the main composer. Review it before sending.', '已放入主聊输入框，请检查后再发送。'));
  }

  private openSettings() {
    const settings = (this.app as App & { setting?: { open?(): void; openTabById?(id: string): void } }).setting;
    settings?.open?.();
    settings?.openTabById?.(this.plugin.manifest.id);
  }
}
