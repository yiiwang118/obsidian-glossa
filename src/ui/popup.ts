/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- Dynamic plugin, model, and vault payloads are validated at runtime boundaries. */
import { el, clear, setStyle, setTrustedSvg } from '../utils/dom';

export interface PopupItem {
  label: string;
  hint?: string;
  iconSvg?: string;
  section?: string;
  /** Show a small ✓ before the label — used by the composer pickers
   *  (model / permission / reasoning) to indicate the current value. */
  checked?: boolean;
  /** Paint the row in danger colour for destructive actions. */
  danger?: boolean;
  onSelect: () => void | Promise<void>;
}

export class Popup {
  private static instances = new Set<Popup>();
  private el: HTMLElement;
  private itemEls: HTMLElement[] = [];
  private selectedIdx = -1;
  private items: PopupItem[] = [];
  private outsideClickHandler: ((e: MouseEvent) => void) | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private anchor: HTMLElement | null = null;
  private open = false;

  constructor() {
    Popup.instances.add(this);
    this.el = el('div', { className: 'nc-popup' });
    this.el.setAttribute('role', 'listbox');
    this.el.setAttribute('aria-label', 'Glossa menu');
    setStyle(this.el, { display: 'none' });
    activeDocument.body.appendChild(this.el);
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
    this.removeOutsideHandler();
    this.removeKeyHandler();
    Popup.instances.delete(this);
    this.el.remove();
  }

  show(anchor: HTMLElement, items: PopupItem[]) {
    this.hidePeers();
    this.items = items;
    this.anchor = anchor;
    this.anchor.setAttribute('aria-expanded', 'true');
    this.selectedIdx = -1;
    this.render();
    this.open = true;
    setStyle(this.el, { display: 'block' });

    window.requestAnimationFrame(() => {
      const r = anchor.getBoundingClientRect();
      const rect = this.el.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      const popupH = Math.min(rect.height, 320);
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

      setStyle(this.el, { left: left + 'px' });
      setStyle(this.el, { top: top  + 'px' });
    });
    this.installOutsideHandler();
    this.installKeyHandler();
  }

  hide() {
    this.open = false;
    this.anchor?.setAttribute('aria-expanded', 'false');
    setStyle(this.el, { display: 'none' });
    this.items = [];
    this.itemEls = [];
    this.removeOutsideHandler();
    this.removeKeyHandler();
  }

  /** Body-level popups are shared visual chrome. Only one should ever be
   *  visible; otherwise model/context/slash menus can visually overlap. */
  private hidePeers() {
    for (const popup of Popup.instances) {
      if (popup !== this) popup.hide();
    }
    for (const node of Array.from(activeDocument.querySelectorAll<HTMLElement>('.nc-popup'))) {
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
    if (e.key === 'ArrowDown') {
      this.selectedIdx = this.selectedIdx < 0 ? 0 : Math.min(this.items.length - 1, this.selectedIdx + 1);
      this.render(); this.scrollSelectedIntoView(); return true;
    }
    if (e.key === 'ArrowUp') {
      this.selectedIdx = this.selectedIdx < 0 ? this.items.length - 1 : Math.max(0, this.selectedIdx - 1);
      this.render(); this.scrollSelectedIntoView(); return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      const it = this.items[this.selectedIdx >= 0 ? this.selectedIdx : 0];
      if (it) {
        const res = it.onSelect();
        this.hide();
        if (res && typeof (res as any).then === 'function') (res as any).catch(() => {});
      }
      return true;
    }
    if (e.key === 'Escape') { this.hide(); return true; }
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
      if ((e as any).isComposing || (e as any).keyCode === 229) return;
      if (this.onKey(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    activeDocument.addEventListener('keydown', this.keyHandler, true);
  }
  private removeKeyHandler() {
    if (this.keyHandler) {
      activeDocument.removeEventListener('keydown', this.keyHandler, true);
      this.keyHandler = null;
    }
  }

  private installOutsideHandler() {
    this.removeOutsideHandler();
    this.outsideClickHandler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (this.el.contains(t)) return;
      if (this.anchor && this.anchor.contains(t)) return;
      this.hide();
    };
    window.setTimeout(() => activeDocument.addEventListener('mousedown', this.outsideClickHandler), 0);
  }
  private removeOutsideHandler() {
    if (this.outsideClickHandler) {
      activeDocument.removeEventListener('mousedown', this.outsideClickHandler);
      this.outsideClickHandler = null;
    }
  }

  private scrollSelectedIntoView() {
    const target = this.itemEls[this.selectedIdx];
    if (target) target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  private render() {
    clear(this.el);
    this.itemEls = [];
    let lastSection: string | undefined;
    this.items.forEach((it, i) => {
      if (it.section && it.section !== lastSection) {
        el('div', { className: 'nc-popup-section', text: it.section, parent: this.el, attrs: { role: 'presentation' } });
        lastSection = it.section;
      }
      const row = el('div', {
        className: 'nc-popup-item'
          + (i === this.selectedIdx ? ' selected' : '')
          + (it.checked ? ' checked' : '')
          + (it.danger ? ' danger' : ''),
        parent: this.el,
      });
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(i === this.selectedIdx));
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
        if (res && typeof (res as any).then === 'function') (res as any).catch(() => {});
      });

      // Leading column: ✓ when checked, else icon (if provided), else spacer.
      const lead = el('span', { className: 'nc-popup-icon', parent: row });
      if (it.checked) {
        setTrustedSvg(lead, `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`);
        lead.classList.add('nc-popup-check');
      } else if (it.iconSvg) {
        setTrustedSvg(lead, it.iconSvg);
      }
      el('span', { className: 'nc-popup-label', text: it.label, parent: row });
      if (it.hint) el('span', { className: 'nc-popup-hint', text: it.hint, parent: row });
      this.itemEls.push(row);
    });
  }
}
