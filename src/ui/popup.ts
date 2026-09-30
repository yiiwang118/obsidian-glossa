import { el, clear, setStyle, setTrustedSvg } from '../utils/dom';

export interface PopupItem {
  label: string;
  hint?: string;
  iconSvg?: string;
  section?: string;
  /** Show a small ✓ before the label — used by the composer pickers
   *  (model / permission / reasoning) to indicate the current value. */
  checked?: boolean;
  /** Preserve a provider's brand icon and show its selection mark at the end. */
  trailingCheck?: boolean;
  /** Paint the row in danger colour for destructive actions. */
  danger?: boolean;
  searchText?: string;
  /** Keep management actions available while filtering model choices. */
  alwaysVisible?: boolean;
  onSelect: () => void | Promise<void>;
}

export interface PopupOptions {
  searchPlaceholder?: string;
  emptyText?: string;
}

export function filterPopupItems(items: PopupItem[], query: string): PopupItem[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  if (!words.length) return items;
  const matches = items.filter(item => !item.alwaysVisible && words.every(word =>
    [item.label, item.section, item.hint, item.searchText].filter(Boolean).join(' ').toLocaleLowerCase().includes(word)));
  return [...matches, ...items.filter(item => item.alwaysVisible)];
}

export class Popup {
  private static instances = new Set<Popup>();
  private el: HTMLElement | null = null;
  private ownerDocument: Document | null = null;
  private ownerWindow: Window | null = null;
  private positionFrame: number | null = null;
  private outsideTimer: number | null = null;
  private itemEls: HTMLElement[] = [];
  private selectedIdx = -1;
  private items: PopupItem[] = [];
  private allItems: PopupItem[] = [];
  private listEl: HTMLElement | null = null;
  private searchEl: HTMLInputElement | null = null;
  private options: PopupOptions = {};
  private static nextListId = 0;
  private outsideClickHandler: ((e: MouseEvent) => void) | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private anchor: HTMLElement | null = null;
  private open = false;

  constructor() {
    Popup.instances.add(this);
  }

  private createElement(ownerDocument: Document): void {
    this.el = el('div', { className: 'nc-popup', parent: ownerDocument.body });
    this.el.setAttribute('role', 'listbox');
    this.el.setAttribute('aria-label', 'Glossa menu');
    setStyle(this.el, { display: 'none' });
    this.el.addEventListener('mousedown', (e) => e.stopPropagation());
    // When the cursor leaves the popup, drop the mouse-induced `.selected`
    // highlight from every row. `.checked` (the row marking the current
    // setting) is intentionally NOT touched — that's a persistent
    // indicator, not a hover residue. Keyboard navigation still works:
    // ArrowDown/Up rebuilds `.selected` via render() so the cursor
    // resumes naturally from wherever it was.
    this.el.addEventListener('mouseleave', () => {
      this.selectedIdx = -1;
      for (const item of this.itemEls) item.classList.remove('selected');
    });
  }

  destroy() {
    this.hide();
    Popup.instances.delete(this);
  }

  show(anchor: HTMLElement, items: PopupItem[], options: PopupOptions = {}) {
    this.hide();
    const ownerDocument = anchor.ownerDocument;
    const ownerWindow = ownerDocument.defaultView;
    if (!ownerWindow) return;
    this.hidePeers(ownerDocument);
    if (this.el?.ownerDocument !== ownerDocument) {
      this.el?.remove();
      this.createElement(ownerDocument);
    }
    const popup = this.el;
    if (!popup) return;
    this.ownerDocument = ownerDocument;
    this.ownerWindow = ownerWindow;
    this.items = items;
    this.allItems = items;
    this.options = options;
    this.anchor = anchor;
    this.anchor.setAttribute('aria-expanded', 'true');
    this.selectedIdx = -1;
    if (options.searchPlaceholder) {
      popup.classList.add('nc-popup-searchable');
      popup.setAttribute('role', 'dialog');
      popup.setAttribute('aria-label', options.searchPlaceholder);
      const searchWrap = el('div', { className: 'nc-popup-search-wrap', parent: popup });
      this.searchEl = el('input', { className: 'nc-popup-search', type: 'search', parent: searchWrap });
      this.searchEl.placeholder = options.searchPlaceholder;
      this.searchEl.setAttribute('aria-label', options.searchPlaceholder);
      this.searchEl.setAttribute('role', 'combobox');
      this.searchEl.setAttribute('aria-expanded', 'true');
      this.searchEl.setAttribute('aria-autocomplete', 'list');
      this.listEl = el('div', { className: 'nc-popup-results', parent: popup, attrs: { role: 'listbox' } });
      this.listEl.id = `glossa-popup-list-${++Popup.nextListId}`;
      this.listEl.setAttribute('aria-label', options.searchPlaceholder);
      this.searchEl.setAttribute('aria-controls', this.listEl.id);
      this.selectedIdx = items.findIndex(item => item.checked);
      this.searchEl.addEventListener('input', () => {
        this.items = filterPopupItems(this.allItems, this.searchEl?.value ?? '');
        this.selectedIdx = this.items.findIndex(item => !item.alwaysVisible);
        this.render();
      });
    }
    this.render();
    this.open = true;
    popup.classList.add('nc-popup-positioning');
    setStyle(popup, { display: this.searchEl ? 'flex' : 'block' });

    this.positionFrame = ownerWindow.requestAnimationFrame(() => {
      this.positionFrame = null;
      if (!this.open || this.anchor !== anchor) return;
      const r = anchor.getBoundingClientRect();
      const rect = popup.getBoundingClientRect();
      const vw = ownerWindow.innerWidth, vh = ownerWindow.innerHeight;
      const popupH = rect.height;
      const popupW = Math.min(rect.width, 360);

      // Prefer ABOVE the anchor; fall back BELOW when there's no room.
      const spaceAbove = r.top;
      const spaceBelow = vh - r.bottom;
      let top: number;
      if (spaceAbove >= popupH + 8 || spaceAbove >= spaceBelow) {
        top = r.top - popupH - 6;
      } else {
        top = r.bottom + 6;
      }
      top = Math.max(6, Math.min(vh - popupH - 6, top));

      let left = r.left;
      left = Math.max(6, Math.min(vw - popupW - 6, left));

      setStyle(popup, { left: left + 'px' });
      setStyle(popup, { top: top  + 'px' });
      popup.classList.remove('nc-popup-positioning');
      this.searchEl?.focus({ preventScroll: true });
      this.scrollSelectedIntoView();
    });
    this.installOutsideHandler();
    this.installKeyHandler();
  }

  hide() {
    this.open = false;
    this.anchor?.setAttribute('aria-expanded', 'false');
    this.anchor = null;
    if (this.positionFrame !== null) this.ownerWindow?.cancelAnimationFrame(this.positionFrame);
    this.positionFrame = null;
    this.items = [];
    this.allItems = [];
    this.itemEls = [];
    this.searchEl = null;
    this.listEl = null;
    this.options = {};
    this.removeOutsideHandler();
    this.removeKeyHandler();
    // A closed menu must not retain a detached window or setting-row callbacks.
    this.el?.remove();
    this.el = null;
    this.ownerDocument = null;
    this.ownerWindow = null;
  }

  /** Body-level popups are shared visual chrome. Only one should ever be
   *  visible; otherwise model/context/slash menus can visually overlap. */
  private hidePeers(ownerDocument: Document) {
    for (const popup of Popup.instances) {
      if (popup !== this) popup.hide();
    }
    for (const node of Array.from(ownerDocument.querySelectorAll<HTMLElement>('.nc-popup'))) {
      if (node !== this.el) setStyle(node, { display: 'none' });
    }
  }

  isOpen() { return this.open; }
  /** The DOM element this popup is currently anchored to (set on show()).
   *  Callers compare it via identity to implement click-the-same-trigger-to-
   *  toggle semantics: if the anchor matches, hide; otherwise show with
   *  the new anchor. */
  currentAnchor(): HTMLElement | null { return this.anchor; }

  onKey(e: KeyboardEvent): boolean {
    if (!this.isOpen()) return false;
    if (e.key === 'Tab' && this.searchEl) {
      const anchor = this.anchor;
      this.hide();
      anchor?.focus();
      return false;
    }
    if (e.key === 'ArrowDown') {
      this.selectedIdx = this.selectedIdx < 0 ? 0 : Math.min(this.items.length - 1, this.selectedIdx + 1);
      this.render(); this.scrollSelectedIntoView(); return true;
    }
    if (e.key === 'ArrowUp') {
      this.selectedIdx = this.selectedIdx < 0 ? this.items.length - 1 : Math.max(0, this.selectedIdx - 1);
      this.render(); this.scrollSelectedIntoView(); return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      if (this.searchEl?.value.trim() && this.selectedIdx < 0) return true;
      const it = this.items[this.selectedIdx >= 0 ? this.selectedIdx : 0];
      if (it) {
        const res = it.onSelect();
        this.hide();
        if (res && typeof (res as AnyValue).then === 'function') (res as AnyValue).catch(() => {});
      }
      return true;
    }
    if (e.key === 'Escape') {
      const anchor = this.searchEl ? this.anchor : null;
      this.hide();
      anchor?.focus();
      return true;
    }
    return false;
  }

  /** Document-level key handler so the popup responds to ↑/↓/Enter/Esc when
   *  the user opens it from a pill button (the textarea isn't focused in that
   *  case, so the textarea's keydown bridge to onKey() wouldn't fire). Capture
   *  phase + stopPropagation prevents the textarea from also consuming the
   *  same arrow key for caret movement. */
  private installKeyHandler() {
    this.removeKeyHandler();
    this.keyHandler = (e: KeyboardEvent) => {
      if (!this.isOpen()) return;
      // IME composition — let the input method handle Enter / arrows.
      if ((e as AnyValue).isComposing || (e as AnyValue).keyCode === 229) return;
      if (this.onKey(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    this.ownerDocument?.addEventListener('keydown', this.keyHandler, true);
  }
  private removeKeyHandler() {
    if (this.keyHandler) {
      this.ownerDocument?.removeEventListener('keydown', this.keyHandler, true);
      this.keyHandler = null;
    }
  }

  private installOutsideHandler() {
    this.removeOutsideHandler();
    this.outsideClickHandler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (this.el?.contains(t)) return;
      if (this.anchor && this.anchor.contains(t)) return;
      this.hide();
    };
    const ownerDocument = this.ownerDocument;
    const handler = this.outsideClickHandler;
    this.outsideTimer = this.ownerWindow?.setTimeout(() => {
      this.outsideTimer = null;
      if (this.open && this.outsideClickHandler === handler) {
        ownerDocument?.addEventListener('mousedown', handler);
      }
    }, 0) ?? null;
  }
  private removeOutsideHandler() {
    if (this.outsideTimer !== null) this.ownerWindow?.clearTimeout(this.outsideTimer);
    this.outsideTimer = null;
    if (this.outsideClickHandler) {
      this.ownerDocument?.removeEventListener('mousedown', this.outsideClickHandler);
      this.outsideClickHandler = null;
    }
  }

  private scrollSelectedIntoView() {
    const target = this.itemEls[this.selectedIdx];
    if (target) target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  private render() {
    const popup = this.listEl ?? this.el;
    if (!popup) return;
    clear(popup);
    this.itemEls = [];
    if (this.searchEl && !this.items.some(item => !item.alwaysVisible)) {
      el('div', { className: 'nc-popup-empty', text: this.options.emptyText ?? '', parent: popup, attrs: { role: 'status' } });
    }
    let lastSection: string | undefined;
    this.items.forEach((it, i) => {
      if (it.section && it.section !== lastSection) {
        el('div', { className: 'nc-popup-section', text: it.section, parent: popup, attrs: { role: 'presentation' } });
        lastSection = it.section;
      }
      const row = el('div', {
        className: 'nc-popup-item'
          + (i === this.selectedIdx ? ' selected' : '')
          + (it.checked ? ' checked' : '')
          + (it.danger ? ' danger' : ''),
        parent: popup,
      });
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(i === this.selectedIdx));
      if (this.listEl) row.id = `${this.listEl.id}-${i}`;
      row.setAttribute('aria-label', it.hint ? `${it.label}, ${it.hint}` : it.label);
      row.tabIndex = -1;
      row.addEventListener('mousemove', () => {
        if (this.selectedIdx === i) return;
        if (this.selectedIdx >= 0) this.itemEls[this.selectedIdx]?.classList.remove('selected');
        this.selectedIdx = i;
        this.itemEls[i]?.classList.add('selected');
      });
      row.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const res = it.onSelect();
        this.hide();
        // If async, swallow so a thrown rejection doesn't surface as an unhandled promise.
        if (res && typeof (res as AnyValue).then === 'function') (res as AnyValue).catch(() => {});
      });

      // Leading column: ✓ when checked, else icon (if provided), else spacer.
      const lead = el('span', { className: 'nc-popup-icon', parent: row });
      if (it.checked && !it.trailingCheck) {
        setTrustedSvg(lead, `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`);
        lead.classList.add('nc-popup-check');
      } else if (it.iconSvg) {
        setTrustedSvg(lead, it.iconSvg);
      }
      el('span', { className: 'nc-popup-label', text: it.label, parent: row });
      if (it.hint) el('span', { className: 'nc-popup-hint', text: it.hint, parent: row });
      if (it.checked && it.trailingCheck) el('span', { className: 'nc-popup-trailing-check', text: '✓', parent: row, attrs: { 'aria-hidden': 'true' } });
      this.itemEls.push(row);
    });
    const selected = this.itemEls[this.selectedIdx];
    if (selected && this.searchEl) this.searchEl.setAttribute('aria-activedescendant', selected.id);
    else this.searchEl?.removeAttribute('aria-activedescendant');
  }
}
