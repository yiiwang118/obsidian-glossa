import { App, Modal } from 'obsidian';
import { customEffortValue, reasoningOptionsForEndpoint, type Endpoint } from '../types';
import { el, uid } from '../utils/dom';
import { bi } from '../utils/i18n';

/** Explicit input supplements the provider's detected effort menu. */
export function openEffortModal(app: App, endpoint: Endpoint, save: (value?: string) => Promise<void>): void {
  class EffortModal extends Modal {
    onOpen() {
      this.contentEl.classList.add('nc-effort-modal');
      el('h3', { parent: this.contentEl, text: bi('Custom effort', '自定义 effort') });
      el('p', { parent: this.contentEl, text: bi('Enter a value supported by your model. It is sent as entered; leave blank to use the default.', '填写模型支持的 effort，按填写值发送；留空恢复默认。') });
      const form = el('form', { parent: this.contentEl });
      const label = el('label', { parent: form, text: 'Effort' });
      const id = `glossa-effort-${uid()}`;
      const input = el('input', { parent: label, type: 'text', attrs: { list: id, placeholder: 'high', maxlength: '32', autocomplete: 'off' } });
      input.value = endpoint.customReasoningEffort || (endpoint.reasoningEffort === 'off' ? '' : endpoint.reasoningEffort ?? '');
      const options = el('datalist', { parent: form, attrs: { id } });
      for (const value of reasoningOptionsForEndpoint(endpoint).filter(v => v !== 'off')) el('option', { parent: options, attrs: { value } });
      const error = el('p', { className: 'nc-effort-error', parent: form, attrs: { role: 'alert' } });
      const actions = el('div', { className: 'nc-effort-actions', parent: form });
      const cancel = el('button', { parent: actions, type: 'button', text: bi('Cancel', '取消') });
      cancel.onclick = () => this.close();
      const submit = el('button', { parent: actions, type: 'submit', text: bi('Save', '保存') });
      form.onsubmit = async event => {
        event.preventDefault();
        let value: string | undefined;
        try { value = customEffortValue(input.value); }
        catch {
          error.textContent = bi('Use up to 32 letters, numbers, hyphens or underscores.', '最多 32 个字符，仅支持字母、数字、连字符和下划线。');
          input.setAttribute('aria-invalid', 'true');
          return;
        }
        submit.disabled = true;
        try { await save(value); this.close(); }
        catch { error.textContent = bi('Could not save. Try again.', '保存失败，请重试。'); submit.disabled = false; }
      };
      input.focus();
      input.select();
    }
    onClose() { this.contentEl.empty(); }
  }
  new EffortModal(app).open();
}
