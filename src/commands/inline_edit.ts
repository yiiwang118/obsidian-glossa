import { errorMessage } from '../utils/unknown_data';
import { App, Editor, MarkdownView, Modal, Notice } from 'obsidian';
import type GlossaPlugin from '../main';
import { buildProvider } from '../providers/registry';
import { renderDiffInto } from '../utils/diff';
import { setStyle } from '../utils/dom';
import { bi } from '../utils/i18n';

/**
 * Cursor-style inline edit: select text → Cmd+K → enter instruction → stream LLM →
 * show diff preview → accept or reject.
 */
export async function runInlineEdit(plugin: GlossaPlugin) {
  const mdView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
  if (!mdView?.editor) { new Notice(bi('Open a Markdown note first.', '请先打开一篇 Markdown 笔记。')); return; }
  const editor: Editor = mdView.editor;
  const original = editor.getSelection();
  if (!original.trim()) { new Notice(bi('Select some text first.', '请先选中一段文字。')); return; }

  const ep = plugin.settings.endpoints.find(e => e.id === plugin.settings.activeEndpointId);
  if (!ep) { new Notice(bi('No active endpoint.', '尚未选择接口。')); return; }
  const epDec = await plugin.getDecryptedEndpoint(ep);
  if (!epDec) return;

  const instruction = await askInstruction(plugin.app);
  if (!instruction) return;

  const sysPrompt = `You are an inline editor. The user has selected a passage and asked for a transformation. Reply with ONLY the rewritten passage — no commentary, no quotes, no preamble. Preserve markdown / formulas / code exactly.`;
  const userMsg = `Instruction: ${instruction}\n\n---\n${original}\n---`;

  const vaultRoot = (plugin.app.vault.adapter as typeof plugin.app.vault.adapter & { basePath?: string }).basePath;
  const provider = buildProvider(epDec, plugin.settings.globalProxy, vaultRoot);

  // Stream into a holding buffer; show progress indicator
  const notice = new Notice(bi('Editing… ', '正在编辑… '), 0);
  const aborter = new AbortController();
  let buf = '';
  try {
    for await (const ch of provider.stream({
      systemPrompt: sysPrompt,
      messages: [{ role: 'user', content: userMsg }],
      model: ep.model, signal: aborter.signal,
    })) {
      if (ch.type === 'text') { buf += ch.text; notice.setMessage(bi(`Editing… (${buf.length} chars)`, `正在编辑…（${buf.length} 字符）`)); }
      else if (ch.type === 'error') { notice.hide(); new Notice(bi(`Edit failed: ${ch.error}`, `编辑失败：${ch.error}`)); return; }
    }
  } catch (e: unknown) { notice.hide(); new Notice(bi(`Edit failed: ${errorMessage(e)}`, `编辑失败：${errorMessage(e)}`)); return; }
  notice.hide();
  const newText = buf.trim();
  if (!newText) { new Notice(bi('Empty response.', '模型没有返回内容。')); return; }

  const accept = await previewAndConfirm(plugin.app, original, newText);
  if (accept) {
    editor.replaceSelection(newText);
    new Notice(bi('Edit applied.', '已应用修改。'));
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
    this.contentEl.createEl('h3', { text: bi('Inline edit', '行内编辑') });
    this.contentEl.createEl('p', { cls: 'nc-approval-sub', text: bi('Describe how to transform the selection.', '说明要怎样修改选中的文字。') });
    const inp = this.contentEl.createEl('textarea');
    setStyle(inp, { width: '100%', minHeight: '60px', padding: '8px', fontSize: '13px' });
    inp.placeholder = bi('E.g. translate to Chinese · make it concise · convert to bullet list', '例如：翻译成英文 · 更简洁 · 改成列表');
    inp.focus();
    const actions = this.contentEl.createDiv({ cls: 'nc-approval-actions' });
    const cancel = actions.createEl('button', { text: bi('Cancel', '取消') });
    cancel.onclick = () => this.finish(null);
    const ok = actions.createEl('button', { text: bi('Edit', '编辑'), cls: 'mod-cta' });
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
    contentEl.createEl('h3', { text: bi('Inline edit preview', '行内编辑预览') });
    const wrap = contentEl.createDiv({ cls: 'nc-approval-diff-wrap' });
    const box = wrap.createDiv({ cls: 'nc-diff-box' });
    renderDiffInto(box, this.oldText, this.newText);
    const actions = contentEl.createDiv({ cls: 'nc-approval-actions' });
    actions.createEl('button', { text: bi('Reject', '放弃') }).onclick = () => this.finish(false);
    const ok = actions.createEl('button', { text: bi('Accept', '接受'), cls: 'mod-cta' });
    ok.onclick = () => this.finish(true);
    ok.focus();
  }
  private finish(v: boolean) { if (this.done) return; this.done = true; this.cb(v); this.close(); }
  onClose() { if (!this.done) { this.done = true; this.cb(false); } }
}
