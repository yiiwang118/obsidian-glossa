import { App, Menu, Modal, Notice } from 'obsidian';
import type GlossaPlugin from '../main';
import type { ChatSession } from '../types';
import { debounce } from '../utils/dom';
import { t, bi } from '../utils/i18n';

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
  opts: { onPick: (s: ChatSession) => void; onClose: () => void },
): () => void {
  const view = new HistoryPopover(host, plugin, opts.onPick, opts.onClose);
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
  ) {}

  render() {
    this.root.empty();
    this.root.addClass('nc-history-pop');

    // Top bar: search + overflow menu.
    const top = this.root.createEl('div', { cls: 'nc-history-pop-top' });
    const searchWrap = top.createEl('div', { cls: 'nc-history-pop-search' });
    const searchIcon = searchWrap.createEl('span', { cls: 'nc-history-pop-search-icon' });
    searchIcon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`;
    const search = searchWrap.createEl('input', { type: 'text', cls: 'nc-history-pop-search-input' });
    search.placeholder = t('hist_search');
    const onSearch = debounce(() => { this.filter = search.value.toLowerCase(); this.renderList(); }, 80);
    search.addEventListener('input', onSearch);
    setTimeout(() => search.focus(), 30);

    const moreBtn = top.createEl('button', { cls: 'nc-history-pop-more', attr: { title: t('more') } });
    // Filled dots — Lucide's stroke-only r=1 dots are too tiny to see at 14px,
    // so we use solid fill with r=1.6.
    moreBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14"><circle cx="5"  cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/></svg>`;
    moreBtn.onclick = (e) => this.openOverflowMenu(e, moreBtn);

    // List body — flex-grow, scrollable.
    this.listEl = this.root.createEl('div', { cls: 'nc-history-pop-list' });
    // a11y: announce the list semantics so screen readers can navigate
    // session rows as listbox items.
    this.listEl.setAttribute('role', 'listbox');
    this.listEl.setAttribute('aria-label', 'Chat sessions');
    this.listEl.addEventListener('mouseleave', () => this.setKbdIdx(-1));
    this.renderList();

    // Document-level keyboard navigation (capture phase, stopPropagation when
    // handled, so the underlying chat textarea doesn't also process arrows).
    this.keyHandler = (e: KeyboardEvent) => {
      if ((e as any).isComposing || (e as any).keyCode === 229) return;
      if (this.renamingId) return;     // rename input handles its own keys
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
    document.addEventListener('keydown', this.keyHandler, true);
  }

  destroy() {
    if (this.keyHandler) {
      document.removeEventListener('keydown', this.keyHandler, true);
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
    const sessions = all.filter(s => {
      if (!this.filter) return true;
      if (s.title.toLowerCase().includes(this.filter)) return true;
      return s.messages.some(m => (m.content ?? '').toLowerCase().includes(this.filter));
    });

    if (sessions.length === 0) {
      this.kbdIdx = -1;
      const empty = this.listEl.createEl('div', { cls: 'nc-history-pop-empty' });
      empty.createEl('div', {
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

  private renderRow(s: ChatSession): HTMLElement | null {
    const row = this.listEl.createEl('div', { cls: 'nc-history-pop-row' });
    // a11y: rows are option items within the listbox container. aria-selected
    // updates via the keyboard-nav cursor (this.kbdIdx) elsewhere.
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', 'false');
    row.setAttribute('tabindex', '-1');
    if (s.id === this.renamingId) { this.renderRenameInline(row, s); return null; }

    const title = row.createEl('span', { cls: 'nc-history-pop-row-title', text: s.title || bi('(untitled)', '（无标题）') });
    title.title = title.textContent ?? '';
    const ago = row.createEl('span', { cls: 'nc-history-pop-row-ago', text: this.relativeTime(s.updatedAt) });
    ago.title = new Date(s.updatedAt).toLocaleString();

    row.onclick = () => this.onPick(s);
    // Mouse hover syncs the keyboard cursor only after the pointer actually
    // enters a row. Opening the popover itself does not pre-highlight row 0.
    row.addEventListener('mousemove', () => {
      const idx = this.kbdRows.indexOf(row);
      if (idx >= 0 && idx !== this.kbdIdx) this.setKbdIdx(idx);
    });

    row.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault();
      const menu = new Menu();
      menu.addItem(it => it.setTitle(t('hist_open')).setIcon('arrow-right').onClick(() => this.onPick(s)));
      menu.addItem(it => it.setTitle(t('hist_rename')).setIcon('pencil').onClick(() => { this.renamingId = s.id; this.renderList(); }));
      menu.addItem(it => it.setTitle(t('hist_duplicate')).setIcon('copy').onClick(async () => { await this.plugin.store.duplicateSession(s.id); this.renderList(); }));
      menu.addSeparator();
      menu.addItem(it => it.setTitle(t('hist_delete')).setIcon('trash').setWarning(true).onClick(async () => {
        const { confirmModal } = await import('./confirm_modal');
        if (!await confirmModal(this.plugin.app, { title: t('hist_delete'), body: t('hist_delete_confirm'), danger: true })) return;
        await this.plugin.store.deleteSession(s.id);
        this.renderList();
      }));
      menu.showAtMouseEvent(e);
    });
    return row;
  }

  private renderRenameInline(row: HTMLElement, s: ChatSession) {
    row.addClass('renaming');
    const input = row.createEl('input', { cls: 'nc-history-pop-rename', type: 'text' });
    input.value = s.title;
    input.placeholder = bi('Title', '标题');
    const commit = async () => {
      const v = input.value.trim() || bi('(untitled)', '（无标题）');
      await this.plugin.store.renameSession(s.id, v);
      this.renamingId = null;
      this.renderList();
    };
    const cancel = () => { this.renamingId = null; this.renderList(); };
    input.onkeydown = (e) => {
      if (e.key === 'Enter')  { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    };
    input.onblur = () => commit();
    setTimeout(() => { input.focus(); input.select(); }, 10);
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
      for (const s of old) await this.plugin.store.deleteSession(s.id);
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
