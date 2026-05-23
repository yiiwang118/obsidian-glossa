import { App, Modal } from 'obsidian';
import { t } from '../utils/i18n';

export function askPassphrase(app: App, mode: 'unlock' | 'set'): Promise<string | null> {
  return new Promise(resolve => new PassphraseModal(app, mode, resolve).open());
}

class PassphraseModal extends Modal {
  private decided = false;
  constructor(app: App, private mode: 'unlock' | 'set', private cb: (v: string | null) => void) { super(app); }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h3', { text: this.mode === 'set' ? t('pp_set_title') : t('pp_unlock_title') });
    contentEl.createEl('p', {
      cls: 'nc-approval-sub',
      text: this.mode === 'set' ? t('pp_set_desc') : t('pp_unlock_desc'),
    });

    const inp = contentEl.createEl('input', { type: 'password' });
    inp.style.width = '100%'; inp.style.padding = '8px'; inp.style.fontSize = '14px';
    inp.placeholder = t('pp_placeholder');
    inp.focus();

    let confirm: HTMLInputElement | undefined;
    if (this.mode === 'set') {
      confirm = contentEl.createEl('input', { type: 'password' });
      confirm.style.width = '100%'; confirm.style.padding = '8px'; confirm.style.fontSize = '14px'; confirm.style.marginTop = '8px';
      confirm.placeholder = t('pp_confirm');
    }

    const actions = contentEl.createEl('div', { cls: 'nc-approval-actions' });
    const cancel = actions.createEl('button', { text: t('pp_cancel') });
    cancel.onclick = () => this.done(null);
    const ok = actions.createEl('button', { text: this.mode === 'set' ? t('pp_encrypt') : t('pp_unlock'), cls: 'mod-cta' });
    ok.onclick = () => {
      if (this.mode === 'set' && confirm && confirm.value !== inp.value) {
        contentEl.createEl('div', { cls: 'nc-approval-stats', text: t('pp_mismatch') }); return;
      }
      if (!inp.value || inp.value.length < 4) {
        contentEl.createEl('div', { cls: 'nc-approval-stats', text: t('pp_too_short') }); return;
      }
      this.done(inp.value);
    };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') ok.click(); });
    confirm?.addEventListener('keydown', e => { if (e.key === 'Enter') ok.click(); });
  }
  private done(v: string | null) { if (this.decided) return; this.decided = true; this.cb(v); this.close(); }
  onClose() { if (!this.decided) { this.decided = true; this.cb(null); } }
}
