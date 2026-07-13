/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- Dynamic plugin and host-app boundaries validate these values at runtime. */
import { App, Modal, Notice, TFile } from 'obsidian';
import type { ToolImpl } from './tools';
import { diffStats, lineDiff, applySelectedDiff, renderDiffInto } from '../utils/diff';
import { looksLikeEnvelope, previewEnvelope } from './patch_envelope';
import { setStyle } from '../utils/dom';

export interface ApprovalResult {
  ok: boolean;
  /** If set, replaces the tool args at execution time (used by per-line diff edits). */
  mutatedArgs?: AnyValue;
  /** If the user picked an "Always allow…" option, this rule is persisted by the loop
   *  so future calls auto-resolve. */
  persistRule?: import('../types').PermissionRule;
}

export function askApproval(app: App, tool: ToolImpl, args: AnyValue): Promise<ApprovalResult> {
  return new Promise(resolve => new ApprovalModal(app, tool, args, resolve).open());
}

class ApprovalModal extends Modal {
  private decided = false;

  constructor(
    app: App,
    private tool: ToolImpl,
    private args: AnyValue,
    private onDecide: (r: ApprovalResult) => void,
  ) { super(app); }

  async onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass('nc-approval');
    contentEl.empty();

    contentEl.createEl('h3', { text: `Approve: ${this.tool.spec.name}` });
    contentEl.createEl('p', {
      text: this.tool.describe ? this.tool.describe(this.args) : this.tool.spec.name,
      cls: 'nc-approval-sub',
    });

    // Try to show a real diff for known write tools
    const diffEl = await this.tryRenderDiff();
    if (!diffEl) {
      // Fallback: textual preview
      let previewText = '';
      try {
        if (this.tool.preview) {
          const fn = this.tool.preview as AnyValue;
          previewText = (fn.length >= 2) ? await fn(this.app, this.args) : await fn(this.args);
        } else {
          previewText = JSON.stringify(this.args, null, 2);
        }
      } catch { previewText = JSON.stringify(this.args, null, 2); }
      const pre = contentEl.createDiv({ cls: 'nc-approval-diff' });
      pre.textContent = previewText;
    }

    const actions = contentEl.createDiv({ cls: 'nc-approval-actions' });
    const cancel = actions.createEl('button', { text: 'Deny' });
    cancel.onclick = () => this.decide({ ok: false });
    const allow = actions.createEl('button', { text: 'Approve', cls: 'mod-cta' });
    allow.onclick = () => this.decide(this.buildResult());
    // Visual cue when the diff-preview marked this approval as blocked.
    // The actual gate is in buildResult() so a fast Enter cannot bypass it,
    // but disabling the button + adding a tooltip makes the intent clear.
    const block = (this as AnyValue).__blockApprove as string | undefined;
    if (block) {
      allow.disabled = true;
      allow.title = block;
      cancel.focus();
    } else {
      allow.focus();
    }

    // Keyboard shortcuts — note: Cmd+Enter must call buildResult() so per-line toggles
    // are honored. Hitting it before unchecking a line equals approve-all-as-shown.
    contentEl.tabIndex = 0;
    contentEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); this.decide(this.buildResult()); }
      else if (e.key === 'Escape') { e.preventDefault(); this.decide({ ok: false }); }
    });
  }

  private async tryRenderDiff(): Promise<HTMLElement | null> {
    const { contentEl } = this;
    const name = this.tool.spec.name;
    const a = this.args;

    let oldText = '';
    let newText = '';
    let label = a.path ?? '';
    const warnings: string[] = [];

    try {
      if (name === 'write_note') {
        const f = this.app.vault.getAbstractFileByPath(a.path);
        if (f instanceof TFile) oldText = await this.app.vault.read(f);
        else warnings.push('File does not exist yet — will be created.');
        newText = a.content ?? '';
      } else if (name === 'create_note') {
        const f = this.app.vault.getAbstractFileByPath(a.path);
        if (f instanceof TFile) warnings.push('⚠ File already exists — create will FAIL at runtime.');
        oldText = '';
        newText = a.content ?? '';
      } else if (name === 'file_edit') {
        label = a.file_path ?? '';
        if (a.old_string === '') {
          const f = this.app.vault.getAbstractFileByPath(a.file_path);
          if (f instanceof TFile) { warnings.push('⚠ File already exists — file_edit with empty old_string is for NEW files only.'); return this.renderWarnings(label, warnings); }
          oldText = ''; newText = a.new_string ?? '';
        } else {
          const f = this.app.vault.getAbstractFileByPath(a.file_path);
          if (!(f instanceof TFile)) { warnings.push(`File not found: ${a.file_path}. Tool will fail.`); return this.renderWarnings(label, warnings); }
          oldText = await this.app.vault.read(f);
          const occ = typeof a.old_string === 'string' ? oldText.split(a.old_string).length - 1 : 0;
          if (occ === 0) { warnings.push(`old_string not found in ${a.file_path}.`); return this.renderWarnings(label, warnings); }
          if (occ > 1 && !a.replace_all) { warnings.push(`old_string matches ${occ} places — pass replace_all:true or provide more context.`); return this.renderWarnings(label, warnings); }
          newText = a.replace_all
            ? oldText.split(a.old_string).join(a.new_string ?? '')
            : oldText.replace(a.old_string, a.new_string ?? '');
        }
      } else if (name === 'edit_section') {
        const f = this.app.vault.getAbstractFileByPath(a.path);
        if (!(f instanceof TFile)) { warnings.push(`File not found: ${a.path}. Tool will fail.`); return this.renderWarnings(label, warnings); }
        oldText = await this.app.vault.read(f);
        const occ = oldText.split(a.find).length - 1;
        if (occ === 0) { warnings.push(`"find" string not present in file. Tool will fail.`); return this.renderWarnings(label, warnings); }
        if (occ > 1) { warnings.push(`⚠ "find" matches ${occ} places — tool requires unique match and will REJECT this call. Provide more context.`); return this.renderWarnings(label, warnings); }
        newText = oldText.replace(a.find, a.replace);
      } else if (name === 'apply_patch') {
        // Envelope mode — multi-file colored diff per op
        if (typeof a.patch === 'string' && looksLikeEnvelope(a.patch)) {
          return await this.renderEnvelopePreview(a.patch);
        }
        // Legacy {search, replace}[] mode
        const f = this.app.vault.getAbstractFileByPath(a.path);
        if (!(f instanceof TFile)) { warnings.push(`File not found: ${a.path}. Tool will fail.`); return this.renderWarnings(label, warnings); }
        oldText = await this.app.vault.read(f);
        let cur = oldText;
        const edits = a.edits ?? [];
        let badEdit = -1;
        for (let i = 0; i < edits.length; i++) {
          const ed = edits[i];
          const occ = cur.split(ed.search).length - 1;
          if (occ === 0) { warnings.push(`Edit ${i + 1}: "search" not found in current state. Tool will fail.`); badEdit = i; break; }
          if (occ > 1)  { warnings.push(`Edit ${i + 1}: "search" matches ${occ} places — tool requires unique match and will REJECT. Make it more specific.`); badEdit = i; break; }
          cur = cur.replace(ed.search, ed.replace);
        }
        if (badEdit >= 0) return this.renderWarnings(label, warnings);
        newText = cur;
      } else if (name === 'append_to_note') {
        const f = this.app.vault.getAbstractFileByPath(a.path);
        if (f instanceof TFile) oldText = await this.app.vault.read(f);
        else warnings.push('File does not exist yet — will be created.');
        newText = oldText + (oldText.endsWith('\n') ? '' : '\n') + (a.text ?? '');
      } else {
        return null;
      }
    } catch { return null; }

    const wrap = contentEl.createDiv({ cls: 'nc-approval-diff-wrap' });
    if (label) wrap.createDiv({ cls: 'nc-approval-file', text: label });
    for (const w of warnings) wrap.createDiv({ cls: 'nc-approval-warning', text: w });

    // Stats line
    const { adds, dels } = diffStats(oldText, newText);
    wrap.createDiv({
      cls: 'nc-approval-stats',
      text: `+${adds} −${dels}  ·  ${(newText.length)} chars`,
    });

    // Interactive per-line diff with checkboxes for add/del lines.
    // Safety: lineDiff caps at 2000 lines internally; for files BEYOND that cap, the
    // per-line apply path would silently truncate the file. Disable checkboxes for big files.
    const oldLineCount = oldText.split('\n').length;
    const newLineCount = newText.split('\n').length;
    const tooBigForPerLine = Math.max(oldLineCount, newLineCount) > 2000;

    if (tooBigForPerLine) {
      wrap.createDiv({ cls: 'nc-approval-warning',
        text: `⚠ File is ${Math.max(oldLineCount, newLineCount).toLocaleString()} lines — per-line accept/reject is disabled (only safe up to 2000 lines). Approve = apply ALL changes, Deny = cancel.` });
    }
    const ops = lineDiff(oldText, newText);
    const diffBox = wrap.createDiv({ cls: 'nc-diff-box' });
    const decisions = new Map<number, boolean>();
    ops.forEach((op, i) => {
      const line = diffBox.createDiv({ cls: `nc-diff-line ${op.type}` });
      if (!tooBigForPerLine && (op.type === 'add' || op.type === 'del')) {
        const cb = line.createEl('input', { type: 'checkbox' });
        (cb).checked = true;
        setStyle(cb, { marginRight: '6px' });
        decisions.set(i, true);
        cb.onchange = () => decisions.set(i, (cb).checked);
      }
      line.createSpan({ text: op.type === 'add' ? '+' : op.type === 'del' ? '−' : ' ' });
      line.createSpan({ text: ` ${op.text || ' '}` });
    });
    if (ops.length === 0) wrap.createDiv({ cls: 'nc-diff-line eq', text: '(No changes detected)' });
    // Stash for decide() to rebuild content if user toggled lines.
    (this as AnyValue).__diff = { oldText, newText, decisions };
    return wrap;
  }

  /** Build the result, taking into account any per-line diff toggles the user made.
   *
   *  Honors `__blockApprove`: when the preview detected a fatal warning
   *  (envelope parse error, non-unique match, etc.) we set a synchronous
   *  block flag. Approve attempts — including a fast Cmd+Enter that races
   *  the old window.setTimeout(0) button-disable — are turned into ok:false here,
   *  so the loop sees a denial and won't proceed. */
  private buildResult(): ApprovalResult {
    const blockReason = (this as AnyValue).__blockApprove as string | undefined;
    if (blockReason) {
      try { new Notice(`Approval blocked: ${blockReason}`, 5000); } catch { /* ignore */ }
      return { ok: false };
    }
    const d = (this as AnyValue).__diff as { oldText: string; newText: string; decisions: Map<number, boolean> } | undefined;
    const name = this.tool.spec.name;
    if (!d) return { ok: true };
    // Has the user toggled anything off? If not, just approve as-is.
    let anyToggledOff = false;
    for (const v of d.decisions.values()) if (!v) { anyToggledOff = true; break; }
    if (!anyToggledOff) return { ok: true };

    const mutated = applySelectedDiff(d.oldText, d.newText, d.decisions);
    const a = { ...this.args };
    if (name === 'write_note' || name === 'create_note') a.content = mutated;
    else if (name === 'append_to_note') {
      a.text = mutated.startsWith(d.oldText) ? mutated.slice(d.oldText.length).replace(/^\n+/, '') : mutated;
    } else if (name === 'edit_section' || name === 'apply_patch') {
      a.path = this.args.path;
      a.content = mutated;
      (a).__rewriteAsWrite = true;
    } else if (name === 'file_edit') {
      // Per-line toggles → rewrite as write_note with merged content
      a.path = this.args.file_path;
      a.content = mutated;
      (a).__rewriteAsWrite = true;
    }
    // Stash the file snapshot so the runtime can detect stale-write race conditions
    // (file changed between preview and apply).
    (a).__expectedBefore = d.oldText;
    return { ok: true, mutatedArgs: a };
  }

  private decide(r: ApprovalResult) {
    if (this.decided) return;
    this.decided = true;
    this.onDecide(r);
    this.close();
  }

  onClose() { if (!this.decided) { this.decided = true; this.onDecide({ ok: false }); } }

  /** Codex envelope preview — multi-file colored diff. Whole-batch approve / deny;
   *  per-line toggle is intentionally disabled because envelope semantics span files. */
  private async renderEnvelopePreview(patch: string): Promise<HTMLElement> {
    const { contentEl } = this;
    const wrap = contentEl.createDiv({ cls: 'nc-approval-diff-wrap' });
    const { ops, files, parseError } = await previewEnvelope(patch, async (p) => {
      const f = this.app.vault.getAbstractFileByPath(p);
      return f instanceof TFile ? await this.app.vault.read(f) : null;
    });

    if (parseError) {
      wrap.createDiv({ cls: 'nc-approval-warning', text: `Parse error: ${parseError}` });
      // Synchronously mark the modal as blocking-approve. The approve button
      // is rendered AFTER this preview (see onOpen ordering), so we set a
      // flag the buildResult / keydown paths check rather than relying on a
      // window.setTimeout(0) that loses the race against a fast Enter press.
      (this as AnyValue).__blockApprove = 'Envelope invalid.';
      return wrap;
    }

    // Top summary
    let totalAdds = 0, totalDels = 0;
    const tally = (a: string, b: string | null) => {
      if (b == null) { totalDels += (a ? a.split('\n').length : 0); return; }
      const ops = lineDiff(a, b);
      for (const op of ops) { if (op.type === 'add') totalAdds++; else if (op.type === 'del') totalDels++; }
    };
    for (const f of files) tally(f.oldText, f.newText);
    wrap.createDiv({
      cls: 'nc-approval-stats',
      text: `envelope · ${ops.length} op${ops.length === 1 ? '' : 's'} · +${totalAdds} −${totalDels}`,
    });

    for (const fp of files) {
      const fileSec = wrap.createDiv({ cls: 'nc-approval-file-section' });
      const label = fp.movePath && fp.movePath !== fp.path ? `${fp.path} → ${fp.movePath}` : fp.path;
      const head = fileSec.createDiv({ cls: 'nc-approval-file' });
      head.createSpan({ cls: `nc-approval-op-pill ${fp.kind}`, text: fp.kind });
      head.createSpan({ text: label });
      if (fp.warning) fileSec.createDiv({ cls: 'nc-approval-warning', text: '⚠ ' + fp.warning });
      if (fp.kind === 'delete') {
        fileSec.createDiv({ cls: 'nc-diff-line del', text: `(file will be deleted — ${fp.oldText.split('\n').length} lines lost)` });
        continue;
      }
      const a = fp.oldText, b = fp.newText ?? '';
      if (a === b) {
        fileSec.createDiv({ cls: 'nc-diff-line eq', text: '(No changes)' });
      } else {
        const box = fileSec.createDiv({ cls: 'nc-diff-box' });
        renderDiffInto(box, a, b);
      }
    }

    // If any file has a warning that would break apply, disable approve.
    const blocking = files.some(f => f.warning);
    if (blocking) {
      wrap.createDiv({ cls: 'nc-approval-warning', text: 'Approve disabled while warnings are above — ask the model to retry.' });
      // Synchronous flag — see __blockApprove handling in decide()/keydown
      // path. Replaces the racy window.setTimeout(0) DOM-button disable.
      (this as AnyValue).__blockApprove = 'Envelope has unresolved warnings.';
    }
    // Envelope is approved as-a-batch — no per-line decisions stashed.
    return wrap;
  }

  /** When the diff is broken (e.g., non-unique match), show warnings and disable Approve. */
  private renderWarnings(label: string, warnings: string[]): HTMLElement {
    const { contentEl } = this;
    const wrap = contentEl.createDiv({ cls: 'nc-approval-diff-wrap' });
    if (label) wrap.createDiv({ cls: 'nc-approval-file', text: label });
    for (const w of warnings) wrap.createDiv({ cls: 'nc-approval-warning', text: w });
    const disabledMsg = wrap.createDiv({
      cls: 'nc-approval-warning',
      text: 'Approve disabled — the LLM should retry with a different patch (more unique context). Click ' + 'Deny.',
    });
    setStyle(disabledMsg, { fontWeight: '700' });
    // Same synchronous-flag pattern — see __blockApprove in decide().
    (this as AnyValue).__blockApprove = 'Diff invalid — see warnings.';
    return wrap;
  }
}
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- Re-enable review lint rules after dynamic boundary module. */
