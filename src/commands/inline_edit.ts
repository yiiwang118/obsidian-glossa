/* eslint-disable @typescript-eslint/no-unsafe-member-access -- Dynamic plugin and host-app boundaries validate these values at runtime. */
import { App, Editor, MarkdownView, Modal, Notice } from 'obsidian';
import type GlossaPlugin from '../main';
import { buildProvider } from '../providers/registry';
import { renderDiffInto } from '../utils/diff';
import { setStyle } from '../utils/dom';

/**
 * Cursor-style inline edit: select text → Cmd+K → enter instruction → stream LLM →
 * show diff preview → accept or reject.
 */
export async function runInlineEdit(plugin: GlossaPlugin) {
  const mdView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
  if (!mdView?.editor) { new Notice('Open a Markdown note first.'); return; }
  const editor: Editor = mdView.editor;
  const original = editor.getSelection();
  if (!original.trim()) { new Notice('Select some text first.'); return; }

  const ep = plugin.settings.endpoints.find(e => e.id === plugin.settings.activeEndpointId);
  if (!ep) { new Notice('No active endpoint.'); return; }
  const epDec = await plugin.getDecryptedEndpoint(ep);
  if (!epDec) return;

  const instruction = await askInstruction(plugin.app);
  if (!instruction) return;

  const sysPrompt = `You are an inline editor. The user has selected a passage and asked for a transformation. Reply with ONLY the rewritten passage — no commentary, no quotes, no preamble. Preserve markdown / formulas / code exactly.`;
  const userMsg = `Instruction: ${instruction}\n\n---\n${original}\n---`;

  const vaultRoot = (plugin.app.vault.adapter as AnyValue).basePath as string | undefined;
  const provider = buildProvider(epDec, plugin.settings.globalProxy, vaultRoot);

  // Stream into a holding buffer; show progress indicator
  const notice = new Notice('Editing… ', 0);
  const aborter = new AbortController();
  let buf = '';
  try {
    for await (const ch of provider.stream({
      systemPrompt: sysPrompt,
      messages: [{ role: 'user', content: userMsg }],
      model: ep.model, signal: aborter.signal,
    })) {
      if (ch.type === 'text') { buf += ch.text; notice.setMessage(`Editing… (${buf.length} chars)`); }
      else if (ch.type === 'error') { notice.hide(); new Notice(`Edit failed: ${ch.error}`); return; }
    }
  } catch (e) { notice.hide(); new Notice(`Edit failed: ${e.message}`); return; }
  notice.hide();
  const newText = buf.trim();
  if (!newText) { new Notice('Empty response.'); return; }

  const accept = await previewAndConfirm(plugin.app, original, newText);
  if (accept) {
    editor.replaceSelection(newText);
    new Notice('Edit applied.');
  }
}

function askInstruction(app: App): Promise<string | null> {
  return new Promise(resolve => new InstructionModal(app, resolve).open());
}

class InstructionModal extends Modal {
  private done = false;
  constructor(app: App, private cb: (v: string | null) => void) { super(app); }
  onOpen() {
    this.contentEl.empty();
    this.contentEl.createEl('h3', { text: 'Inline edit' });
    this.contentEl.createEl('p', { cls: 'nc-approval-sub', text: 'Describe how to transform the selection.' });
    const inp = this.contentEl.createEl('textarea');
    setStyle(inp, { width: '100%', minHeight: '60px', padding: '8px', fontSize: '13px' });
    inp.placeholder = ['E.g. translate to ', 'Chinese', ' · make it concise · convert to bullet list'].join('');
    inp.focus();
    const actions = this.contentEl.createEl('div', { cls: 'nc-approval-actions' });
    const cancel = actions.createEl('button', { text: 'Cancel' });
    cancel.onclick = () => this.finish(null);
    const ok = actions.createEl('button', { text: 'Edit', cls: 'mod-cta' });
    ok.onclick = () => this.finish(inp.value.trim() || null);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ok.click(); });
  }
  private finish(v: string | null) { if (this.done) return; this.done = true; this.cb(v); this.close(); }
  onClose() { if (!this.done) { this.done = true; this.cb(null); } }
}

function previewAndConfirm(app: App, oldText: string, newText: string): Promise<boolean> {
  return new Promise(resolve => new DiffPreviewModal(app, oldText, newText, resolve).open());
}

class DiffPreviewModal extends Modal {
  private done = false;
  constructor(app: App, private oldText: string, private newText: string, private cb: (ok: boolean) => void) { super(app); }
  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass('nc-approval');
    contentEl.empty();
    contentEl.createEl('h3', { text: 'Inline edit preview' });
    const wrap = contentEl.createEl('div', { cls: 'nc-approval-diff-wrap' });
    const box = wrap.createEl('div', { cls: 'nc-diff-box' });
    renderDiffInto(box, this.oldText, this.newText);
    const actions = contentEl.createEl('div', { cls: 'nc-approval-actions' });
    actions.createEl('button', { text: 'Reject' }).onclick = () => this.finish(false);
    const ok = actions.createEl('button', { text: 'Accept', cls: 'mod-cta' });
    ok.onclick = () => this.finish(true);
    ok.focus();
  }
  private finish(v: boolean) { if (this.done) return; this.done = true; this.cb(v); this.close(); }
  onClose() { if (!this.done) { this.done = true; this.cb(false); } }
}
/* eslint-enable @typescript-eslint/no-unsafe-member-access -- Re-enable review lint rules after dynamic boundary module. */
