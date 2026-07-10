
/**
 * Glossa-styled replacements for window.confirm / window.prompt.
 *
 * Why: native dialogs in Electron break visual rhythm (system widget on top
 * of a polished sidebar), trap focus weirdly, and on some macOS builds they
 * dismiss the whole Obsidian window when ESC is pressed mid-typing.
 * Custom modals keep the UX coherent and respect Obsidian's theming.
 *
 * Both helpers return Promise<boolean> / Promise<string|null> so callers
 * can `await` like the native APIs they replace. Cmd/Ctrl+Enter confirms,
 * Esc cancels.
 */
import { App, Modal } from 'obsidian';
import { setStyle } from '../utils/dom';

class ConfirmModal extends Modal {
  private decided = false;
  constructor(
    app: App,
    private opts: { title: string; body: string; confirmText?: string; cancelText?: string; danger?: boolean },
    private onDecide: (ok: boolean) => void,
  ) { super(app); }

  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass('nc-confirm-modal');
    contentEl.empty();
    contentEl.createEl('h3', { text: this.opts.title });
    // Preserve newlines / indentation in the body (most call sites use
    // multi-line text to show command + args + scope).
    const bodyEl = contentEl.createEl('div', { cls: 'nc-confirm-body' });
    setStyle(bodyEl, { whiteSpace: 'pre-wrap' });
    setStyle(bodyEl, { fontSize: '13px' });
    setStyle(bodyEl, { lineHeight: '1.55' });
    setStyle(bodyEl, { padding: '6px 0 16px' });
    bodyEl.textContent = this.opts.body;

    const row = contentEl.createEl('div', { cls: 'nc-confirm-actions' });
    setStyle(row, { display: 'flex' });
    setStyle(row, { gap: '8px' });
    setStyle(row, { justifyContent: 'flex-end' });

    const cancelBtn = row.createEl('button', { text: this.opts.cancelText ?? 'Cancel' });
    cancelBtn.onclick = () => this.finish(false);

    const okBtn = row.createEl('button', { text: this.opts.confirmText ?? 'Confirm', cls: 'mod-cta' });
    if (this.opts.danger) okBtn.addClass('mod-warning');
    okBtn.onclick = () => this.finish(true);
    // Auto-focus the safe choice when danger — confirm should not be a single
    // muscle-memory Enter when the action is destructive.
    (this.opts.danger ? cancelBtn : okBtn).focus();

    contentEl.tabIndex = 0;
    contentEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); this.finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); this.finish(false); }
    });
  }

  private finish(ok: boolean) {
    if (this.decided) return;
    this.decided = true;
    this.onDecide(ok);
    this.close();
  }
  onClose() { if (!this.decided) { this.decided = true; this.onDecide(false); } }
}

class PromptModal extends Modal {
  private decided = false;
  constructor(
    app: App,
    private opts: { title: string; body?: string; placeholder?: string; defaultValue?: string; multiline?: boolean },
    private onDecide: (value: string | null) => void,
  ) { super(app); }

  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass('nc-prompt-modal');
    contentEl.empty();
    contentEl.createEl('h3', { text: this.opts.title });
    if (this.opts.body) {
      const bodyEl = contentEl.createEl('div', { cls: 'nc-prompt-body' });
      setStyle(bodyEl, { whiteSpace: 'pre-wrap' });
      setStyle(bodyEl, { fontSize: '13px' });
      setStyle(bodyEl, { opacity: '0.85' });
      setStyle(bodyEl, { padding: '4px 0 10px' });
      bodyEl.textContent = this.opts.body;
    }
    const inputEl = this.opts.multiline
      ? contentEl.createEl('textarea')
      : contentEl.createEl('input', { type: 'text' });
    setStyle(inputEl, { width: '100%' });
    if (this.opts.multiline) (inputEl as HTMLTextAreaElement).rows = 4;
    if (this.opts.placeholder) inputEl.placeholder = this.opts.placeholder;
    if (this.opts.defaultValue != null) inputEl.value = this.opts.defaultValue;
    window.setTimeout(() => inputEl.focus(), 0);

    const row = contentEl.createEl('div', { cls: 'nc-prompt-actions' });
    setStyle(row, { display: 'flex' });
    setStyle(row, { gap: '8px' });
    setStyle(row, { justifyContent: 'flex-end' });
    setStyle(row, { marginTop: '12px' });
    const cancelBtn = row.createEl('button', { text: 'Cancel' });
    cancelBtn.onclick = () => this.finish(null);
    const okBtn = row.createEl('button', { text: 'OK', cls: 'mod-cta' });
    okBtn.onclick = () => this.finish(inputEl.value);

    inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (!this.opts.multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); this.finish(inputEl.value); }
      else if (e.key === 'Escape') { e.preventDefault(); this.finish(null); }
    });
  }

  private finish(v: string | null) {
    if (this.decided) return;
    this.decided = true;
    this.onDecide(v);
    this.close();
  }
  onClose() { if (!this.decided) { this.decided = true; this.onDecide(null); } }
}

/** Promise-returning yes/no modal. */
export function confirmModal(
  app: App,
  opts: { title: string; body: string; confirmText?: string; cancelText?: string; danger?: boolean },
): Promise<boolean> {
  return new Promise(resolve => new ConfirmModal(app, opts, resolve).open());
}

/** Promise-returning text-entry modal. Returns null on cancel. */
export function promptModal(
  app: App,
  opts: { title: string; body?: string; placeholder?: string; defaultValue?: string; multiline?: boolean },
): Promise<string | null> {
  return new Promise(resolve => new PromptModal(app, opts, resolve).open());
}
