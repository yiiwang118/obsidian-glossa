import { Modal } from 'obsidian';
import type GlossaPlugin from '../main';
import { buildProvider } from '../providers/registry';
import { discoverSkills, invalidateDiscoverCache } from '../agent/skills';
import {
  learningMarkdown, canActivate, parseLearningContent,
  type LearningContent, type LearningSource, type LearningEvaluation, type LearningVersion,
} from '../agent/learning_contract';
import { readLearningLedger, saveLearningVersion, setLearningActive, type LearningLedger } from '../agent/learning_store';
import { proposeLearning, evaluateLearning } from '../agent/learning_model';
import { renderDiffInto } from '../utils/diff';
import { uid } from '../utils/dom';
import { bi } from '../utils/i18n';
import { confirmModal } from './confirm_modal';

export interface LearningSeed { context: string; source: LearningSource }
const openDialogs = new WeakMap<GlossaPlugin, Set<LearningModal>>();

export function openLearningModal(plugin: GlossaPlugin, seed?: LearningSeed): void {
  let dialogs = openDialogs.get(plugin);
  if (!dialogs) {
    dialogs = new Set();
    openDialogs.set(plugin, dialogs);
    const owned = dialogs;
    plugin.register(() => {
      for (const dialog of owned) dialog.close();
      openDialogs.delete(plugin);
    });
  }
  const modal = new LearningModal(plugin, seed, () => dialogs.delete(modal));
  dialogs.add(modal);
  modal.open();
}

export class LearningModal extends Modal {
  private ledger: LearningLedger = { schema: 1, revision: 0, skills: [] };
  private draft: LearningContent | null = null;
  private evaluation?: LearningEvaluation;
  private baseline: LearningVersion | null = null;
  private correction = '';
  private context = '';
  private source?: LearningSource;
  private targetName = '';
  private busy = false;
  private closed = false;
  private abort?: AbortController;
  private form!: HTMLFieldSetElement;
  private status!: HTMLElement;
  private result!: HTMLElement;
  private enableButton?: HTMLButtonElement;

  constructor(private plugin: GlossaPlugin, seed?: LearningSeed, private dispose: () => void = () => {}) {
    super(plugin.app);
    this.context = seed?.context ?? '';
    this.source = seed?.source;
  }

  onOpen(): void {
    this.modalEl.addClass('nc-learning-modal');
    this.contentEl.createEl('p', { text: bi('Loading learned skills…', '正在读取学习记录…') });
    void this.load();
  }

  onClose(): void {
    this.closed = true;
    this.abort?.abort();
    this.dispose();
    this.ledger = { schema: 1, revision: 0, skills: [] };
    this.draft = null;
    this.evaluation = undefined;
    this.contentEl.empty();
  }

  private async load(): Promise<void> {
    try {
      this.ledger = await readLearningLedger(this.app.vault.adapter);
      if (!this.closed) { if (this.source) this.editor(); else this.library(); }
    } catch (error) {
      if (!this.closed) {
        this.contentEl.empty();
        this.contentEl.createEl('p', { text: bi('Could not open learning history: ', '无法读取学习记录：') + String(error), cls: 'nc-learning-error' });
      }
    }
  }

  private shell(title: string): void {
    this.contentEl.empty();
    this.enableButton = undefined;
    this.contentEl.createEl('h2', { text: title });
    this.status = this.contentEl.createDiv({ cls: 'nc-learning-status', attr: { role: 'status', 'aria-live': 'polite' } });
    this.form = this.contentEl.createEl('fieldset', { cls: 'nc-learning-form' });
    const cancel = this.contentEl.createEl('button', { text: bi('Close', '关闭'), cls: 'nc-learning-close' });
    cancel.onclick = () => this.close();
  }

  private button(parent: HTMLElement, text: string, action: () => Promise<void> | void, primary = false): HTMLButtonElement {
    const button = parent.createEl('button', { text, cls: primary ? 'mod-cta' : '' });
    button.type = 'button';
    button.onclick = () => { void this.run(action); };
    return button;
  }

  private async run(action: () => Promise<void> | void): Promise<void> {
    if (this.busy || this.closed) return;
    this.busy = true;
    this.form.disabled = true;
    this.status.removeClass('nc-learning-error');
    this.abort = new AbortController();
    try { await action(); }
    catch (error) {
      if (!this.closed) { this.status.addClass('nc-learning-error'); this.status.setText(String(error instanceof Error ? error.message : error)); }
    } finally {
      this.busy = false;
      if (!this.closed) this.form.disabled = false;
    }
  }

  private library(): void {
    this.shell(bi('Learned skills', '学习记录'));
    this.form.createEl('p', { cls: 'nc-learning-muted', text: bi('Enabled skills join the skill list on future turns. Up to 12 versions per skill are kept, including the active version.', '启用的技能会加入后续对话的技能列表。每个技能保留最近 12 个版本，当前启用版本始终保留。') });
    this.button(this.form, bi('New correction', '记录新纠正'), () => {
      this.draft = null; this.evaluation = undefined; this.baseline = null; this.targetName = ''; this.correction = ''; this.context = ''; this.source = undefined; this.editor();
    }, true);
    if (!this.ledger.skills.length) this.form.createEl('p', { text: bi('No learned skills yet. Start from a correction in chat.', '还没有学习记录。可以从聊天回复旁的“记住这次纠正”开始。') });
    for (const record of this.ledger.skills) {
      const card = this.form.createDiv({ cls: 'nc-learning-card' });
      const active = record.versions.find(version => version.id === record.activeId);
      card.createEl('h3', { text: record.versions[record.versions.length - 1].title });
      card.createEl('p', { text: `${record.name} · ${active ? bi('Enabled', '已启用') : bi('Disabled / draft', '已停用 / 草稿')}`, cls: 'nc-learning-muted' });
      const actions = card.createDiv({ cls: 'nc-learning-actions' });
      this.button(actions, bi('Improve', '继续改进'), () => {
        this.targetName = record.name; this.baseline = active ?? null;
        this.draft = structuredContent(active ?? record.versions[record.versions.length - 1]);
        this.evaluation = undefined; this.correction = ''; this.context = ''; this.source = undefined; this.editor();
      });
      if (active) this.button(actions, bi('Disable', '停用'), async () => {
        this.ledger = await setLearningActive(this.app.vault.adapter, this.ledger.revision, record.name, null);
        invalidateDiscoverCache(); if (!this.closed) this.library();
      });
      const history = card.createEl('details');
      history.createEl('summary', { text: bi(`Version history (${record.versions.length})`, `版本历史（${record.versions.length}）`) });
      for (const version of [...record.versions].reverse()) {
        const row = history.createDiv({ cls: 'nc-learning-version' });
        row.createEl('p', { text: `${new Date(version.createdAt).toLocaleString()} · ${version.id.slice(-8)}${version.id === record.activeId ? bi(' · Active', ' · 当前版本') : ''}` });
        row.createEl('p', { text: version.correction });
        const detail = row.createEl('details');
        detail.createEl('summary', { text: bi('View workflow and results', '查看技能与验证结果') });
        detail.createEl('pre', { text: learningMarkdown(version), cls: 'nc-learning-output' });
        if (version.evaluation) this.renderResults(detail, version.evaluation);
        if (version.source) detail.createEl('p', { cls: 'nc-learning-muted', text: bi('Source: ', '来源：') + `${version.source.sessionId} / ${version.source.turnId} · ${version.source.model ?? bi('Model not recorded', '未记录模型')}` });
        this.button(row, bi('Edit as draft', '作为草稿编辑'), () => {
          this.targetName = record.name; this.baseline = active ?? null; this.draft = structuredContent(version);
          this.evaluation = undefined; this.correction = version.correction; this.source = version.source; this.context = ''; this.editor();
        });
        if (version.id !== record.activeId && canActivate(version, version.evaluation, version.evaluation?.baselineId ?? null)) {
          this.button(row, bi('Restore this version', '恢复此版本'), async () => {
            const ok = await confirmModal(this.app, { title: bi('Restore skill version', '恢复技能版本'), body: bi('Use this saved version on future turns? Its example results were recorded with the model shown above.', '后续对话将使用这个历史版本。其验证结果来自上方记录的模型与时间。'), confirmText: bi('Restore', '恢复') });
            if (!ok || this.closed) return;
            await this.checkName(version.name);
            this.ledger = await setLearningActive(this.app.vault.adapter, this.ledger.revision, record.name, version.id);
            invalidateDiscoverCache(); if (!this.closed) this.library();
          });
        }
      }
    }
  }

  private field(parent: HTMLElement, title: string, value: string, change: (value: string) => void, lines = 1): HTMLInputElement | HTMLTextAreaElement {
    const label = parent.createEl('label', { cls: 'nc-learning-field' });
    label.createSpan({ text: title });
    const input = lines > 1 ? label.createEl('textarea') : label.createEl('input', { type: 'text' });
    if (input instanceof input.ownerDocument.defaultView.HTMLTextAreaElement) input.rows = lines;
    input.value = value;
    input.oninput = () => { change(input.value); this.invalidate(); };
    return input;
  }

  private invalidate(): void {
    this.evaluation = undefined;
    if (this.enableButton) this.enableButton.disabled = true;
    if (this.result) this.result.empty();
    this.status.setText(bi('Draft changed. Run the examples before enabling.', '草稿已变更，启用前需要重新验证。'));
  }

  private editor(): void {
    this.shell(bi('Remember this correction', '记住这次纠正'));
    const nav = this.form.createDiv({ cls: 'nc-learning-actions' });
    this.button(nav, bi('Learning history', '学习记录'), () => this.library());
    this.form.createEl('p', { cls: 'nc-learning-muted', text: bi('Draft generation sends your correction, the excerpt below and the selected skill to the current chat model. Edit the excerpt before sending.', '生成草稿会将纠正、下方摘录和所选技能发送给当前聊天模型。你可以先编辑摘录。') });
    this.field(this.form, bi('What should change next time?', '下次应该怎么做？'), this.correction, value => { this.correction = value; }, 3);
    if (this.context) {
      const excerpt = this.form.createEl('details');
      excerpt.createEl('summary', { text: bi('Review conversation excerpt', '查看对话摘录') });
      this.field(excerpt, bi('Excerpt sent to the model', '发送给模型的摘录'), this.context, value => { this.context = value; }, 5);
    }
    if (!this.draft) {
      const label = this.form.createEl('label', { cls: 'nc-learning-field' });
      label.createSpan({ text: bi('Target skill', '目标技能') });
      const select = label.createEl('select');
      select.createEl('option', { text: bi('Create a new skill', '新建技能'), value: '' });
      for (const record of this.ledger.skills) select.createEl('option', { text: record.versions[record.versions.length - 1].title, value: record.name });
      select.value = this.targetName;
      select.onchange = () => { this.targetName = select.value; this.invalidate(); };
    }
    this.button(this.form, this.draft ? bi('Regenerate draft', '重新生成草稿') : bi('Generate draft', '生成草稿'), async () => {
      if (!this.correction.trim()) throw new Error(bi('Enter a correction first.', '请先填写纠正。'));
      const record = this.ledger.skills.find(item => item.name === this.targetName);
      this.baseline = record?.versions.find(version => version.id === record.activeId) ?? null;
      const previous = this.draft ?? this.baseline ?? record?.versions[record.versions.length - 1] ?? null;
      const { provider } = await this.provider();
      this.status.setText(bi('Preparing a skill and examples…', '正在整理技能与验证样例…'));
      const draft = await proposeLearning(provider, this.correction, this.context.slice(0, 14000), previous, this.abort.signal);
      if (this.closed) return;
      if (!this.targetName && this.ledger.skills.some(item => item.name === draft.name)) throw new Error(bi('A learned skill already has this name. Select it as the target first.', '已有同名学习技能，请先将它选为目标技能。'));
      await this.checkName(draft.name);
      this.draft = draft; this.evaluation = undefined; if (!this.closed) this.editor();
    }, !this.draft);
    if (!this.draft) return;
    const draft = this.draft;
    this.form.createEl('h3', { text: bi('Skill draft', '技能草稿') });
    const name = this.field(this.form, bi('Skill name', '技能名称'), draft.name, value => { draft.name = value; });
    name.readOnly = !!this.targetName;
    this.field(this.form, bi('Title', '标题'), draft.title, value => { draft.title = value; });
    this.field(this.form, bi('Description', '用途说明'), draft.description, value => { draft.description = value; }, 2);
    this.field(this.form, bi('When to use', '适用条件'), draft.whenToUse, value => { draft.whenToUse = value; }, 2);
    this.field(this.form, bi('Workflow', '操作步骤'), draft.body, value => { draft.body = value; }, 9);
    const preview = this.form.createEl('details');
    preview.createEl('summary', { text: bi('Changes from the active version', '与当前启用版本的差异') });
    const diff = preview.createDiv({ cls: 'nc-learning-diff nc-diff' });
    preview.ontoggle = () => { if (preview.open) renderDiffInto(diff, this.baseline ? learningMarkdown(this.baseline) : '', learningMarkdown(draft)); };
    this.form.createEl('h3', { text: bi('Text examples', '文本验证样例') });
    this.form.createEl('p', { cls: 'nc-learning-muted', text: bi('Review these checks before running. Each example uses two model calls with fresh context. Exact output checks and trigger checks run locally; tools and real notes are not exercised. Add your own example to test beyond the generated cases.', '请先检查样例与验收条件。每个样例会用独立上下文调用模型两次，并在本地检查输出片段和触发范围。此处验证文本行为，不执行工具或修改真实笔记；建议补充一个你自己的样例。') });
    for (const [index, example] of draft.examples.entries()) {
      const card = this.form.createEl('details', { cls: 'nc-learning-card' });
      card.createEl('summary', { text: `${index + 1}. ${example.name} · ${example.shouldTrigger ? bi('Should apply', '应该触发') : bi('Should not apply', '不应触发')}` });
      this.field(card, bi('Example name', '样例名称'), example.name, value => { example.name = value; });
      const trigger = card.createEl('label', { cls: 'nc-learning-check' });
      const checkbox = trigger.createEl('input', { type: 'checkbox' });
      checkbox.checked = example.shouldTrigger;
      trigger.createSpan({ text: bi('This task should use the skill', '此任务应该使用该技能') });
      checkbox.onchange = () => { example.shouldTrigger = checkbox.checked; this.invalidate(); };
      this.field(card, bi('Task', '任务'), example.request, value => { example.request = value; }, 2);
      this.field(card, bi('Sample input text', '样例输入文本'), example.input, value => { example.input = value; }, 4);
      for (const key of ['includes', 'excludes'] as const) {
        card.createEl('p', { text: key === 'includes' ? bi('Required output fragments (exact match)', '输出必须包含（精确匹配）') : bi('Forbidden output fragments', '输出不得包含') });
        const list = card.createDiv();
        const renderChecks = () => {
          list.empty();
          example[key].forEach((value, position) => {
            const row = list.createDiv({ cls: 'nc-learning-check-row' });
            this.field(row, bi(`Fragment ${position + 1}`, `片段 ${position + 1}`), value, text => { example[key][position] = text; }, 2);
            this.button(row, bi('Remove', '移除'), () => { example[key].splice(position, 1); this.invalidate(); renderChecks(); });
          });
        };
        renderChecks();
        this.button(card, bi('Add a check', '添加检查项'), () => { example[key].push(''); this.invalidate(); renderChecks(); });
      }
      if (draft.examples.length > 3) this.button(card, bi('Remove example', '移除样例'), () => { draft.examples.splice(index, 1); this.invalidate(); this.editor(); });
    }
    if (draft.examples.length < 5) this.button(this.form, bi('Add my own example', '添加自己的样例'), () => {
      draft.examples.push({ name: bi('My example', '我的样例') + ` ${draft.examples.length + 1}`, request: '', input: '', shouldTrigger: true, includes: [''], excludes: [] });
      this.invalidate(); this.editor();
    });
    this.result = this.form.createDiv({ cls: 'nc-learning-results' });
    if (this.evaluation) this.renderResults(this.result, this.evaluation);
    const actions = this.form.createDiv({ cls: 'nc-learning-actions' });
    this.button(actions, bi('Save draft', '保存草稿'), () => this.save(false));
    this.button(actions, bi(`Run examples (${draft.examples.length * 2} calls)`, `验证样例（${draft.examples.length * 2} 次调用）`), async () => {
      const content = parseLearningContent(draft);
      const { provider, endpointId, model } = await this.provider();
      this.evaluation = undefined; this.enableButton.disabled = true; this.result.empty();
      const evaluation = await evaluateLearning(provider, content, this.baseline, endpointId, model, this.abort.signal,
        (done, total) => { if (!this.closed) this.status.setText(bi(`Checking examples: ${done}/${total}`, `正在验证：${done}/${total}`)); });
      if (this.closed) return;
      this.draft = content; this.evaluation = evaluation; this.editor();
      this.enableButton.disabled = !canActivate(content, evaluation, this.baseline?.id ?? null);
      this.status.setText(this.enableButton.disabled ? bi('Some checks failed. Adjust the draft or examples and run again.', '部分检查未通过，请调整草稿或样例后重新验证。') : bi('Examples passed. Review the results, then enable the skill.', '样例已通过。检查结果后可以启用技能。'));
    });
    this.enableButton = this.button(actions, bi('Enable this version', '启用此版本'), () => this.save(true), true);
    this.enableButton.disabled = !canActivate(draft, this.evaluation, this.baseline?.id ?? null);
  }

  private async provider() {
    if (this.closed || this.abort?.signal.aborted) throw new Error('Cancelled.');
    const endpoint = this.plugin.settings.endpoints.find(item => item.id === this.plugin.settings.activeEndpointId);
    if (!endpoint) throw new Error(bi('Configure a model first.', '请先配置模型。'));
    const ready = await this.plugin.getDecryptedEndpoint(endpoint);
    if (!ready) throw new Error(bi('Unlock the endpoint key first.', '请先解锁模型密钥。'));
    if (this.closed || this.abort?.signal.aborted) throw new Error('Cancelled.');
    return { provider: buildProvider(ready, this.plugin.settings.globalProxy), endpointId: ready.id, model: ready.model ?? '' };
  }

  private async checkName(name: string): Promise<void> {
    invalidateDiscoverCache();
    const existing = (await discoverSkills(this.app)).find(skill => skill.name === name && skill.source !== 'learned');
    if (existing) throw new Error(bi('An existing skill already uses this name. Choose a different name.', '已有其他来源的同名技能，请换一个名称。'));
  }

  private async save(activate: boolean): Promise<void> {
    const content = parseLearningContent(this.draft);
    if (!this.correction.trim() || this.correction.length > 6000) throw new Error(bi('Enter a correction (up to 6000 characters).', '请填写纠正（最多 6000 字符）。'));
    if (!this.targetName && this.ledger.skills.some(item => item.name === content.name)) throw new Error(bi('This name already exists. Open it from learning history.', '此名称已存在，请从学习记录中打开对应技能。'));
    await this.checkName(content.name);
    if (this.closed) return;
    const version: LearningVersion = { ...content, id: uid(), createdAt: Date.now(), correction: this.correction, source: this.source, evaluation: this.evaluation };
    this.ledger = await saveLearningVersion(this.app.vault.adapter, this.ledger.revision, version, activate, this.baseline?.id ?? null);
    invalidateDiscoverCache();
    if (!this.closed) { this.library(); this.status.setText(activate ? bi('Skill enabled for future turns.', '技能已启用，将用于后续对话。') : bi('Draft saved. It is not active.', '草稿已保存，尚未启用。')); }
  }

  private renderResults(parent: HTMLElement, evaluation: LearningEvaluation): void {
    const candidate = evaluation.rows.filter(row => !row.candidate.failures.length).length;
    const baseline = evaluation.rows.filter(row => !row.baseline.failures.length).length;
    parent.createEl('p', { text: bi(`Examples passed: ${baseline} → ${candidate} / ${evaluation.rows.length}`, `样例通过：${baseline} → ${candidate} / ${evaluation.rows.length}`) });
    parent.createEl('p', { cls: 'nc-learning-muted', text: `${evaluation.model} · ${new Date(evaluation.testedAt).toLocaleString()} · ${evaluation.baselineId ? bi('Compared with the enabled version', '与当前启用版本比较') : bi('Compared without this skill', '与不加载该技能比较')}` });
    if (candidate === baseline) parent.createEl('p', { text: bi('These examples show no measured gain in pass rate.', '这些样例未显示通过率提升。') });
    for (const row of evaluation.rows) {
      const detail = parent.createEl('details', { cls: 'nc-learning-card' });
      detail.createEl('summary', { text: `${row.candidate.failures.length ? '✕' : '✓'} ${row.name}` });
      for (const [label, outcome] of [[bi('Before', '之前'), row.baseline], [bi('After', '之后'), row.candidate]] as const) {
        detail.createEl('p', { text: `${label} · ${(outcome.milliseconds / 1000).toFixed(1)} s · ${outcome.inputTokens ?? '—'} / ${outcome.outputTokens ?? '—'} tokens` });
        if (outcome.failures.length) detail.createEl('p', { text: outcome.failures.join('\n'), cls: 'nc-learning-error' });
        detail.createEl('pre', { text: outcome.output, cls: 'nc-learning-output' });
      }
    }
  }
}

function structuredContent(version: LearningContent): LearningContent {
  return parseLearningContent(JSON.parse(JSON.stringify(version)) as unknown);
}
