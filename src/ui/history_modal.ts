import { App, Menu, Modal, Notice } from 'obsidian';
import type GlossaPlugin from '../main';
import type { ChatSession } from '../types';
import { debounce, setTrustedSvg } from '../utils/dom';
import { t, bi } from '../utils/i18n';
import { sessionFolder } from '../utils/chat_folders';

/* ============================================================
   Public entry points
   ============================================================ */

/** Open the legacy modal flavour (still used from the command palette). */
export function openHistoryModal(plugin: GlossaPlugin, onPick: (s: ChatSession) => void) {
  new HistoryModal(plugin.app, plugin, onPick).open();
}

/** Mount the compact popover inside an existing container. Returns a cleanup
 *  function. This is the default surface for the sidebar history button. */
export function renderHistoryPopover(
  host: HTMLElement,
  plugin: GlossaPlugin,
  opts: { onPick: (s: ChatSession) => void; onClose: () => void; onDelete?: (id: string) => void; onClear?: () => void },
): () => void {
  const view = new HistoryPopover(host, plugin, opts.onPick, opts.onClose, opts.onDelete, opts.onClear);
  view.render();
  return () => view.destroy();
}
// Back-compat alias for any external imports.
export const renderHistoryDrawer = renderHistoryPopover;

/* ============================================================
   Compact popover — Cursor / Raycast feel
   ============================================================
   Layout (top→bottom):
     [🔍 search bar         ⋯ ]    ← 32px row, no h3, no count
     -----------------------------
     [ title……          24m ]     ← 32px rows, ago pill right-aligned
     [ title……           1h ]
     [ title……           1d ]
     …scroll if many…

   "Delete > 7d" / "Clear all" now live behind the ⋯ overflow menu rather
   than as full-width buttons that ballooned the popover height. Right-click
   on a row still gives the per-row menu (open / rename / duplicate /
   delete). */

class HistoryPopover {
  private filter = '';
  private renamingId: string | null = null;
  private listEl!: HTMLElement;
  private foldersEl!: HTMLElement;
  private folderId: string | null = null;
  private folderEditor: string | null = null;
  /** Index of the keyboard-highlighted row in the CURRENT filtered list.
   *  -1 means "no selection yet". Reset whenever the filter changes. */
  private kbdIdx = -1;
  private kbdRows: HTMLElement[] = [];
  private kbdSessions: ChatSession[] = [];
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(
    private root: HTMLElement,
    private plugin: GlossaPlugin,
    private onPick: (s: ChatSession) => void,
    private onClose: () => void,
    private onDelete?: (id: string) => void,
    private onClear?: () => void,
  ) {}

  render() {
    this.root.empty();
    this.root.addClass('nc-history-pop');

    // Top bar: search + overflow menu.
    const top = this.root.createDiv({ cls: 'nc-history-pop-top' });
    const searchWrap = top.createDiv({ cls: 'nc-history-pop-search' });
    const searchIcon = searchWrap.createSpan({ cls: 'nc-history-pop-search-icon' });
    setTrustedSvg(searchIcon, `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`);
    const search = searchWrap.createEl('input', { type: 'text', cls: 'nc-history-pop-search-input' });
    search.placeholder = t('hist_search');
    search.setAttribute('aria-label', t('hist_search'));
    const onSearch = debounce(() => { this.filter = search.value.toLowerCase(); this.renderList(); }, 80);
    search.addEventListener('input', onSearch);
    this.root.ownerDocument.defaultView?.setTimeout(() => { if (search.isConnected) search.focus(); }, 30);

    const moreBtn = top.createEl('button', { cls: 'nc-history-pop-more', attr: { title: t('more') } });
    // Filled dots — Lucide's stroke-only r=1 dots are too tiny to see at 14px,
    // so we use solid fill with r=1.6.
    setTrustedSvg(moreBtn, `<svg viewBox="0 0 24 24" width="14" height="14"><circle cx="5"  cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/></svg>`);
    moreBtn.onclick = (e) => this.openOverflowMenu(e, moreBtn);

    this.foldersEl = this.root.createDiv({ cls: 'nc-history-folders' });
    this.renderFolders();

    // List body — flex-grow, scrollable.
    this.listEl = this.root.createDiv({ cls: 'nc-history-pop-list' });
    // a11y: announce the list semantics so screen readers can navigate
    // session rows as listbox items.
    this.listEl.setAttribute('role', 'listbox');
    this.listEl.setAttribute('aria-label', 'Chat sessions');
    this.listEl.addEventListener('mouseleave', () => this.setKbdIdx(-1));
    this.renderList();

    // Document-level keyboard navigation (capture phase, stopPropagation when
    // handled, so the underlying chat textarea doesn't also process arrows).
    this.keyHandler = (e: KeyboardEvent) => {
      if ((e as AnyValue).isComposing || (e as AnyValue).keyCode === 229) return;
      if (this.root.ownerDocument.querySelector('.menu, .modal-container')) return;
      if (this.renamingId || this.folderEditor !== null) return;
      if (e.key === 'Escape') { this.onClose(); e.preventDefault(); e.stopPropagation(); return; }
      if (e.target !== search && !this.listEl.contains(e.target as Node)) return;
      if ((e.target as Element)?.closest?.('button')) return;
      const n = this.kbdRows.length;
      if (n === 0) return;
      if (e.key === 'ArrowDown') {
        this.setKbdIdx(this.kbdIdx < 0 ? 0 : Math.min(n - 1, this.kbdIdx + 1));
        e.preventDefault(); e.stopPropagation();
      } else if (e.key === 'ArrowUp') {
        this.setKbdIdx(this.kbdIdx <= 0 ? 0 : this.kbdIdx - 1);
        e.preventDefault(); e.stopPropagation();
      } else if (e.key === 'Enter') {
        const s = this.kbdSessions[this.kbdIdx >= 0 ? this.kbdIdx : 0];
        if (s) { this.onPick(s); e.preventDefault(); e.stopPropagation(); }
      } else if (e.key === 'Escape') {
        this.onClose(); e.preventDefault(); e.stopPropagation();
      }
    };
    this.root.ownerDocument.addEventListener('keydown', this.keyHandler, true);
  }

  destroy() {
    if (this.keyHandler) {
      this.root.ownerDocument.removeEventListener('keydown', this.keyHandler, true);
      this.keyHandler = null;
    }
    this.root.empty();
  }

  private setKbdIdx(i: number) {
    this.kbdIdx = i;
    for (let k = 0; k < this.kbdRows.length; k++) {
      const r = this.kbdRows[k];
      const sel = k === i;
      r.classList.toggle('kbd-selected', sel);
      // a11y: mirror keyboard-cursor selection into aria-selected so
      // screen readers announce which option is active.
      r.setAttribute('aria-selected', sel ? 'true' : 'false');
    }
    const target = this.kbdRows[i];
    if (target) target.scrollIntoView({ block: 'nearest' });
  }

  private renderList() {
    this.listEl.empty();
    this.kbdRows = [];
    this.kbdSessions = [];
    const all = this.plugin.store.listSessions();
    const folders = this.plugin.store.listFolders();
    const sessions = all.filter(s => {
      if (this.folderId !== null && sessionFolder(s, folders) !== this.folderId) return false;
      if (!this.filter) return true;
      if (s.title.toLowerCase().includes(this.filter)) return true;
      return s.messages.some(m => (m.content ?? '').toLowerCase().includes(this.filter));
    });

    if (sessions.length === 0) {
      this.kbdIdx = -1;
      const empty = this.listEl.createDiv({ cls: 'nc-history-pop-empty' });
      empty.createDiv({
        text: this.filter ? t('hist_no_match') : t('hist_empty'),
        cls: 'nc-history-pop-empty-title',
      });
      return;
    }

    for (const s of sessions) {
      const row = this.renderRow(s);
      if (row) {
        this.kbdRows.push(row);
        this.kbdSessions.push(s);
      }
    }
    this.setKbdIdx(-1);
  }

  private renderFolders() {
    this.foldersEl.empty();
    const folders = this.plugin.store.listFolders();
    const sessions = this.plugin.store.listSessions();
    const choices = [
      { id: null, name: bi('All chats', '全部对话') },
      { id: '', name: bi('Unfiled', '未分类') },
      ...folders,
    ];
    for (const folder of choices) {
      const count = sessions.filter(s => folder.id === null || sessionFolder(s, folders) === folder.id).length;
      const button = this.foldersEl.createEl('button', { cls: 'nc-history-folder', text: `${folder.name} · ${count}` });
      button.type = 'button';
      button.setAttribute('aria-pressed', String(this.folderId === folder.id));
      button.onclick = () => { this.folderId = folder.id; this.renderFolders(); this.renderList(); };
      if (folder.id) button.oncontextmenu = e => {
        e.preventDefault();
        this.folderMenu(folder.id, folder.name, e);
      };
    }
    const create = this.foldersEl.createEl('button', { cls: 'nc-history-folder nc-history-folder-add', text: '+', attr: { 'aria-label': bi('New folder', '新建目录'), title: bi('New folder', '新建目录') } });
    create.onclick = () => this.editFolder('', '');
    if (this.folderId) {
      const manage = this.foldersEl.createEl('button', { cls: 'nc-history-folder', text: '···', attr: { 'aria-label': bi('Manage folder', '管理目录') } });
      manage.onclick = e => this.folderMenu(this.folderId, folders.find(f => f.id === this.folderId)?.name ?? '', e);
    }
  }

  private folderMenu(id: string, name: string, event: MouseEvent) {
    const menu = new Menu();
    menu.addItem(it => it.setTitle(bi('Rename folder', '重命名目录')).setIcon('pencil').onClick(() => this.editFolder(id, name)));
    menu.addItem(it => it.setTitle(bi('Remove folder · keep chats', '删除目录 · 保留对话')).setIcon('folder-minus').onClick(async () => {
      await this.plugin.store.deleteFolder(id);
      if (this.folderId === id) this.folderId = '';
      this.renderFolders(); this.renderList();
    }));
    menu.showAtMouseEvent(event);
  }

  private editFolder(id: string, name: string) {
    this.folderEditor = id;
    this.renderFolders();
    const form = this.foldersEl.createEl('form', { cls: 'nc-history-folder-form' });
    const input = form.createEl('input', { type: 'text', attr: { placeholder: bi('Folder name', '目录名称'), 'aria-label': bi('Folder name', '目录名称'), maxlength: '60' } });
    input.value = name;
    const save = form.createEl('button', { text: bi('Save', '保存') });
    save.type = 'submit';
    const cancel = form.createEl('button', { text: bi('Cancel', '取消') });
    cancel.type = 'button';
    const close = () => { this.folderEditor = null; this.renderFolders(); };
    cancel.onclick = close;
    input.onkeydown = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    form.onsubmit = e => {
      e.preventDefault();
      if (!input.value.trim() || save.disabled) return;
      save.disabled = true;
      void (async () => {
        if (id) await this.plugin.store.renameFolder(id, input.value);
        else this.folderId = (await this.plugin.store.createFolder(input.value))?.id ?? null;
        close(); this.renderList();
      })();
    };
    input.focus(); input.select();
  }

  private renderRow(s: ChatSession): HTMLElement | null {
    const row = this.listEl.createDiv({ cls: 'nc-history-pop-row' });
    // a11y: rows are option items within the listbox container. aria-selected
    // updates via the keyboard-nav cursor (this.kbdIdx) elsewhere.
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', 'false');
    row.setAttribute('tabindex', '-1');
    row.setAttribute('aria-label', `${s.title || bi('(untitled)', '（无标题）')} · ${this.relativeTime(s.updatedAt)}`);
    if (s.id === this.renamingId) { this.renderRenameInline(row, s); return null; }

    const title = row.createSpan({ cls: 'nc-history-pop-row-title', text: s.title || bi('(untitled)', '（无标题）') });
    title.title = title.textContent ?? '';
    const ago = row.createSpan({ cls: 'nc-history-pop-row-ago', text: this.relativeTime(s.updatedAt) });
    ago.title = new Date(s.updatedAt).toLocaleString();
    const actions = row.createEl('button', { cls: 'nc-history-row-more', text: '···', attr: { 'aria-label': bi('Chat actions', '对话操作') } });
    actions.onclick = e => { e.stopPropagation(); this.openRowMenu(s, e); };

    row.onclick = () => this.onPick(s);
    // Mouse hover syncs the keyboard cursor only after the pointer actually
    // enters a row. Opening the popover itself does not pre-highlight row 0.
    row.addEventListener('mousemove', () => {
      const idx = this.kbdRows.indexOf(row);
      if (idx >= 0 && idx !== this.kbdIdx) this.setKbdIdx(idx);
    });

    row.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault();
      this.openRowMenu(s, e);
    });
    return row;
  }

  private openRowMenu(s: ChatSession, e: MouseEvent) {
      const menu = new Menu();
      menu.addItem(it => it.setTitle(t('hist_open')).setIcon('arrow-right').onClick(() => this.onPick(s)));
      menu.addItem(it => it.setTitle(t('hist_rename')).setIcon('pencil').onClick(() => { this.renamingId = s.id; this.renderList(); }));
      menu.addItem(it => it.setTitle(t('hist_duplicate')).setIcon('copy').onClick(async () => { await this.plugin.store.duplicateSession(s.id); this.renderList(); }));
      menu.addItem(it => it.setTitle(bi('Move to folder…', '移动到目录…')).setIcon('folder-input').onClick(() => {
        const picker = new Menu();
        for (const folder of [{ id: '', name: bi('Unfiled', '未分类') }, ...this.plugin.store.listFolders()]) {
          picker.addItem(it => it.setTitle(folder.name).setIcon('folder').setChecked((s.folderId ?? '') === folder.id).onClick(async () => {
            await this.plugin.store.moveSession(s.id, folder.id);
            this.renderFolders(); this.renderList();
          }));
        }
        picker.showAtMouseEvent(e);
      }));
      menu.addSeparator();
      menu.addItem(it => it.setTitle(t('hist_delete')).setIcon('trash').setWarning(true).onClick(async () => {
        const { confirmModal } = await import('./confirm_modal');
        if (!await confirmModal(this.plugin.app, { title: t('hist_delete'), body: t('hist_delete_confirm'), danger: true })) return;
        await this.plugin.store.deleteSession(s.id);
        this.onDelete?.(s.id);
        this.renderFolders();
        this.renderList();
      }));
      menu.showAtMouseEvent(e);
  }

  private renderRenameInline(row: HTMLElement, s: ChatSession) {
    row.addClass('renaming');
    const input = row.createEl('input', { cls: 'nc-history-pop-rename', type: 'text' });
    input.value = s.title;
    input.placeholder = bi('Title', '标题');
    let settled = false;
    const commit = async () => {
      if (settled) return;
      settled = true;
      const v = input.value.trim() || bi('(untitled)', '（无标题）');
      await this.plugin.store.renameSession(s.id, v);
      this.renamingId = null;
      this.renderList();
    };
    const cancel = () => { settled = true; this.renamingId = null; this.renderList(); };
    input.onkeydown = (e) => {
      if (e.key === 'Enter')  { e.preventDefault(); void commit(); }
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    };
    input.onblur = () => { void commit(); };
    window.setTimeout(() => { input.focus(); input.select(); }, 10);
  }

  private openOverflowMenu(e: MouseEvent, anchor: HTMLElement) {
    e.stopPropagation();
    const menu = new Menu();
    menu.addItem(it => it.setTitle(t('hist_purge_old')).setIcon('clock').onClick(async () => {
      const cutoff = Date.now() - 7 * 24 * 3600_000;
      const old = this.plugin.store.listSessions().filter(s => s.updatedAt < cutoff);
      if (old.length === 0) { new Notice(bi('Nothing older than 7 days.', '没有 7 天前的对话。')); return; }
      const { confirmModal } = await import('./confirm_modal');
      if (!await confirmModal(this.plugin.app, {
        title: bi('Purge old chats', '清理旧对话'),
        body: bi(`Delete ${old.length} session(s) older than 7 days?`, `删除 ${old.length} 条 7 天前的对话？`),
        danger: true,
      })) return;
      for (const s of old) {
        await this.plugin.store.deleteSession(s.id);
        this.onDelete?.(s.id);
      }
      this.renderList();
      new Notice(bi(`Deleted ${old.length} session(s).`, `已删除 ${old.length} 条对话。`));
    }));
    menu.addSeparator();
    menu.addItem(it => it.setTitle(t('hist_clear_all')).setIcon('trash').setWarning(true).onClick(async () => {
      const { confirmModal } = await import('./confirm_modal');
      if (!await confirmModal(this.plugin.app, {
        title: bi('Clear all chat history', '清空全部对话'),
        body: bi('Delete ALL chat history? This cannot be undone.', '确认清空全部历史？此操作无法撤销。'),
        danger: true,
      })) return;
      await this.plugin.store.clearAll();
      this.onClear?.();
      this.renderList();
      new Notice(bi('All chats deleted.', '已清空全部对话。'));
    }));
    const r = anchor.getBoundingClientRect();
    menu.showAtPosition({ x: r.right - 4, y: r.bottom + 4 });
  }

  /** Compact relative-time string for the trailing pill. */
  private relativeTime(ts: number): string {
    const diff = (Date.now() - ts) / 1000;
    if (diff < 60)        return bi(`${Math.max(1, Math.round(diff))}s`, `${Math.max(1, Math.round(diff))}秒`);
    if (diff < 3600)      return bi(`${Math.round(diff / 60)}m`,         `${Math.round(diff / 60)}分`);
    if (diff < 86400)     return bi(`${Math.round(diff / 3600)}h`,       `${Math.round(diff / 3600)}时`);
    if (diff < 7 * 86400) return bi(`${Math.round(diff / 86400)}d`,      `${Math.round(diff / 86400)}天`);
    return bi(`${Math.round(diff / (7 * 86400))}w`, `${Math.round(diff / (7 * 86400))}周`);
  }
}

/* ============================================================
   Legacy Modal wrapper — used only from the command palette.
   Wraps the same HistoryPopover renderer inside a centered Modal.
   ============================================================ */

class HistoryModal extends Modal {
  private view!: HistoryPopover;
  constructor(app: App, private plugin: GlossaPlugin, private onPickCb: (s: ChatSession) => void) { super(app); }
  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass('nc-history-modal');
    contentEl.empty();
    this.view = new HistoryPopover(contentEl, this.plugin, (s) => { this.onPickCb(s); this.close(); }, () => this.close());
    this.view.render();
  }
  onClose() { this.view?.destroy(); }
}
