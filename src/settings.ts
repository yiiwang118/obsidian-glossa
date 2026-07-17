/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- Dynamic plugin and host-app boundaries validate these values at runtime. */
import { App, PluginSettingTab, Setting, Notice, Modal } from 'obsidian';
import type GlossaPlugin from './main';
import type { Endpoint, CustomPrompt, SlashCommand } from './types';
import { reasoningOptionsForEndpoint } from './types';
import { uid, setStyle, setTrustedSvg } from './utils/dom';
import { CustomApiProvider } from './providers/custom_api';
import { buildProvider } from './providers/registry';
import { discoverSkills, type Skill } from './agent/skills';
import { validateSkillDefinition } from './agent/skill_validation';
import { t, bi } from './utils/i18n';
import { ICON } from './ui/icons';
import { Popup } from './ui/popup';
import {
  BUNDLED_SKILL_ZH,
  TOOL_CATEGORY_COPY,
  TOOL_CATEGORY_ORDER,
  buildToolCapabilities,
  type ToolCapability,
} from './ui/capability_catalog';

const HTTP_PROXY_PLACEHOLDER = ['http', '://127.0.0.1:7890'].join('');
const HTTPS_API_PLACEHOLDER = ['https', '://api.example.com/v1'].join('');
const API_KEY_PLACEHOLDER = 'sk-' + '...';

function normalizeModelList(models: string[]): string[] {
  return [...new Set(models.map(m => String(m).trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));
}

function makeKeyboardClickable(el: HTMLElement, label?: string) {
  el.setAttribute('role', 'button');
  el.tabIndex = 0;
  if (label) el.setAttribute('aria-label', label);
  el.addEventListener('keydown', (evt: KeyboardEvent) => {
    if (evt.key !== 'Enter' && evt.key !== ' ') return;
    evt.preventDefault();
    el.click();
  });
}

function parseClampedInt(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function parseNonNegativeFloat(value: string, fallback = 0): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, parsed);
}

interface AlignedSelectOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

function createAlignedSelect<T extends string>(
  parent: HTMLElement,
  popup: Popup,
  options: readonly AlignedSelectOption<T>[],
  value: T,
  onChange: (value: T) => void | Promise<void>,
  ariaLabel: string,
): HTMLButtonElement {
  let current = value;
  const button = parent.createEl('button', {
    cls: 'nc-aligned-select',
    attr: {
      type: 'button',
      'aria-label': ariaLabel,
      'aria-haspopup': 'listbox',
      'aria-expanded': 'false',
    },
  });

  const renderValue = () => {
    button.empty();
    const selected = options.find(option => option.value === current) ?? options[0];
    button.createSpan({
      cls: 'nc-aligned-select-label',
      text: selected?.label ?? current,
    });
    const icon = button.createSpan({ cls: 'nc-aligned-select-chevron' });
    setTrustedSvg(icon, ICON.chevronDown);
  };
  const open = () => {
    if (popup.isOpen() && popup.currentAnchor() === button) {
      popup.hide();
      return;
    }
    popup.show(button, options.map(option => ({
      label: option.label,
      hint: option.hint,
      checked: option.value === current,
      onSelect: async () => {
        if (option.value === current) return;
        current = option.value;
        renderValue();
        await onChange(option.value);
      },
    })));
  };
  button.onclick = open;
  button.onkeydown = (event) => {
    if (event.key !== 'ArrowDown' || popup.isOpen()) return;
    event.preventDefault();
    open();
  };
  renderValue();
  return button;
}

/* ============================================================
   Provider presets
   ============================================================ */

interface Preset {
  name: string;        // short, e.g. "DeepSeek"
  color: string;       // CSS color for dot
  baseUrl: string;
  defaultModel: string;
  apiStyle: 'openai' | 'anthropic';
  apiKeyHint?: string;
}

const PRESETS: Preset[] = [
  { name: 'DeepSeek',  color: '#4f6fff', baseUrl: 'https://api.deepseek.com/v1',                          defaultModel: 'deepseek-chat',            apiStyle: 'openai' },
  { name: 'OpenAI',    color: '#10a37f', baseUrl: 'https://api.openai.com/v1',                            defaultModel: 'gpt-5.4',                  apiStyle: 'openai' },
  { name: 'Anthropic', color: '#cc785c', baseUrl: 'https://api.anthropic.com/v1',                         defaultModel: 'claude-sonnet-4-6',        apiStyle: 'anthropic' },
  { name: 'Qwen',      color: '#615ced', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',    defaultModel: 'qwen-max',                 apiStyle: 'openai' },
  { name: 'GLM',       color: '#0c66e4', baseUrl: 'https://open.bigmodel.cn/api/paas/v4',                  defaultModel: 'glm-4-plus',               apiStyle: 'openai' },
  { name: 'MiniMax',   color: '#ff5d2e', baseUrl: 'https://api.minimax.chat/v1',                          defaultModel: 'abab6.5s-chat',            apiStyle: 'openai' },
  { name: 'MiMo',      color: '#ff7a45', baseUrl: 'https://api.mimo.ai/v1',                                defaultModel: 'mimo-7b',                  apiStyle: 'openai' },
  { name: 'Moonshot',  color: '#0b3d91', baseUrl: 'https://api.moonshot.cn/v1',                            defaultModel: 'moonshot-v1-32k',          apiStyle: 'openai' },
  { name: 'Doubao',    color: '#ff5722', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',              defaultModel: 'doubao-pro-32k',           apiStyle: 'openai' },
  { name: 'Yi',        color: '#7c4dff', baseUrl: 'https://api.lingyiwanwu.com/v1',                        defaultModel: 'yi-large',                 apiStyle: 'openai' },
  { name: 'Together',  color: '#0f6cbd', baseUrl: 'https://api.together.xyz/v1',                          defaultModel: 'Qwen/Qwen2.5-72B-Instruct', apiStyle: 'openai' },
  { name: 'Groq',      color: '#f55036', baseUrl: 'https://api.groq.com/openai/v1',                        defaultModel: 'llama-3.3-70b-versatile',  apiStyle: 'openai' },
  { name: 'Ollama',    color: '#6b7280', baseUrl: 'http://localhost:11434/v1',                             defaultModel: 'qwen2.5',                  apiStyle: 'openai', apiKeyHint: 'ollama (any non-empty value)' },
  { name: 'DeepInfra', color: '#9d50ff', baseUrl: 'https://api.deepinfra.com/v1/openai',                   defaultModel: 'Qwen/Qwen2.5-72B-Instruct', apiStyle: 'openai' },
  { name: 'SiliconFlow', color: '#00b96b', baseUrl: 'https://api.siliconflow.cn/v1',                       defaultModel: 'deepseek-ai/DeepSeek-V2.5', apiStyle: 'openai' },
];

function renderWarningHint(parent: HTMLElement, text: string) {
  const hint = parent.createDiv({ cls: 'nc-info-hint nc-warning-hint' });
  hint.createEl('strong', { text: bi('Warning', '警告') });
  hint.appendText(` — ${text}`);
  return hint;
}

function configOverrideValue(overrides: string | undefined, key: string): string | null {
  const rx = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*["']?([^"']+)["']?$`);
  for (const line of (overrides ?? '').split('\n')) {
    const m = line.trim().match(rx);
    if (m) return m[1].trim();
  }
  return null;
}

function codexSafetyWarning(ep: Endpoint): string | null {
  if (ep.kind !== 'codex-cli') return null;
  const overrideSandbox = configOverrideValue(ep.codexConfigOverrides, 'sandbox_mode') as Endpoint['codexSandboxMode'] | null;
  const overrideApproval = configOverrideValue(ep.codexConfigOverrides, 'approval_policy') as Endpoint['codexApprovalPolicy'] | null;
  const sandbox = overrideSandbox ?? ep.codexSandboxMode ?? 'read-only';
  const approval = overrideApproval ?? ep.codexApprovalPolicy ?? (sandbox === 'read-only' ? 'never' : 'on-request');
  const warnings: string[] = [];

  if (overrideSandbox || overrideApproval) {
    warnings.push('free-form config overrides can bypass Glossa safety defaults');
  }
  if (sandbox === 'danger-full-access') {
    warnings.push('danger-full-access lets Codex access files outside the vault and run unrestricted commands');
  } else if (sandbox === 'workspace-write') {
    warnings.push('workspace-write lets Codex modify files in its working directory');
  }
  if ((sandbox === 'workspace-write' || sandbox === 'danger-full-access') && approval === 'never') {
    warnings.push('approval_policy=never means Codex-side approval prompts may be auto-approved');
  }
  if (!ep.cliFullAgent && sandbox !== 'read-only') {
    warnings.push('non-agent Codex chat should stay read-only; override sandbox only if you understand the local side effects');
  }
  return warnings.length ? warnings.join('; ') + '.' : null;
}

function localCliWarning(kind: Endpoint['kind']): string | null {
  if (kind === 'codex-cli') {
    return 'This endpoint spawns the local codex binary and may inherit shell proxy/API-key environment. Keep sandbox read-only unless you intentionally want local file access.';
  }
  if (kind === 'claude-code-cli') {
    return 'This endpoint spawns the local claude binary. Full-agent options, extra directories, MCP config, or allowed tools can let that process read or modify local files.';
  }
  return null;
}

/* ============================================================
   Settings tab
   ============================================================ */

type SettingsTab = 'general' | 'providers' | 'agent' | 'capabilities' | 'advanced';

const SETTINGS_TABS: Array<{
  id: SettingsTab;
  label: () => string;
  title: () => string;
  description: () => string;
}> = [
  {
    id: 'general',
    label: () => bi('General', '常规'),
    title: () => bi('Everyday behavior', '日常使用'),
    description: () => bi(
      'Language, appearance, context attachment, exports, and update checks.',
      '设置语言、显示、上下文附加、导出位置与版本检查。',
    ),
  },
  {
    id: 'providers',
    label: () => bi('Models & web', '模型与网络'),
    title: () => bi('Models and network access', '模型与网络访问'),
    description: () => bi(
      'Connect a model endpoint, test it, and configure web research or proxy behavior.',
      '连接并测试模型端点，同时配置网页研究与代理行为。',
    ),
  },
  {
    id: 'agent',
    label: () => 'Agent',
    title: () => bi('Agent behavior', 'Agent 行为'),
    description: () => bi(
      'Choose the default mode, write boundary, step budget, approvals, and context compaction.',
      '设置默认模式、写入边界、步数预算、审批规则与上下文压缩。',
    ),
  },
  {
    id: 'capabilities',
    label: () => bi('Tools & skills', '工具与 Skills'),
    title: () => bi('Agent capabilities', 'Agent 能力'),
    description: () => bi(
      'See what the agent can do, which tools load on demand, and when each Skill activates.',
      '查看 Agent 能做什么、哪些工具按需加载，以及每个 Skill 何时触发。',
    ),
  },
  {
    id: 'advanced',
    label: () => bi('Data & advanced', '数据与高级'),
    title: () => bi('Data, retrieval, and advanced controls', '数据、检索与高级控制'),
    description: () => bi(
      'Encryption, checkpoints, semantic search, custom commands, and maintenance.',
      '管理加密、检查点、语义搜索、自定义命令与维护操作。',
    ),
  },
];

export class GlossaSettingTab extends PluginSettingTab {
  private activeTab: SettingsTab = 'general';
  private renderGeneration = 0;
  private readonly selectPopup = new Popup();

  constructor(app: App, public plugin: GlossaPlugin) { super(app, plugin); }

  display(): void {
    this.selectPopup.hide();
    const generation = ++this.renderGeneration;
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('nc-settings');

    const header = containerEl.createDiv({ cls: 'nc-settings-header' });
    header.dataset.glossaAlways = 'true';
    const headerMain = header.createDiv({ cls: 'nc-settings-header-main' });
    const headerCopy = headerMain.createDiv({ cls: 'nc-settings-header-copy' });
    headerCopy.createDiv({ cls: 'nc-settings-brand-heading', text: 'Glossa' });
    headerCopy.createEl('p', {
      text: bi(
        'Configure models, Agent behavior, tools, and data without digging through unrelated options.',
        '集中配置模型、Agent 行为、工具与数据，不必在无关选项之间来回查找。',
      ),
    });
    const status = headerCopy.createDiv({ cls: 'nc-settings-status' });
    const endpoint = this.plugin.settings.endpoints.find(ep => ep.id === this.plugin.settings.activeEndpointId);
    status.createSpan({
      text: endpoint
        ? bi(`Model: ${endpoint.label}`, `模型：${endpoint.label}`)
        : bi('Model not configured', '尚未配置模型'),
      cls: 'nc-settings-status-chip',
    });
    status.createSpan({
      text: this.plugin.settings.runMode === 'act' ? 'Act' : 'Plan',
      cls: `nc-settings-status-chip ${this.plugin.settings.runMode === 'act' ? 'is-act' : ''}`,
    });
    this.renderLanguageControl(headerMain);

    const bar = containerEl.createDiv({ cls: 'nc-settings-tabs' });
    bar.setAttribute('role', 'tablist');
    for (const [index, tab] of SETTINGS_TABS.entries()) {
      const tabEl = bar.createEl('button', {
        cls: `nc-settings-tab${this.activeTab === tab.id ? ' active' : ''}`,
        text: tab.label(),
        attr: { type: 'button' },
      });
      tabEl.setAttribute('role', 'tab');
      tabEl.setAttribute('aria-selected', String(this.activeTab === tab.id));
      tabEl.tabIndex = this.activeTab === tab.id ? 0 : -1;
      tabEl.onclick = () => { this.activeTab = tab.id; this.display(); };
      tabEl.onkeydown = (event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const offset = event.key === 'ArrowRight' ? 1 : -1;
        const next = SETTINGS_TABS[(index + offset + SETTINGS_TABS.length) % SETTINGS_TABS.length];
        this.activeTab = next.id;
        this.display();
        window.requestAnimationFrame(() => {
          this.containerEl.querySelector<HTMLButtonElement>('.nc-settings-tab.active')?.focus();
        });
      };
    }
    bar.dataset.glossaAlways = 'true';

    const activeCopy = SETTINGS_TABS.find(tab => tab.id === this.activeTab) ?? SETTINGS_TABS[0];
    const pageIntro = containerEl.createDiv({ cls: 'nc-settings-page-intro' });
    pageIntro.dataset.glossaAlways = 'true';
    const pageHeading = new Setting(pageIntro).setName(activeCopy.title()).setHeading();
    pageHeading.settingEl.addClass('nc-settings-page-heading');
    pageIntro.createEl('p', { text: activeCopy.description() });

    this.renderAll(containerEl, generation);
    this.applyTabFilter(containerEl);
  }

  hide(): void {
    this.selectPopup.hide();
    super.hide();
  }

  private renderLanguageControl(parent: HTMLElement): void {
    const wrap = parent.createDiv({ cls: 'nc-settings-language' });
    wrap.createSpan({ text: bi('Interface language', '界面语言'), cls: 'nc-settings-language-label' });
    const control = wrap.createDiv({ cls: 'nc-settings-language-options' });
    control.setAttribute('role', 'group');
    control.setAttribute('aria-label', bi('Interface language', '界面语言'));
    const options: Array<{ value: 'auto' | 'en' | 'zh'; label: string }> = [
      { value: 'auto', label: bi('Auto', '自动') },
      { value: 'en', label: 'EN' },
      { value: 'zh', label: '中文' },
    ];
    for (const option of options) {
      const button = control.createEl('button', {
        text: option.label,
        cls: this.plugin.settings.uiLanguage === option.value ? 'is-active' : '',
        attr: { type: 'button' },
      });
      button.setAttribute('aria-pressed', String(this.plugin.settings.uiLanguage === option.value));
      button.onclick = async () => {
        if (this.plugin.settings.uiLanguage === option.value) return;
        this.plugin.settings.uiLanguage = option.value;
        await this.plugin.saveSettings();
        this.display();
      };
    }
  }

  private applyTabFilter(container: HTMLElement) {
    // Tab assignment reads `data-tab` directly off each h3 / setting-block,
    // set at render time. The prior approach matched English h3 textContent
    // against a lookup table — translating any heading (or simplifying its
    // text) instantly broke routing and dumped the whole section into the
    // "advanced" fallback. data-tab is impervious to wording changes.
    const children = Array.from(container.children) as HTMLElement[];
    let currentTab: SettingsTab = 'general';
    for (const child of children) {
      if (child.dataset.glossaAlways === 'true') {
        setStyle(child, { display: '' });
        continue;
      }

      // Explicit data-tab attribute on h3 / setting block.
      const explicit = child.dataset?.tab as SettingsTab | undefined;
      if (explicit) { currentTab = explicit; }
      else if (child.classList.contains('nc-security-banner')) { currentTab = 'advanced'; }

      setStyle(child, { display: (currentTab === this.activeTab) ? '' : 'none' });
    }
  }

  private renderHeading(containerEl: HTMLElement, text: string, tab?: SettingsTab, always = false): Setting {
    const heading = new Setting(containerEl).setName(text).setHeading();
    if (tab) heading.settingEl.dataset.tab = tab;
    if (always) heading.settingEl.dataset.glossaAlways = 'true';
    return heading;
  }

  private createSettingsGroup(parent: HTMLElement, title: string, desc?: string, open = false, tab?: SettingsTab): HTMLElement {
    const details = parent.createEl('details', { cls: 'nc-settings-group' });
    if (tab) details.dataset.tab = tab;
    details.open = open;
    const summary = details.createEl('summary', { cls: 'nc-settings-group-summary' });
    summary.createSpan({ cls: 'nc-settings-group-title', text: title });
    if (desc) summary.createSpan({ cls: 'nc-settings-group-desc', text: desc });
    return details.createDiv({ cls: 'nc-settings-group-body' });
  }

  private renderCapabilities(containerEl: HTMLElement, generation: number): void {
    this.renderHeading(containerEl, bi('Tools & Skills', '工具与 Skills'), 'capabilities');
    const catalog = buildToolCapabilities(this.plugin.settings.agentAlwaysApproveTools);
    const initialCount = catalog.filter(tool => !tool.deferred).length;
    const deferredCount = catalog.length - initialCount;

    const overview = containerEl.createDiv({ cls: 'nc-capability-overview' });
    const intro = overview.createDiv({ cls: 'nc-capability-overview-copy' });
    intro.createEl('strong', { text: bi('Progressive capability loading', '渐进式能力加载') });
    intro.createEl('p', {
      text: bi(
        'Core tool schemas are ready immediately. Specialized tools and full Skill instructions load only when the task matches, keeping the model context focused.',
        '核心工具会立即可用；专业工具与完整 Skill 指令只在任务匹配时加载，让模型上下文保持专注。',
      ),
    });
    const stats = overview.createDiv({ cls: 'nc-capability-stats' });
    this.renderCapabilityStat(stats, String(catalog.length), bi('Available tools', '可用工具'));
    this.renderCapabilityStat(stats, String(initialCount), bi('Ready by default', '默认加载'));
    this.renderCapabilityStat(stats, String(deferredCount), bi('On demand', '按需加载'));
    const skillCount = this.renderCapabilityStat(stats, '…', 'Skills');

    const searchWrap = containerEl.createDiv({ cls: 'nc-capability-search' });
    const searchIcon = searchWrap.createSpan({ cls: 'nc-capability-search-icon' });
    setTrustedSvg(searchIcon, ICON.search);
    const search = searchWrap.createEl('input', {
      type: 'search',
      placeholder: bi('Search tools and Skills', '搜索工具与 Skills'),
      attr: { 'aria-label': bi('Search tools and Skills', '搜索工具与 Skills') },
    });

    const toolSection = containerEl.createEl('section', { cls: 'nc-capability-section' });
    const toolHeader = toolSection.createDiv({ cls: 'nc-capability-section-head' });
    const toolHeading = new Setting(toolHeader).setName(bi('Tools', '工具')).setHeading();
    toolHeading.settingEl.addClass('nc-capability-section-heading');
    toolHeader.createSpan({ text: String(catalog.length) });
    const toolGroups = toolSection.createDiv({ cls: 'nc-capability-groups' });
    for (const category of TOOL_CATEGORY_ORDER) {
      const tools = catalog.filter(tool => tool.category === category);
      if (tools.length === 0) continue;
      const group = toolGroups.createDiv({ cls: 'nc-capability-group' });
      const groupHeading = new Setting(group)
        .setName(bi(TOOL_CATEGORY_COPY[category].en, TOOL_CATEGORY_COPY[category].zh))
        .setHeading();
      groupHeading.settingEl.addClass('nc-capability-group-heading');
      const rows = group.createDiv({ cls: 'nc-capability-list' });
      for (const tool of tools) this.renderToolCapability(rows, tool);
    }

    const skillSection = containerEl.createEl('section', { cls: 'nc-capability-section nc-skill-section' });
    const skillHeader = skillSection.createDiv({ cls: 'nc-capability-section-head' });
    const skillHeading = new Setting(skillHeader).setName('Skills').setHeading();
    skillHeading.settingEl.addClass('nc-capability-section-heading');
    skillHeader.createSpan({ text: bi('Loading…', '加载中…'), cls: 'nc-skill-count' });
    const skillList = skillSection.createDiv({ cls: 'nc-capability-list' });
    skillList.createDiv({ cls: 'nc-capability-loading', text: bi('Discovering available Skills…', '正在发现可用 Skills…') });

    const empty = containerEl.createDiv({
      cls: 'nc-capability-empty',
      text: bi('No matching tools or Skills.', '没有匹配的工具或 Skill。'),
    });
    setStyle(empty, { display: 'none' });

    const applySearch = () => {
      const query = search.value.trim().toLocaleLowerCase();
      let visible = 0;
      for (const row of Array.from(containerEl.querySelectorAll<HTMLElement>('.nc-capability-row'))) {
        const match = !query || (row.dataset.filterText ?? '').includes(query);
        row.toggleClass('is-filtered', !match);
        if (match) visible += 1;
      }
      for (const group of Array.from(toolGroups.querySelectorAll<HTMLElement>('.nc-capability-group'))) {
        group.toggleClass('is-filtered', !group.querySelector('.nc-capability-row:not(.is-filtered)'));
      }
      toolSection.toggleClass('is-filtered', !toolSection.querySelector('.nc-capability-row:not(.is-filtered)'));
      skillSection.toggleClass('is-filtered', !skillSection.querySelector('.nc-capability-row:not(.is-filtered)'));
      setStyle(empty, { display: visible === 0 ? '' : 'none' });
    };
    search.oninput = applySearch;

    if (this.activeTab !== 'capabilities') return;
    void discoverSkills(this.app).then(skills => {
      if (generation !== this.renderGeneration || !skillList.isConnected) return;
      skillList.empty();
      const availableTools = new Set(catalog.map(tool => tool.name));
      for (const skill of skills) this.renderSkillCapability(skillList, skill, availableTools);
      skillHeader.querySelector('.nc-skill-count')?.setText(String(skills.length));
      skillCount.setText(String(skills.length));
      if (skills.length === 0) {
        skillList.createDiv({
          cls: 'nc-capability-loading',
          text: bi('No Skills are available.', '当前没有可用 Skill。'),
        });
      }
      applySearch();
    }).catch(() => {
      if (generation !== this.renderGeneration || !skillList.isConnected) return;
      skillList.empty();
      skillList.createDiv({
        cls: 'nc-capability-loading',
        text: bi('Skills could not be loaded.', 'Skills 加载失败。'),
      });
      skillHeader.querySelector('.nc-skill-count')?.setText('0');
      skillCount.setText('0');
      applySearch();
    });
  }

  private renderCapabilityStat(parent: HTMLElement, value: string, label: string): HTMLElement {
    const stat = parent.createDiv({ cls: 'nc-capability-stat' });
    const valueEl = stat.createEl('strong', { text: value });
    stat.createSpan({ text: label });
    return valueEl;
  }

  private renderToolCapability(parent: HTMLElement, tool: ToolCapability): void {
    const row = parent.createDiv({ cls: 'nc-capability-row nc-tool-capability' });
    const label = bi(tool.labelEn, tool.labelZh);
    const description = bi(tool.descriptionEn, tool.descriptionZh);
    row.dataset.filterText = `${tool.name} ${tool.labelEn} ${tool.labelZh} ${tool.descriptionEn} ${tool.descriptionZh}`.toLocaleLowerCase();
    const icon = row.createSpan({ cls: 'nc-capability-icon' });
    setTrustedSvg(icon, tool.icon);
    const copy = row.createDiv({ cls: 'nc-capability-copy' });
    const title = copy.createDiv({ cls: 'nc-capability-title' });
    title.createEl('strong', { text: label });
    title.createEl('code', { text: tool.name });
    copy.createEl('p', { text: description });
    const badges = row.createDiv({ cls: 'nc-capability-badges' });
    badges.createSpan({
      cls: tool.deferred ? 'is-deferred' : 'is-ready',
      text: tool.deferred ? bi('On demand', '按需加载') : bi('Ready', '默认可用'),
    });
    if (tool.autoApproved) {
      badges.createSpan({ cls: 'is-approved', text: bi('Auto-approved', '自动批准') });
    } else if (tool.dangerous) {
      badges.createSpan({ cls: 'is-approval', text: bi('Approval', '需要审批') });
    } else {
      badges.createSpan({ text: bi('Read only', '只读') });
    }
  }

  private renderSkillCapability(parent: HTMLElement, skill: Skill, availableTools: ReadonlySet<string>): void {
    const zh = BUNDLED_SKILL_ZH[skill.name];
    const titleText = bi(skill.title, zh?.title ?? skill.title);
    const description = bi(skill.description, zh?.description ?? skill.description);
    const when = bi(skill.whenToUse ?? '', zh?.whenToUse ?? skill.whenToUse ?? '');
    const issues = validateSkillDefinition(skill, availableTools);
    const errors = issues.filter(issue => issue.severity === 'error').length;
    const warnings = issues.length - errors;
    const row = parent.createDiv({ cls: 'nc-capability-row nc-skill-capability' });
    row.dataset.filterText = [
      skill.name, skill.title, titleText, skill.description, description, skill.whenToUse, when,
      ...(skill.triggers ?? []), ...(skill.paths ?? []), ...(skill.requiredTools ?? []),
    ].filter(Boolean).join(' ').toLocaleLowerCase();
    const icon = row.createSpan({ cls: 'nc-capability-icon' });
    setTrustedSvg(icon, ICON.sparkles);
    const copy = row.createDiv({ cls: 'nc-capability-copy' });
    const title = copy.createDiv({ cls: 'nc-capability-title' });
    title.createEl('strong', { text: titleText });
    title.createEl('code', { text: skill.name });
    copy.createEl('p', { text: description });
    if (when) {
      const whenEl = copy.createEl('p', { cls: 'nc-skill-when' });
      whenEl.createSpan({ text: bi('When', '触发') });
      whenEl.appendText(when);
    }
    const details = copy.createDiv({ cls: 'nc-skill-details' });
    for (const path of (skill.paths ?? []).slice(0, 3)) details.createEl('code', { text: path });
    for (const tool of (skill.requiredTools ?? []).slice(0, 4)) details.createEl('code', { text: tool });
    const badges = row.createDiv({ cls: 'nc-capability-badges' });
    badges.createSpan({ text: this.skillSourceLabel(skill.source) });
    if (errors > 0) badges.createSpan({ cls: 'is-error', text: bi(`${errors} error`, `${errors} 个错误`) });
    else if (warnings > 0) badges.createSpan({ cls: 'is-warning', text: bi(`${warnings} warning`, `${warnings} 个提醒`) });
    else badges.createSpan({ cls: 'is-ready', text: bi('Ready', '可用') });
    if (skill.context === 'fork') badges.createSpan({ text: bi('Isolated', '隔离运行') });
  }

  private skillSourceLabel(source: Skill['source']): string {
    if (source === 'bundled') return bi('Built in', '内置');
    if (source === 'project') return bi('Vault', 'Vault');
    if (source === 'project-nested') return bi('Project', '项目');
    if (source === 'legacy') return bi('Legacy', '旧版');
    return bi('User', '用户');
  }

  private renderAll(containerEl: HTMLElement, generation: number): void {

    // Security banner — only shown when encryption is ON, so users in the
    // default (plaintext) flow aren't nagged about it on every settings open.
    // When encryption is on we still surface lock/mixed states so the user can
    // act on them. The dedicated "Encryption" section near the bottom handles
    // the opt-in for users who want it.
    if (this.plugin.settings.encryptionEnabled) {
      const hasAnyPlainKey = this.plugin.settings.endpoints.some(ep => ep.apiKey && !ep.apiKey.startsWith('NCENC1:'));
      const hasAnyEncKey   = this.plugin.settings.endpoints.some(ep => ep.apiKey && ep.apiKey.startsWith('NCENC1:'));
      const sec = containerEl.createDiv({ cls: 'nc-security-banner', attr: { 'data-tab': 'advanced' } });
      let title = '', body = '';
      if (!this.plugin.isUnlocked()) {
        title = bi('Encrypted · locked', '已加密 · 已锁定');
        body = bi(
          'Keys are encrypted at rest. Run “Unlock encrypted keys” from the command palette before using the endpoint.',
          '密钥已加密保存。使用端点前，请在命令面板运行“解锁加密密钥”。',
        );
        sec.addClass('is-locked');
      } else if (hasAnyPlainKey && hasAnyEncKey) {
        title = bi('Mixed key storage', '密钥存储状态不一致');
        body = bi(
          'Some endpoints still contain plaintext keys. Re-enter those keys to encrypt them.',
          '部分端点仍保存着明文密钥，请重新输入这些密钥以完成加密。',
        );
        sec.addClass('is-mixed');
      } else {
        title = bi('Encrypted · unlocked', '已加密 · 已解锁');
        body = bi(
          'Keys are decrypted in memory only. Restarting the app locks them again; the passphrase is never stored.',
          '密钥只在内存中解密。重启应用后会重新锁定，passphrase 不会被保存。',
        );
        sec.addClass('is-unlocked');
      }
      sec.createDiv({ cls: 'nc-security-title', text: title });
      sec.createDiv({ cls: 'nc-security-body', text: body });
    }

    /* ----- Font size — drives the WHOLE plugin (prose + reasoning + lists) ----- */
    const fontSetting = new Setting(containerEl)
      .setName(t('font_size'))
      .setDesc(bi('Controls text throughout the sidebar. Default: 13 px.', '控制侧栏中的整体文字大小，默认 13 px。'))
      .addSlider(s => {
        s.setLimits(11, 18, 1).setValue(this.plugin.settings.reasoningFontSize ?? 13).setDynamicTooltip();
        // Debounce: Obsidian's slider fires 'input' on every drag pixel, which
        // would re-run iterateAllLeaves+applyCssVars per pixel — heavy. Wait
        // 150ms after the user stops moving before applying.
        let timer: AnyValue = null;
        s.onChange(v => {
          this.plugin.settings.reasoningFontSize = v;
          if (timer) window.clearTimeout(timer);
          timer = window.setTimeout(() => {
            timer = null;
            void (async () => {
              await this.plugin.saveSettings();
              this.plugin.app.workspace.iterateAllLeaves(l => {
                const view: AnyValue = (l.view as AnyValue);
                if (typeof view.applyCssVars === 'function') view.applyCssVars();
              });
            })();
          }, 150);
        });
      });
    fontSetting.settingEl.dataset.tab = 'general';

    const updateSetting = new Setting(containerEl)
      .setName(bi('Update checks', '版本更新检查'))
      .setDesc(bi('Check GitHub releases every 12 hours. Obsidian marketplace updates may appear later.', '每 12 小时检查 GitHub Release。Obsidian 插件市场同步可能稍晚。'))
      .addToggle(tg => tg
        .setValue(this.plugin.settings.updateCheckEnabled)
        .onChange(async v => {
          this.plugin.settings.updateCheckEnabled = v;
          await this.plugin.saveSettings();
        }))
      .addButton(btn => btn
        .setButtonText(bi('Check now', '立即检查'))
        .onClick(async () => {
          btn.setButtonText(bi('Checking...', '检查中...'));
          btn.setDisabled(true);
          try {
            await this.plugin.checkForUpdates({ force: true, notify: true });
          } finally {
            btn.setDisabled(false);
            btn.setButtonText(bi('Check now', '立即检查'));
          }
        }));
    updateSetting.settingEl.dataset.tab = 'general';

    /* ----- Active endpoint ----- */
    const activeEpSetting = new Setting(containerEl)
      .setName(bi('Active model endpoint', '当前模型端点'))
      .setDesc(bi('Used for new messages unless a conversation already has its own endpoint.', '新消息默认使用该端点；已有对话仍保留各自选择。'));
    const endpointOptions: AlignedSelectOption<string>[] = this.plugin.settings.endpoints.length === 0
      ? [{ value: '', label: bi('None · add an endpoint below', '无 · 请在下方添加端点') }]
      : this.plugin.settings.endpoints.map(ep => ({ value: ep.id, label: ep.label, hint: ep.kind }));
    createAlignedSelect(
      activeEpSetting.controlEl,
      this.selectPopup,
      endpointOptions,
      this.plugin.settings.activeEndpointId ?? '',
      async value => {
        this.plugin.settings.activeEndpointId = value || null;
        await this.plugin.saveSettings();
      },
      bi('Active model endpoint', '当前模型端点'),
    );
    activeEpSetting.settingEl.dataset.tab = 'providers';

    /* ----- Proxy ----- */
    this.renderHeading(containerEl, bi('Network', '网络'), 'providers');
    const proxySetting = new Setting(containerEl)
      .setName(bi('Proxy', '代理'))
      .setDesc(bi('CLI only. Custom API follows system proxy.', '只对 CLI 生效。Custom API 跟随系统代理。'))
      .addText(t => t.setPlaceholder(HTTP_PROXY_PLACEHOLDER)
        .setValue(this.plugin.settings.globalProxy)
        .onChange(async v => { this.plugin.settings.globalProxy = v.trim(); await this.plugin.saveSettings(); }));
    // Stable id so other modals (codex diagnostic "Open proxy settings" button)
    // can scrollIntoView this exact field without depending on the label text
    // — labels are translated and frequently renamed.
    proxySetting.settingEl.dataset.glossaId = 'global-proxy';

    /* ----- Web research ----- */
    const webGroup = this.createSettingsGroup(
      containerEl,
      bi('Web research and downloads', '网页研究与下载'),
      bi('Search provider, approvals, download limits, and provenance.', '搜索来源、审批、下载限制与来源记录。'),
      false,
      'providers',
    );
    const searchProviderSetting = new Setting(webGroup)
      .setName(bi('Search provider', '搜索 provider'))
      .setDesc(bi('Auto uses free vertical sources first, then fallback search. For Claude/Codex-like quality, configure Brave, Tavily, Exa, or SerpAPI.', 'Auto 会先用免费垂直源，再 fallback 搜索。想接近 Claude/Codex 的搜索质量，建议配置 Brave、Tavily、Exa 或 SerpAPI。'));
    createAlignedSelect(
      searchProviderSetting.controlEl,
      this.selectPopup,
      [
        { value: 'auto', label: bi('Auto', '自动'), hint: bi('Recommended', '推荐') },
        { value: 'duckduckgo', label: 'DuckDuckGo', hint: bi('Fallback', '备用') },
        { value: 'brave', label: 'Brave Search' },
        { value: 'tavily', label: 'Tavily' },
        { value: 'exa', label: 'Exa' },
        { value: 'serpapi', label: 'SerpAPI' },
      ] as const,
      this.plugin.settings.webSearchProvider,
      async value => {
        this.plugin.settings.webSearchProvider = value;
        await this.plugin.saveSettings();
        this.display();
      },
      bi('Search provider', '搜索 provider'),
    );
    if (this.plugin.settings.webSearchProvider !== 'duckduckgo' && this.plugin.settings.webSearchProvider !== 'auto') {
      new Setting(webGroup)
        .setName(bi('Search API key', '搜索 API key'))
        .setDesc(bi('Stored in plugin settings. Use a provider-specific key.', '保存在插件设置中。填写对应 provider 的 key。'))
        .addText(t => {
          t.inputEl.type = 'password';
          t.setPlaceholder(API_KEY_PLACEHOLDER)
            .setValue(this.plugin.settings.webSearchApiKey ?? '')
            .onChange(async v => {
              this.plugin.settings.webSearchApiKey = v.trim();
              await this.plugin.saveSettings();
            });
        });
    }
    new Setting(webGroup)
      .setName(bi('Auto-approve web reads', '自动批准网页读取'))
      .setDesc(bi('Skip approval for web_search, web_research, and web_fetch. Downloads still need their own setting/approval.', '跳过 web_search、web_research、web_fetch 的审批。下载仍然单独受下载设置/审批控制。'))
      .addToggle(t => t
        .setValue(!!this.plugin.settings.webAutoApproveNetworkReads)
        .onChange(async v => {
          this.plugin.settings.webAutoApproveNetworkReads = v;
          await this.plugin.saveSettings();
        }));
    new Setting(webGroup)
      .setName(bi('Download folder', '下载目录'))
      .setDesc(bi('Default vault folder for download_file when no path is given.', 'download_file 没指定路径时的默认 vault 目录。'))
      .addText(t => t
        .setPlaceholder('Downloads/Glossa')
        .setValue(this.plugin.settings.webDefaultDownloadFolder)
        .onChange(async v => {
          this.plugin.settings.webDefaultDownloadFolder = v.trim() || 'Downloads/Glossa';
          await this.plugin.saveSettings();
        }));
    new Setting(webGroup)
      .setName(bi('Max download MB', '最大下载 MB'))
      .setDesc(bi('Safety cap for download_file. Tool args can only lower or raise within the hard cap.', 'download_file 的安全上限。工具参数仍受硬上限限制。'))
      .addText(t => t
        .setValue(String(Math.round((this.plugin.settings.webMaxDownloadBytes ?? 80 * 1024 * 1024) / (1024 * 1024))))
        .onChange(async v => {
          const mb = parseClampedInt(v, 80, 1, 250);
          this.plugin.settings.webMaxDownloadBytes = mb * 1024 * 1024;
          await this.plugin.saveSettings();
        }));
    new Setting(webGroup)
      .setName(bi('Allow auto download', '允许自动下载'))
      .setDesc(bi('Off = model should ask before downloads even in Act mode. Recommended off.', '关闭 = 即使 Act 模式也应先确认再下载。推荐关闭。'))
      .addToggle(t => t
        .setValue(!!this.plugin.settings.webAllowAutoDownload)
        .onChange(async v => {
          this.plugin.settings.webAllowAutoDownload = v;
          await this.plugin.saveSettings();
        }));
    new Setting(webGroup)
      .setName(bi('Save provenance', '保存来源记录'))
      .setDesc(bi('Write a .source.json file next to downloaded files.', '在下载文件旁边写入 .source.json 来源记录。'))
      .addToggle(t => t
        .setValue(this.plugin.settings.webSaveProvenance !== false)
        .onChange(async v => {
          this.plugin.settings.webSaveProvenance = v;
          await this.plugin.saveSettings();
        }));

    /* ----- Context ----- */
    this.renderHeading(containerEl, bi('Context', '上下文'), 'general');
    new Setting(containerEl)
      .setName(bi('Auto-attach current file', '自动附加当前文件'))
      .setDesc(bi(
        'Make the active note available as ambient context so prompts like “summarize this file” work without a manual attachment.',
        '把当前打开的笔记作为环境上下文，让“总结当前文件”这类请求无需手动附加。',
      ))
      .addToggle(t => t
      .setValue(this.plugin.settings.autoAttachCurrentFile)
      .onChange(async v => { this.plugin.settings.autoAttachCurrentFile = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName(bi('Auto-attach selection', '自动附加选中'))
      .setDesc(bi(
        'When text is selected, treat it as the most specific context. Supports editor, PDF, and rendered HTML selections.',
        '存在选中文本时，将其作为最精确的上下文。支持编辑器、PDF 与渲染后的 HTML 选区。',
      ))
      .addToggle(t => t
        .setValue(this.plugin.settings.autoAttachSelection)
        .onChange(async v => { this.plugin.settings.autoAttachSelection = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl)
      .setName(bi('Quick translate selection', '快速翻译选区'))
      .setDesc(bi(
        'Double-press Enter to translate the current selection in a floating panel. Assign any additional shortcut to “Translate selection in popup” in the app hotkey settings.',
        '连续按两次 Enter，在选区旁的浮层中翻译。还可以在软件快捷键设置中为“Translate selection in popup”绑定任意快捷键。',
      ))
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.selectionTranslateDoubleEnterEnabled)
        .onChange(async value => {
          this.plugin.settings.selectionTranslateDoubleEnterEnabled = value;
          await this.plugin.saveSettings();
        }));
    const translationEndpointSetting = new Setting(containerEl)
      .setName(bi('Translation endpoint', '翻译端点'))
      .setDesc(bi(
        'Use the sidebar endpoint or choose a dedicated provider configuration for quick translation.',
        '跟随侧栏端点，或为快速翻译单独选择一个服务端点。',
      ));
    createAlignedSelect(
      translationEndpointSetting.controlEl,
      this.selectPopup,
      [
        { value: '', label: bi('Follow sidebar endpoint', '跟随侧栏端点') },
        ...this.plugin.settings.endpoints.map(endpoint => ({
          value: endpoint.id,
          label: endpoint.label,
          hint: endpoint.model || endpoint.kind,
        })),
      ],
      this.plugin.settings.translationEndpointId ?? '',
      async value => {
        this.plugin.settings.translationEndpointId = value || null;
        this.plugin.settings.translationModel = '';
        await this.plugin.saveSettings();
        this.display();
      },
      bi('Translation endpoint', '翻译端点'),
    );
    const translationEndpoint = this.plugin.settings.endpoints.find(
      endpoint => endpoint.id === this.plugin.settings.translationEndpointId,
    ) ?? this.plugin.settings.endpoints.find(
      endpoint => endpoint.id === this.plugin.settings.activeEndpointId,
    ) ?? null;
    const translationModels = translationEndpoint
      ? normalizeModelList([
        this.plugin.settings.translationModel,
        translationEndpoint.model ?? '',
        ...(translationEndpoint.availableModels ?? []),
      ])
      : [];
    const translationModelSetting = new Setting(containerEl)
      .setName(bi('Translation model', '翻译模型'))
      .setDesc(bi(
        'Choose any detected model on this endpoint. Quick translation disables reasoning for lower latency.',
        '选择该端点已探测到的任意模型。快速翻译会关闭推理以降低延迟。',
      ));
    createAlignedSelect(
      translationModelSetting.controlEl,
      this.selectPopup,
      [
        {
          value: '',
          label: bi('Use endpoint default', '使用端点默认模型'),
          hint: translationEndpoint?.model || undefined,
        },
        ...translationModels.map(model => ({ value: model, label: model })),
      ],
      this.plugin.settings.translationEndpointId ? this.plugin.settings.translationModel : '',
      async value => {
        this.plugin.settings.translationModel = value;
        if (value && translationEndpoint) {
          this.plugin.settings.translationEndpointId = translationEndpoint.id;
        }
        await this.plugin.saveSettings();
        this.display();
      },
      bi('Translation model', '翻译模型'),
    );
    new Setting(containerEl).setName(bi('Context warning threshold', '上下文警告阈值'))
      .setDesc(bi('Highlight the token counter after this estimated context size is reached.', '估算上下文达到该 token 数后，高亮顶部计数器。'))
      .addText(t => t.setValue(String(this.plugin.settings.warnTokenThreshold))
        .onChange(async v => {
          this.plugin.settings.warnTokenThreshold = parseClampedInt(v, 500_000, 10_000, 5_000_000);
          await this.plugin.saveSettings();
        }));
    new Setting(containerEl).setName(bi('Usage bar', '用量条'))
      .setDesc(bi('Show token and estimated cost information below the composer when available.', '在可估算时，于输入区下方显示 token 与费用信息。'))
      .addToggle(t => t
      .setValue(this.plugin.settings.showCostBar)
      .onChange(async v => { this.plugin.settings.showCostBar = v; await this.plugin.saveSettings(); }));

    /* ----- Agent ----- */
    this.renderHeading(containerEl, 'Agent', 'agent');
    const permissionSetting = new Setting(containerEl).setName(bi('Permission', '权限'))
      .setDesc(bi(
        'Read only blocks vault edits. Vault write allows note changes with approval. Full also permits high-impact tools when available.',
        '只读会阻止 vault 编辑；允许写入可在审批后修改笔记；完整权限还允许可用的高影响工具。',
      ));
    createAlignedSelect(
      permissionSetting.controlEl,
      this.selectPopup,
      [
        { value: 'read-only', label: bi('Read only', '只读') },
        { value: 'workspace-write', label: bi('Vault write', '允许写入 vault') },
        { value: 'full', label: bi('Full access', '完整权限') },
      ] as const,
      this.plugin.settings.permissionLevel,
      async value => {
        this.plugin.settings.permissionLevel = value;
        await this.plugin.saveSettings();
      },
      bi('Agent permission', 'Agent 权限'),
    );
    const modeSetting = new Setting(containerEl)
      .setName(bi('Default mode', '默认模式'))
      .setDesc(bi('Plan analyzes and proposes without writing. Act may execute approved tools and edits.', 'Plan 只分析与提出方案，不写入；Act 可执行已批准的工具与编辑。'));
    createAlignedSelect(
      modeSetting.controlEl,
      this.selectPopup,
      [
        { value: 'plan', label: 'Plan', hint: bi('No writes', '不写入') },
        { value: 'act', label: 'Act', hint: bi('Run approved actions', '执行已批准操作') },
      ] as const,
      this.plugin.settings.runMode,
      async value => {
        this.plugin.settings.runMode = value;
        await this.plugin.saveSettings();
      },
      bi('Default Agent mode', '默认 Agent 模式'),
    );
    new Setting(containerEl).setName(bi('Max steps', '最大步数'))
      .setDesc(bi('Maximum model/tool iterations in one Agent run. Higher values help long tasks but use more time and tokens.', '单次 Agent 运行允许的最大模型/工具迭代次数。数值越高，长任务越完整，但耗时和 token 也更多。'))
      .addText(t => t.setValue(String(this.plugin.settings.agentMaxSteps))
        .onChange(async v => {
          this.plugin.settings.agentMaxSteps = parseClampedInt(v, 20, 1, 100);
          await this.plugin.saveSettings();
        }));
    new Setting(containerEl).setName(bi('Project context', '项目上下文'))
      .setDesc(bi('Load nearby AGENTS.md, CLAUDE.md, or .codex.md files as project instructions for the active task.', '把当前任务附近的 AGENTS.md、CLAUDE.md 或 .codex.md 作为项目规则加载。'))
      .addToggle(t => t.setValue(this.plugin.settings.loadProjectContext)
        .onChange(async v => { this.plugin.settings.loadProjectContext = v; await this.plugin.saveSettings(); }));

    this.renderCapabilities(containerEl, generation);

    /* Auto-approve checkboxes per tool */
    const autoGroup = this.createSettingsGroup(
      containerEl,
      bi('Auto-approve tools', '自动批准工具'),
      bi('Skip per-call approval only for tools you trust.', '只对你信任的工具跳过逐次审批。'),
      false,
      'capabilities',
    );
    const autoCard = autoGroup.createDiv({ cls: 'nc-endpoint-card nc-settings-plain-card' });
    autoCard.createDiv({ cls: 'nc-endpoint-card-header' }).createSpan({ text: bi('Auto-approve', '自动批准') });
    const allTools = buildToolCapabilities(this.plugin.settings.agentAlwaysApproveTools);
    for (const tool of allTools) {
      const label = `${bi(tool.labelEn, tool.labelZh)}${tool.dangerous ? bi(' · approval', ' · 需审批') : ''}`;
      new Setting(autoCard)
        .setName(label)
        .setDesc(`${tool.name} · ${bi(tool.descriptionEn, tool.descriptionZh)}`)
        .addToggle(tg => tg.setValue(this.plugin.settings.agentAlwaysApproveTools.includes(tool.name))
          .onChange(async v => {
            const list = new Set(this.plugin.settings.agentAlwaysApproveTools);
            if (v) list.add(tool.name); else list.delete(tool.name);
            this.plugin.settings.agentAlwaysApproveTools = [...list];
            await this.plugin.saveSettings();
          }));
    }

    /* ----- Persisted permission rules (from "Always allow…" choices) ----- */
    const ruleGroup = this.createSettingsGroup(
      containerEl,
      bi('Approval rules', '批准规则'),
      bi('Saved “always allow” choices and audit log.', '保存的“始终允许”选择和审计日志。'),
      false,
      'agent',
    );
    ruleGroup.createEl('p', { cls: 'setting-item-description',
      text: bi(
        'Rules saved from “always allow” decisions. The Agent checks them before showing another approval.',
        '这里保存“始终允许”产生的规则。Agent 会先检查规则，再决定是否显示审批。',
      ) });
    const rules = this.plugin.settings.permissionRules ?? [];
    if (rules.length === 0) {
      ruleGroup.createEl('p', { cls: 'setting-item-description', text: bi('No saved rules.', '暂无已保存规则。') });
    } else {
      for (const r of rules) {
        const row = ruleGroup.createDiv({ cls: 'nc-permission-rule' });
        const lab = row.createSpan();
        lab.appendChild(activeDocument.createTextNode(`${r.behavior === 'allow' ? '✓' : '✗'} `));
        const codeEl = lab.appendChild(activeWindow.createEl('code'));
        codeEl.textContent = r.tool;
        if (r.scope !== 'global' && r.value) {
          lab.appendChild(activeDocument.createTextNode(` · ${r.scope}: `));
          const v = lab.appendChild(activeWindow.createEl('code'));
          v.textContent = r.value;
        } else {
          lab.appendChild(activeDocument.createTextNode(bi(' · everywhere', ' · 全部位置')));
        }
        row.createSpan({ cls: 'nc-permission-rule-meta', text: new Date(r.addedAt).toLocaleDateString() });
        const del = row.createEl('button', { text: '✕', cls: 'mod-warning' });
        setStyle(del, { marginLeft: 'auto' });
        del.onclick = async () => {
          this.plugin.settings.permissionRules = rules.filter(x => x !== r);
          await this.plugin.saveSettings();
          this.display();
        };
      }
      new Setting(ruleGroup).addButton(b => b.setButtonText(bi('Clear all rules', '清除全部规则')).setWarning().onClick(async () => {
        this.plugin.settings.permissionRules = [];
        await this.plugin.saveSettings();
        this.display();
      }));
    }

    /* ----- Approval audit log ----- */
    const log = this.plugin.settings.permissionLog ?? [];
    if (log.length > 0) {
      const det = ruleGroup.createEl('details', { cls: 'nc-settings-subdetails' });
      const summary = det.createEl('summary', {
        text: bi(`Last ${log.length} decisions · newest first`, `最近 ${log.length} 条决定 · 新的在前`),
      });
      setStyle(summary, { cursor: 'pointer', fontSize: '12px', color: 'var(--text-muted)' });
      const tbl = det.createDiv();
      setStyle(tbl, { maxHeight: '240px', overflowY: 'auto', fontSize: '11px', fontFamily: 'var(--font-monospace)', marginTop: '8px' });
      for (const e of log.slice().reverse().slice(0, 100)) {
        const row = tbl.createDiv();
        setStyle(row, { padding: '3px 0', display: 'flex', gap: '8px', borderBottom: '1px solid var(--background-modifier-border)' });
        const date = new Date(e.at);
        const dateEl = row.createSpan({ text: date.toLocaleTimeString() });
        setStyle(dateEl, { color: 'var(--text-faint)', minWidth: '80px' });
        const colors: Record<string, string> = {
          'allow': 'var(--glossa-success)', 'auto-allow': 'var(--glossa-success)', 'allowed-by-rule': 'var(--glossa-active-text)',
          'deny': 'var(--glossa-danger)', 'auto-deny': 'var(--glossa-danger)', 'denied-by-rule': 'var(--glossa-danger)',
        };
        const decisionEl = row.createSpan({ text: e.decision });
        setStyle(decisionEl, { color: colors[e.decision] ?? 'var(--text-muted)', minWidth: '110px', fontWeight: '600' });
        const toolEl = row.createSpan({ text: e.tool });
        setStyle(toolEl, { color: 'var(--text-normal)', minWidth: '120px' });
        if (e.scope) {
          const scopeEl = row.createSpan({ text: e.scope });
          setStyle(scopeEl, { color: 'var(--text-muted)' });
        }
        if (e.args) {
          const argsEl = row.createSpan({ text: e.args });
          setStyle(argsEl, { color: 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '1' });
        }
      }
      new Setting(ruleGroup).addButton(b => b.setButtonText(bi('Clear log', '清除日志')).onClick(async () => {
        this.plugin.settings.permissionLog = [];
        await this.plugin.saveSettings();
        this.display();
      }));
    }

    /* ----- Encryption (optional) ----- */
    this.renderHeading(containerEl, bi('Encryption', '加密'), 'advanced');
    containerEl.createEl('p', { cls: 'setting-item-description',
      text: this.plugin.settings.encryptionEnabled
        ? (this.plugin.isUnlocked() ? bi('🔓 unlocked', '🔓 已解锁') : bi('🔒 locked', '🔒 已锁定'))
        : bi('Off. Enabling wraps API keys with a passphrase-derived AES-256 key.',
             '关闭。开启后用 passphrase 派生 AES-256 加密 API key。') });
    // Scope clarification — kept brief. Users should know chats.json is plaintext.
    const scope = containerEl.createDiv({ cls: 'nc-info-hint' });
    scope.appendText(bi(
      'Scope: API keys, embeddings, checkpoints. Chats are NOT encrypted.',
      '范围：API key、嵌入向量、检查点。对话历史不加密。',
    ));
    new Setting(containerEl).setName(bi('Passphrase encryption', 'Passphrase 加密'))
      .setDesc(bi('AES-256 + PBKDF2 600k.', 'AES-256 + PBKDF2 600k。'))
      .addButton(b => b.setButtonText(this.plugin.settings.encryptionEnabled ? bi('Disable', '关闭') : bi('Enable', '开启')).setCta()
        .onClick(async () => {
          if (this.plugin.settings.encryptionEnabled) await this.plugin.disableEncryption();
          else await this.plugin.enableEncryption();
          this.display();
        }));
    if (this.plugin.settings.encryptionEnabled) {
      new Setting(containerEl).setName(bi('Lock', '锁定'))
        .setDesc(bi('Remove decrypted keys from memory immediately.', '立即从内存中移除已解密密钥。'))
        .addButton(b => b.setButtonText(bi('Lock', '锁定')).onClick(() => { void this.plugin.lock(); void this.display(); }));
      new Setting(containerEl).setName(bi('Encrypt plaintext keys', '加密明文密钥'))
        .setDesc(bi('Wrap any remaining plaintext API keys.', '加密剩余明文 API key。'))
        .addButton(b => b.setButtonText(bi('Run', '运行')).setCta().onClick(async () => {
          b.setDisabled(true).setButtonText(bi('Running…', '运行中…'));
          try {
            if (!await this.plugin.requireUnlock()) return;
            let wrapped = 0;
            for (const ep of this.plugin.settings.endpoints) {
              if (ep.apiKey && !ep.apiKey.startsWith('NCENC1:')) {
                const ok = await this.plugin.storeApiKey(ep, ep.apiKey);
                if (ok) wrapped++;
              }
            }
            await this.plugin.saveSettings();
            new Notice(bi(`Encrypted ${wrapped} key(s).`, `已加密 ${wrapped} 个密钥。`));
            this.display();
          } finally {
            b.setDisabled(false).setButtonText(bi('Run', '运行'));
          }
        }));
    }
    const maintenance = this.createSettingsGroup(
      containerEl,
      bi('Maintenance', '维护'),
      bi('Dangerous cleanup actions. Usually unnecessary.', '危险清理操作。通常不需要。'),
      false,
      'advanced',
    );
    new Setting(maintenance).setName(bi('Purge checkpoints', '清空检查点'))
      .setDesc(bi('Delete every saved pre-edit snapshot. Existing notes are not changed.', '删除全部编辑前快照，不会修改现有笔记。'))
      .addButton(b => b.setButtonText(bi('Purge', '清空')).setWarning().onClick(async () => {
        b.setDisabled(true);
        const { confirmModal } = await import('./ui/confirm_modal');
        const ok = await confirmModal(this.app, {
          title: bi('Purge checkpoints', '清空检查点'),
          body: bi('Delete all checkpoint snapshots?', '删除所有检查点快照？'),
          confirmText: bi('Delete', '删除'),
          danger: true,
        });
        try {
          if (!ok) return;
          await this.plugin.checkpoint.purgeAll();
          new Notice(bi('Checkpoints purged.', '已清空检查点。'));
        } finally {
          b.setDisabled(false);
        }
      }));
    new Setting(maintenance).setName(bi('Purge embedding index', '清空嵌入索引'))
      .setDesc(bi('Delete the local semantic-search index. Source notes remain untouched.', '删除本地语义搜索索引，不影响源笔记。'))
      .addButton(b => b.setButtonText(bi('Purge', '清空')).setWarning().onClick(async () => {
        b.setDisabled(true);
        const { confirmModal } = await import('./ui/confirm_modal');
        const ok = await confirmModal(this.app, {
          title: bi('Purge embedding index', '清空嵌入索引'),
          body: bi('Delete the embedding index?', '删除嵌入索引？'),
          confirmText: bi('Delete', '删除'),
          danger: true,
        });
        try {
          if (!ok) return;
          try { await this.plugin.app.vault.adapter.remove(`${this.plugin.manifest.dir}/embeddings.json`); } catch { /* ignore */ }
          new Notice(bi('Embedding index removed.', '已删除嵌入索引。'));
        } finally {
          b.setDisabled(false);
        }
      }));
    new Setting(maintenance).setName(bi('Purge legacy chat content', '清理旧对话内容'))
      .setDesc(bi('Remove obsolete context fields from older saved chats.', '从旧版已保存对话中移除废弃的上下文字段。'))
      .addButton(b => b.setButtonText(bi('Run', '运行')).onClick(async () => {
        b.setDisabled(true).setButtonText(bi('Running…', '运行中…'));
        try {
          const n = await this.plugin.store.purgeLegacyContext();
          new Notice(bi(`Stripped ${n} legacy fields.`, `已清理 ${n} 个旧字段。`));
        } finally {
          b.setDisabled(false).setButtonText(bi('Run', '运行'));
        }
      }));

    /* ----- Embedding RAG ----- */
    this.renderHeading(containerEl, bi('Semantic search', '语义搜索'), 'advanced');
    const embeddingEndpointSetting = new Setting(containerEl)
      .setName(bi('Embedding endpoint', '嵌入端点'))
      .setDesc(bi('An OpenAI-compatible endpoint that implements /embeddings. Note content is sent to this service while indexing.', '需要实现 /embeddings 的 OpenAI 兼容端点。构建索引时，笔记内容会发送到该服务。'));
    const embeddingEndpointOptions: AlignedSelectOption<string>[] = [
      { value: '', label: bi('None', '无') },
      ...this.plugin.settings.endpoints
        .filter(ep => ep.kind === 'custom-api' && (ep.apiStyle ?? 'openai') === 'openai')
        .map(ep => ({ value: ep.id, label: ep.label })),
    ];
    createAlignedSelect(
      embeddingEndpointSetting.controlEl,
      this.selectPopup,
      embeddingEndpointOptions,
      this.plugin.settings.embeddingEndpointId ?? '',
      async value => {
        this.plugin.settings.embeddingEndpointId = value || null;
        await this.plugin.saveSettings();
      },
      bi('Embedding endpoint', '嵌入端点'),
    );
    new Setting(containerEl).setName(bi('Model', '模型'))
      .setDesc(bi('e.g. text-embedding-3-small', '例：text-embedding-3-small'))
      .addText(t => t.setValue(this.plugin.settings.embeddingModel).onChange(async v => { this.plugin.settings.embeddingModel = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName(bi('Chunk size / overlap', '分块大小 / 重叠'))
      .setDesc(bi('Characters per indexed chunk, followed by repeated characters shared with the next chunk.', '第一个值是每个索引分块的字符数，第二个值是与下一分块重复的字符数。'))
      .addText(t => t.setValue(String(this.plugin.settings.embeddingChunkSize)).onChange(async v => {
        const size = parseClampedInt(v, 1500, 300, 12_000);
        this.plugin.settings.embeddingChunkSize = size;
        this.plugin.settings.embeddingChunkOverlap = Math.min(this.plugin.settings.embeddingChunkOverlap, Math.max(0, size - 1));
        await this.plugin.saveSettings();
      }))
      .addText(t => t.setValue(String(this.plugin.settings.embeddingChunkOverlap)).onChange(async v => {
        const maxOverlap = Math.max(0, this.plugin.settings.embeddingChunkSize - 1);
        this.plugin.settings.embeddingChunkOverlap = parseClampedInt(v, 200, 0, maxOverlap);
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl).setName(bi('Rebuild index', '重建索引'))
      .setDesc(bi(
        `${this.plugin.embeddingIndex.size()} chunks · ${this.plugin.embeddingIndex.modelInfo().model || '(none)'}`,
        `${this.plugin.embeddingIndex.size()} 个分块 · ${this.plugin.embeddingIndex.modelInfo().model || '无模型'}`,
      ))
      .addButton(b => b.setButtonText(bi('Build', '构建')).setCta().onClick(async () => {
        b.setDisabled(true).setButtonText(bi('Building…', '构建中…'));
        try {
          await this.plugin.rebuildEmbeddings();
          this.display();
        } finally {
          b.setDisabled(false).setButtonText(bi('Build', '构建'));
        }
      }));

    /* ----- Checkpoint ----- */
    this.renderHeading(containerEl, bi('Checkpoints', '检查点'), 'advanced');
    new Setting(containerEl).setName(bi('Snapshot before edits', '编辑前快照'))
      .setDesc(bi('Save the affected note state before an Agent edit so the turn can be rolled back.', 'Agent 编辑前保存受影响笔记的状态，以便按轮次回滚。'))
      .addToggle(t => t.setValue(this.plugin.settings.checkpointEnabled).onChange(async v => { this.plugin.settings.checkpointEnabled = v; await this.plugin.saveSettings(); }));

    /* ----- Auto-compaction ----- */
    this.renderHeading(containerEl, bi('Auto-compact', '自动压缩'), 'agent');
    new Setting(containerEl).setName(bi('Enable', '开启'))
      .setDesc(bi('Summarise older turns when context fills up.', '上下文将满时压缩历史轮次。'))
      .addToggle(t => t.setValue(this.plugin.settings.autoCompactEnabled).onChange(async v => { this.plugin.settings.autoCompactEnabled = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName(bi('Threshold (%)', '阈值 (%)'))
      .setDesc(bi('Compact older turns after estimated context usage reaches this percentage.', '估算上下文使用率达到该比例后，压缩较早轮次。'))
      .addSlider(s => s.setLimits(40, 95, 5).setValue(this.plugin.settings.autoCompactThresholdPct).setDynamicTooltip()
        .onChange(async v => { this.plugin.settings.autoCompactThresholdPct = v; await this.plugin.saveSettings(); }));

    /* ----- Endpoints ----- */
    this.renderHeading(containerEl, bi('Model endpoints', '模型端点'), 'providers');
    const addBtn = containerEl.createEl('button', { text: bi('+ Add endpoint', '+ 添加端点'), cls: 'nc-add-endpoint-btn mod-cta' });
    addBtn.onclick = () => this.openAddEndpointModal();

    for (const ep of this.plugin.settings.endpoints) this.renderEndpointCard(containerEl, ep);

    /* ----- Chats folder ----- */
    this.renderHeading(containerEl, bi('Persistence', '持久化'), 'general');
    new Setting(containerEl).setName(bi('Chats folder', '对话文件夹'))
      .setDesc(bi('Vault-relative folder used by the header export button.', '主页顶部“导出对话”按钮使用的 vault 相对目录。'))
      .addText(t => t.setValue(this.plugin.settings.chatsFolder).onChange(async v => {
        this.plugin.settings.chatsFolder = v || 'Chats'; await this.plugin.saveSettings();
      }));

    /* ----- Custom slash ----- */
    this.renderHeading(containerEl, bi('Custom slash commands', '自定义斜杠命令'), 'capabilities');
    containerEl.createEl('p', {
      text: '${selection} ${file} ${filename} ${selection-or-file} ${vault} ${args}',
      cls: 'setting-item-description',
    });
    new Setting(containerEl).addButton(b => b.setButtonText(bi('+ Add command', '+ 添加命令')).onClick(async () => {
      this.plugin.settings.customSlashCommands.push({
        id: uid(), trigger: '/my-cmd', title: 'My command',
        template: 'Do something with ${selection}', custom: true,
      });
      await this.plugin.saveSettings(); this.display();
    }));
    for (const c of this.plugin.settings.customSlashCommands) this.renderSlashCmd(containerEl, c);

    /* ----- Workflows ----- */
    this.renderHeading(containerEl, bi('Reusable prompts', '可复用 Prompt'), 'capabilities');
    new Setting(containerEl).addButton(b => b.setButtonText(bi('+ Add', '+ 新增')).onClick(async () => {
      this.plugin.settings.workflows.unshift({ id: uid(), title: bi('Untitled', '未命名'), prompt: '', createdAt: Date.now() });
      await this.plugin.saveSettings(); this.display();
    }));
    for (const w of this.plugin.settings.workflows) {
      const card = containerEl.createDiv({ cls: 'nc-endpoint-card' });
      const hdr = card.createDiv({ cls: 'nc-endpoint-card-header' });
      hdr.createSpan({ text: new Date(w.createdAt).toLocaleDateString() });
      const del = hdr.createEl('button', { text: bi('Delete', '删除'), cls: 'mod-warning' });
      del.onclick = async () => {
        this.plugin.settings.workflows = this.plugin.settings.workflows.filter(x => x.id !== w.id);
        await this.plugin.saveSettings(); this.display();
      };
      new Setting(card).setName(bi('Title', '标题')).addText(t => t.setValue(w.title).onChange(async v => { w.title = v; await this.plugin.saveSettings(); }));
      new Setting(card).setName(bi('Prompt', 'Prompt')).addTextArea(t => { t.inputEl.rows = 5; t.setValue(w.prompt).onChange(async v => { w.prompt = v; await this.plugin.saveSettings(); }); });
    }

    /* ----- Per-folder prompts ----- */
    this.renderHeading(containerEl, bi('Per-folder prompts', '文件夹 prompt'), 'advanced');
    new Setting(containerEl).addButton(b => b.setButtonText(bi('+ Add', '+ 新增')).onClick(async () => {
      this.plugin.settings.customPrompts.push({ id: uid(), name: bi('Untitled', '未命名'), systemPrompt: '', folderScope: '' });
      await this.plugin.saveSettings(); this.display();
    }));
    for (const p of this.plugin.settings.customPrompts) this.renderCustomPrompt(containerEl, p);
  }

  /* ============================================================
     Endpoint card (existing endpoints)
     ============================================================ */
  private async buildProviderFor(ep: Endpoint): Promise<AnyValue> {
    const vaultRoot = (this.app.vault.adapter as AnyValue).basePath as string | undefined;
    return buildProvider(ep, this.plugin.settings.globalProxy, vaultRoot);
  }

  private renderEndpointCard(parent: HTMLElement, ep: Endpoint) {
    const card = parent.createDiv({ cls: 'nc-endpoint-card' });
    const hdr = card.createDiv({ cls: 'nc-endpoint-card-header' });
    const left = hdr.createDiv();
    left.createSpan({ text: ep.label });
    left.createSpan({ text: ep.kind, cls: 'nc-endpoint-kind-badge' });
    // Right side of header: Test connectivity + Delete
    const testBtn = hdr.createEl('button', { text: bi('Test', '测试'), cls: 'nc-endpoint-test-btn' });
    testBtn.setAttribute('aria-label', bi(`Test ${ep.label}`, `测试 ${ep.label}`));
    const testStatus = hdr.createSpan({ cls: 'nc-endpoint-test-status' });
    testBtn.onclick = async () => {
      testBtn.setAttribute('disabled', 'true');
      testStatus.removeClass('ok'); testStatus.removeClass('fail');
      testStatus.setText('…');
      const epDec = await this.plugin.getDecryptedEndpoint(ep);
      if (!epDec) {
        testStatus.setText(bi('Locked', '已锁定'));
        testStatus.addClass('fail');
        testBtn.removeAttribute('disabled');
        return;
      }
      try {
        const provider: AnyValue = await this.buildProviderFor(epDec);
        if (!provider?.testConnect) { testStatus.setText(bi('Unsupported', '不支持测试')); return; }
        const r = await provider.testConnect();
        testStatus.setText(r.message);
        testStatus.addClass(r.ok ? 'ok' : 'fail');
        if (r.ok) new Notice(`${ep.label}: ${r.message}`);
        else new Notice(bi(`${ep.label} failed: ${r.message}`, `${ep.label} 测试失败：${r.message}`), 8000);
      } catch (e) {
        testStatus.setText(e.message ?? String(e));
        testStatus.addClass('fail');
      } finally {
        testBtn.removeAttribute('disabled');
      }
    };
    const delBtn = hdr.createEl('button', { text: bi('Delete', '删除'), cls: 'mod-warning' });
    delBtn.setAttribute('aria-label', bi(`Delete ${ep.label}`, `删除 ${ep.label}`));
    delBtn.onclick = async () => {
      // Find every place this endpoint id is referenced so the deletion
      // doesn't leave dangling pointers (which caused 404s on embedding
      // rebuild and "no endpoint" ghost state on session restore).
      const refs: string[] = [];
      const isEmbedRef = this.plugin.settings.embeddingEndpointId === ep.id;
      if (isEmbedRef) refs.push(bi('semantic-search endpoint', '语义搜索端点'));
      const sessionRefs: string[] = [];
      try {
        for (const s of (this.plugin.store?.all() ?? [])) {
          if (s.endpointId === ep.id) sessionRefs.push(s.title || s.id);
        }
      } catch { /* store might not be ready */ }
      if (sessionRefs.length > 0) {
        refs.push(bi(
          `${sessionRefs.length} chat session${sessionRefs.length === 1 ? '' : 's'}`,
          `${sessionRefs.length} 个对话`,
        ));
      }

      // If something refers to this endpoint, confirm before nulling out.
      if (refs.length > 0) {
        const { confirmModal } = await import('./ui/confirm_modal');
        const ok = await confirmModal(this.plugin.app, {
          title: bi(`Delete endpoint “${ep.label}”?`, `删除端点“${ep.label}”？`),
          body: bi(
            `This endpoint is used by:\n\n  • ${refs.join('\n  • ')}\n\nDeleting it will detach those references until another endpoint is selected.`,
            `以下内容正在使用此端点：\n\n  • ${refs.join('\n  • ')}\n\n删除后，这些引用会解除，直到重新选择端点。`,
          ),
          confirmText: bi('Delete and detach', '删除并解除引用'),
          danger: true,
        });
        if (!ok) return;
      }

      // 1. Drop the endpoint itself.
      this.plugin.settings.endpoints = this.plugin.settings.endpoints.filter(e => e.id !== ep.id);
      // 2. Reset active selection.
      if (this.plugin.settings.activeEndpointId === ep.id)
        this.plugin.settings.activeEndpointId = this.plugin.settings.endpoints[0]?.id ?? null;
      // 3. Detach embedding endpoint ref.
      if (isEmbedRef) {
        this.plugin.settings.embeddingEndpointId = null;
      }
      // 4. Detach session refs so loadSession sees null instead of a ghost id.
      try {
        for (const s of (this.plugin.store?.all() ?? [])) {
          if (s.endpointId === ep.id) s.endpointId = null;
        }
        // Persist sessions so detachment survives reload.
        await this.plugin.store?.persist?.();
      } catch (e) { console.warn('[Glossa] endpoint deletion: session ref cleanup failed', e); }

      await this.plugin.saveSettings();
      this.display();
    };

    const cliWarn = localCliWarning(ep.kind);
    if (cliWarn) renderWarningHint(card, cliWarn);
    const codexWarn = codexSafetyWarning(ep);
    if (codexWarn) renderWarningHint(card, codexWarn);

    const basic = card.createDiv({ cls: 'nc-endpoint-basic' });
    const advanced = this.createSettingsGroup(
      card,
      bi('Advanced', '高级'),
      bi('Headers, proxy, diagnostics, sandbox, and compatibility options.', '请求头、代理、诊断、沙盒与兼容选项。'),
    );

    new Setting(basic)
      .setName(bi('Display name', '显示名称'))
      .setDesc(bi('The name shown in the model picker.', '显示在模型选择器中的名称。'))
      .addText(t => t.setValue(ep.label).onChange(async v => { ep.label = v; await this.plugin.saveSettings(); }));

    if (ep.kind !== 'custom-api') {
      new Setting(basic)
        .setName(bi('Unavailable in community build', '社区审核版不可用'))
        .setDesc(bi('Local CLI providers are disabled in this release package. Create a Custom API endpoint instead.', '此发布包已禁用本地 CLI provider。请改用 Custom API endpoint。'));
    }

    if (ep.kind === 'custom-api') {
      const apiFormatSetting = new Setting(basic)
        .setName(bi('API format', 'API 格式'))
        .setDesc(bi('Choose the request and response format implemented by this endpoint.', '选择该端点实现的请求与响应格式。'));
      createAlignedSelect(
        apiFormatSetting.controlEl,
        this.selectPopup,
        [
          { value: 'openai', label: 'OpenAI-compatible' },
          { value: 'anthropic', label: 'Anthropic-style' },
        ] as const,
        ep.apiStyle ?? 'openai',
        async value => {
          ep.apiStyle = value;
          await this.plugin.saveSettings();
        },
        bi('API format', 'API 格式'),
      );
      new Setting(basic).setName('Base URL')
        .setDesc(bi('API root ending at the provider version path, for example /v1.', 'API 根地址，通常以 provider 的版本路径结尾，例如 /v1。'))
        .addText(t => t.setValue(ep.baseUrl ?? '').onChange(async v => {
        const trimmed = v.trim();
        if (trimmed) {
          // Reject anything that isn't http(s) — Electron's renderer fetch will
          // happily open file:// (local file disclosure) or data:// otherwise.
          try {
            const u = new URL(trimmed);
            if (!/^https?:$/.test(u.protocol)) {
              new Notice(bi(
                `Base URL refused: only HTTP(S) is allowed (got ${u.protocol}).`,
                `Base URL 无效：只允许 HTTP(S)，当前为 ${u.protocol}。`,
              ), 6000);
              return;
            }
          } catch {
            // Invalid URL → keep value as draft but don't save; user is mid-typing.
          }
        }
        ep.baseUrl = trimmed;
        await this.plugin.saveSettings();
      }));
      const apiKeySetting = new Setting(basic).setName('API key')
        .setDesc(ep.apiKey?.startsWith('NCENC1:') ? bi('✓ encrypted', '✓ 已加密') : (this.plugin.settings.encryptionEnabled ? bi('will encrypt on save', '保存时加密') : bi('plaintext', '明文')))
        .addText(t => {
          t.inputEl.type = 'password';
          const enc = ep.apiKey?.startsWith('NCENC1:');
          t.setPlaceholder(enc ? bi('(encrypted)', '（已加密）') : 'sk-…')
           .setValue(enc ? '' : (ep.apiKey ?? ''))
           .onChange(async v => {
             if (v) {
               await this.plugin.storeApiKey(ep, v);
             } else if (!enc) {
               ep.apiKey = '';
             }
             await this.plugin.saveSettings();
           });
        });
      apiKeySetting.addButton(b => b
        .setButtonText(bi('Clear', '清除'))
        .setWarning()
        .setDisabled(!ep.apiKey)
        .onClick(async () => {
          const { confirmModal } = await import('./ui/confirm_modal');
          const ok = await confirmModal(this.app, {
            title: bi('Clear API key?', '清除 API key？'),
            body: bi(`Remove the stored API key for ${ep.label}?`, `移除 ${ep.label} 保存的 API key？`),
            confirmText: bi('Clear', '清除'),
            danger: true,
          });
          if (!ok) return;
          ep.apiKey = '';
          await this.plugin.saveSettings();
          this.display();
        }));

      // Model with detect button + dropdown of detected
      this.renderModelRow(basic, ep);

      new Setting(advanced).setName(bi('Headers', '请求头')).setDesc(bi('Optional JSON. e.g. {"x-org-id":"abc"}', '可选 JSON。例：{"x-org-id":"abc"}'))
        .addTextArea(t => t.setValue(ep.headers ? JSON.stringify(ep.headers, null, 2) : '')
          .onChange(async v => {
            try { ep.headers = v.trim() ? JSON.parse(v) : undefined; await this.plugin.saveSettings(); } catch { /* ignore */ }
          }));
    }

    if (ep.kind === 'codex-cli' || ep.kind === 'claude-code-cli') {
      new Setting(basic).setName(t('cli_binary_path')).setDesc(t('cli_binary_path_desc'))
        .addText(tx => tx.setValue(ep.binaryPath ?? '').onChange(async v => { ep.binaryPath = v; await this.plugin.saveSettings(); }))
        .addButton(b => b.setButtonText('Auto').onClick(async () => {
          new Notice(bi('Local CLI providers are disabled in the community review build.', '社区审核版已禁用本地 CLI provider。'));
        }));
      new Setting(basic).setName(t('cli_default_model'))
        .setDesc(t('cli_default_model_desc'))
        .addText(tx => tx.setValue(ep.model ?? '').onChange(async v => { ep.model = v; await this.plugin.saveSettings(); }));
      const cliReasoningSetting = new Setting(basic)
        .setName(t('reasoning_effort'))
        .setDesc(t('reasoning_effort_desc_cli'));
      const cliReasoningOptions = reasoningOptionsForEndpoint(ep);
      createAlignedSelect(
        cliReasoningSetting.controlEl,
        this.selectPopup,
        cliReasoningOptions.map(value => ({ value, label: t(`effort_${value}`) })),
        cliReasoningOptions.includes(ep.reasoningEffort ?? 'off') ? (ep.reasoningEffort ?? 'off') : 'off',
        async value => {
          ep.reasoningEffort = value;
          await this.plugin.saveSettings();
        },
        t('reasoning_effort'),
      );
      new Setting(basic).setName(t('cli_working_dir')).setDesc(t('cli_working_dir_desc'))
        .addText(t => t.setValue(ep.cwd ?? '').onChange(async v => { ep.cwd = v; await this.plugin.saveSettings(); }))
        .addButton(b => b.setButtonText('Use vault').onClick(async () => {
          const vaultPath = (this.app.vault.adapter as AnyValue).basePath;
          if (vaultPath) { ep.cwd = vaultPath; await this.plugin.saveSettings(); this.display(); new Notice('Set to vault root.'); }
        }));

      new Setting(basic).setName(t('cli_full_agent'))
        .setDesc(t('cli_full_agent_desc'))
        .addToggle(tg => tg.setValue(!!ep.cliFullAgent).onChange(async v => { ep.cliFullAgent = v; await this.plugin.saveSettings(); this.display(); }));

      if (ep.kind === 'codex-cli') {
        const appServerActive = ep.codexUseAppServer !== false;
        // Banner reflecting the active mode. With app-server (default), tokens
        // truly stream — same protocol codex's native TUI uses. Legacy `codex exec`
        // mode arrives in chunks at completion.
        const hint = advanced.createDiv({ cls: 'nc-info-hint' });
        hint.createEl('strong', { text: appServerActive ? bi('app-server ✓', 'app-server ✓') : bi('legacy exec', 'legacy exec') });
        hint.appendText(appServerActive
          ? bi(' — token-level streaming.', ' — token 级流式。')
          : bi(' — completion only, no token stream.', ' — 整段返回，无 token 流。'));

        new Setting(advanced)
          .setName(bi('app-server protocol', 'app-server 协议'))
          .setDesc(bi('Off = fall back to legacy exec.', '关闭则用 legacy exec。'))
          .addToggle(tg => tg.setValue(ep.codexUseAppServer !== false).onChange(async v => {
            ep.codexUseAppServer = v;
            await this.plugin.saveSettings();
            this.display();
          }));

        const sandboxSetting = new Setting(advanced)
          .setName(t('codex_sandbox'))
          .setDesc(t('codex_sandbox_desc'));
        createAlignedSelect(
          sandboxSetting.controlEl,
          this.selectPopup,
          [
            { value: '', label: bi('Default', '默认') },
            { value: 'read-only', label: bi('Read only', '只读') },
            { value: 'workspace-write', label: bi('Workspace write', '工作区可写') },
            { value: 'danger-full-access', label: bi('Danger full access', '完全访问'), hint: bi('High risk', '高风险') },
          ] as const,
          ep.codexSandboxMode ?? '',
          async value => {
            ep.codexSandboxMode = value || undefined;
            await this.plugin.saveSettings();
            const warn = codexSafetyWarning(ep);
            if (warn) new Notice(`Warning: ${warn}`, 10000);
            this.display();
          },
          t('codex_sandbox'),
        );
        const approvalSetting = new Setting(advanced)
          .setName(t('codex_approval'))
          .setDesc(t('codex_approval_desc'));
        createAlignedSelect(
          approvalSetting.controlEl,
          this.selectPopup,
          [
            { value: '', label: bi('Default', '默认') },
            { value: 'untrusted', label: 'Untrusted' },
            { value: 'on-failure', label: 'On failure' },
            { value: 'on-request', label: 'On request' },
            { value: 'never', label: 'Never', hint: bi('High risk', '高风险') },
          ] as const,
          ep.codexApprovalPolicy ?? '',
          async value => {
            ep.codexApprovalPolicy = value || undefined;
            await this.plugin.saveSettings();
            const warn = codexSafetyWarning(ep);
            if (warn) new Notice(`Warning: ${warn}`, 10000);
            this.display();
          },
          t('codex_approval'),
        );
        new Setting(advanced).setName(t('codex_use_oss'))
          .addToggle(tg => tg.setValue(!!ep.codexUseOss).onChange(async v => { ep.codexUseOss = v; await this.plugin.saveSettings(); }));
        new Setting(advanced).setName(t('codex_config_overrides'))
          .setDesc(t('codex_config_overrides_desc'))
          .addTextArea(tx => { tx.inputEl.rows = 4; tx.setValue(ep.codexConfigOverrides ?? '').onChange(async v => { ep.codexConfigOverrides = v; await this.plugin.saveSettings(); }); });
        new Setting(advanced).setName(bi('Diagnose', '诊断'))
          .setDesc(bi('"say pong" probe + event log.', '"say pong" 探测 + 事件日志。'))
          .addButton(b => b.setButtonText(bi('🔬 Run', '🔬 运行')).onClick(async () => {
            b.setButtonText('Running…').setDisabled(true);
            try {
              const epDec = await this.plugin.getDecryptedEndpoint(ep);
              if (!epDec) { new Notice('Endpoint locked.'); return; }
              const provider: AnyValue = await this.buildProviderFor(epDec);
              if (!provider?.runDiagnostic) { new Notice('Diagnostic not supported for this provider.'); return; }
              // Track progress for the user — update button text as events arrive
              let lastEvent = '';
              const result = await provider.runDiagnostic({
                timeoutMs: 60_000,
                onEvent: (line: string) => {
                  try {
                    const ev = JSON.parse(line);
                    const t = ev?.item?.type ? `${ev.type}·${ev.item.type}` : (ev.type ?? 'event');
                    if (t !== lastEvent) { lastEvent = t; b.setButtonText(`… ${t}`); }
                  } catch { /* ignore */ }
                },
              });
              new CodexDiagnosticModal(this.plugin.app, result).open();
            } catch (e) {
              new Notice(bi(`Diagnostic failed: ${e.message}`, `诊断失败：${e.message}`), 8000);
            } finally {
              b.setButtonText(bi('🔬 Run', '🔬 运行')).setDisabled(false);
            }
          }));
      }

      if (ep.kind === 'claude-code-cli') {
        new Setting(advanced).setName(t('claude_bare'))
          .setDesc(t('claude_bare_desc'))
          .addToggle(tg => tg.setValue(ep.bareMode ?? !ep.cliFullAgent).onChange(async v => { ep.bareMode = v; await this.plugin.saveSettings(); }));
        new Setting(advanced).setName(t('claude_max_turns'))
          .setDesc(t('claude_max_turns_desc'))
          .addText(tx => tx.setValue(String(ep.maxTurns ?? 1)).onChange(async v => {
            ep.maxTurns = parseClampedInt(v, 1, 1, 25);
            await this.plugin.saveSettings();
          }));
        new Setting(advanced).setName(bi('Allowed tools', '允许工具'))
          .setDesc(bi('--allowedTools, space-separated.', '--allowedTools，空格分隔。'))
          .addText(t => t.setValue(ep.claudeAllowedTools ?? '').onChange(async v => { ep.claudeAllowedTools = v; await this.plugin.saveSettings(); }));
        new Setting(advanced).setName(bi('Disallowed tools', '禁用工具'))
          .setDesc('CLI flag for disallowed tools.')
          .addText(t => t.setValue(ep.claudeDisallowedTools ?? '').onChange(async v => { ep.claudeDisallowedTools = v; await this.plugin.saveSettings(); }));
        new Setting(advanced).setName(bi('Extra dirs', '额外目录'))
          .setDesc(bi('--add-dir, one per line.', '--add-dir，一行一个。'))
          .addTextArea(t => { t.inputEl.rows = 3; t.setValue(ep.claudeAddDirs ?? '').onChange(async v => { ep.claudeAddDirs = v; await this.plugin.saveSettings(); }); });
        new Setting(advanced).setName(bi('MCP config', 'MCP 配置'))
          .setDesc('--mcp-config')
          .addText(t => t.setValue(ep.claudeMcpConfig ?? '').onChange(async v => { ep.claudeMcpConfig = v; await this.plugin.saveSettings(); }));
        new Setting(advanced).setName(bi('Budget (USD)', '预算 (USD)'))
          .setDesc(bi('--max-budget-usd. 0 = no cap.', '--max-budget-usd。0 = 不限。'))
          .addText(t => t.setValue(String(ep.claudeMaxBudgetUSD ?? '')).onChange(async v => { ep.claudeMaxBudgetUSD = parseNonNegativeFloat(v); await this.plugin.saveSettings(); }));
        new Setting(advanced).setName(bi('Fallback model', '备用模型'))
          .setDesc('--fallback-model')
          .addText(t => t.setValue(ep.claudeFallbackModel ?? '').onChange(async v => { ep.claudeFallbackModel = v; await this.plugin.saveSettings(); }));
      }

      new Setting(advanced).setName(bi('Extra args', '额外参数'))
        .setDesc(bi('One per line.', '一行一个。'))
        .addTextArea(t => t.setValue((ep.cliExtraArgs ?? []).join('\n'))
          .onChange(async v => { ep.cliExtraArgs = v.split('\n').map(s => s.trim()).filter(Boolean); await this.plugin.saveSettings(); }));

      new Setting(advanced).setName(bi('Debug', '调试'))
        .setDesc(bi('Log spawn + events to devtools.', '把 spawn + 事件打到 devtools。'))
        .addToggle(tg => tg.setValue(!!ep.cliDebug).onChange(async v => { ep.cliDebug = v; await this.plugin.saveSettings(); }));
    }

    // Custom API: offer requestUrl fallback for proxy support
    if (ep.kind === 'custom-api') {
      new Setting(advanced).setName(bi('Obsidian requestUrl', 'Obsidian requestUrl'))
        .setDesc(bi('Proxy-aware. No streaming.', '支持代理。不流式。'))
        .addToggle(tg => tg.setValue(!!ep.useObsidianFetch).onChange(async v => { ep.useObsidianFetch = v; await this.plugin.saveSettings(); this.display(); }));
    }

    // Proxy override — only meaningful for CLI providers (HTTPS_PROXY env var) OR
    // custom-api when requestUrl is used (system proxy follows). Hide otherwise.
    const proxyApplies = ep.kind === 'codex-cli' || ep.kind === 'claude-code-cli' || ep.useObsidianFetch;
    if (proxyApplies) {
      const proxyModeSetting = new Setting(advanced).setName(bi('Proxy mode', '代理模式'))
        .setDesc(ep.kind === 'custom-api'
          ? bi('Follows system proxy.', '跟随系统代理。')
          : bi(`global = ${this.plugin.settings.globalProxy || 'unset'} · none · override`,
               `global = ${this.plugin.settings.globalProxy || '未设'} · none · override`));
      createAlignedSelect(
        proxyModeSetting.controlEl,
        this.selectPopup,
        [
          { value: 'global', label: bi('Global', '全局') },
          { value: 'none', label: bi('None', '无') },
          { value: 'override', label: bi('Override', '单独设置') },
        ] as const,
        ep.proxyMode ?? 'global',
        async value => {
          ep.proxyMode = value;
          await this.plugin.saveSettings();
          this.display();
        },
        bi('Proxy mode', '代理模式'),
      );
      if (ep.proxyMode === 'override') {
        new Setting(advanced).setName(bi('Proxy URL', '代理 URL')).addText(t => t.setPlaceholder(HTTP_PROXY_PLACEHOLDER).setValue(ep.proxy ?? '').onChange(async v => { ep.proxy = v.trim(); await this.plugin.saveSettings(); }));
      }
    }
  }

  private renderModelRow(card: HTMLElement, ep: Endpoint) {
    let inputComp: AnyValue;

    const setting = new Setting(card).setName(bi('Model', '模型')).setDesc(bi('Enter a model ID, or detect the list exposed by the endpoint.', '输入模型 ID，或探测该端点公开的模型列表。'));
    setting.addText(t => { inputComp = t; t.setValue(ep.model ?? '').onChange(async v => { ep.model = v; await this.plugin.saveSettings(); }); });
    setting.addButton(b => b.setButtonText(bi('↻ Detect', '↻ 探测')).onClick(async () => {
      if (!ep.baseUrl || !ep.apiKey) { new Notice(bi('Fill Base URL + API Key first.', '请先填写 Base URL + API Key。')); return; }
      b.setButtonText(bi('detecting…', '探测中…')).setDisabled(true);
      try {
        const epDec = await this.plugin.getDecryptedEndpoint(ep);
        if (!epDec) return;
        const list = normalizeModelList(await new CustomApiProvider(epDec).listModels());
        if (list.length === 0) { new Notice(bi('No models returned.', '未返回模型列表。')); }
        else { ep.availableModels = list; await this.plugin.saveSettings(); new Notice(bi(`Found ${list.length} models.`, `找到 ${list.length} 个模型。`)); this.display(); }
      } catch (e) { new Notice(bi(`Failed: ${e.message}`, `失败：${e.message}`)); }
      finally { b.setButtonText(bi('↻ Detect', '↻ 探测')).setDisabled(false); }
    }));

    if (ep.availableModels && ep.availableModels.length > 0) {
      const modelPickerSetting = new Setting(card)
        .setName(bi('Detected models', '已探测模型'))
        .setDesc(bi(`${ep.availableModels.length} models returned by the endpoint.`, `端点返回了 ${ep.availableModels.length} 个模型。`));
      createAlignedSelect(
        modelPickerSetting.controlEl,
        this.selectPopup,
        [
          { value: '', label: bi('Select a detected model', '选择已探测模型'), hint: String(ep.availableModels.length) },
          ...ep.availableModels.map(model => ({ value: model, label: model })),
        ],
        ep.model && ep.availableModels.includes(ep.model) ? ep.model : '',
        async value => {
          if (!value) return;
          ep.model = value;
          await this.plugin.saveSettings();
          inputComp.setValue(value);
        },
        bi('Detected model', '已探测模型'),
      );
    }

    // Reasoning effort — unified across all three endpoint kinds
    const reasoningSetting = new Setting(card)
      .setName(t('reasoning_effort'))
      .setDesc(t('reasoning_effort_desc'));
    const reasoningOptions = reasoningOptionsForEndpoint(ep);
    createAlignedSelect(
      reasoningSetting.controlEl,
      this.selectPopup,
      reasoningOptions.map(value => ({ value, label: t(`effort_${value}`) })),
      reasoningOptions.includes(ep.reasoningEffort ?? 'off') ? (ep.reasoningEffort ?? 'off') : 'off',
      async value => {
        ep.reasoningEffort = value;
        await this.plugin.saveSettings();
      },
      t('reasoning_effort'),
    );
  }

  private renderSlashCmd(parent: HTMLElement, c: SlashCommand) {
    const card = parent.createDiv({ cls: 'nc-endpoint-card' });
    const hdr = card.createDiv({ cls: 'nc-endpoint-card-header' });
    hdr.createSpan({ text: c.trigger });
    const del = hdr.createEl('button', { text: bi('Delete', '删除'), cls: 'mod-warning' });
    del.onclick = async () => {
      this.plugin.settings.customSlashCommands = this.plugin.settings.customSlashCommands.filter(x => x.id !== c.id);
      await this.plugin.saveSettings(); this.display();
    };
    new Setting(card).setName(bi('Trigger', '触发符')).addText(t => t.setValue(c.trigger).onChange(async v => { c.trigger = v.startsWith('/') ? v : '/' + v; await this.plugin.saveSettings(); }));
    new Setting(card).setName(bi('Title', '标题')).addText(t => t.setValue(c.title).onChange(async v => { c.title = v; await this.plugin.saveSettings(); }));
    new Setting(card).setName(bi('Template', '模板')).addTextArea(t => { t.inputEl.rows = 4; t.setValue(c.template).onChange(async v => { c.template = v; await this.plugin.saveSettings(); }); });
  }

  private renderCustomPrompt(parent: HTMLElement, p: CustomPrompt) {
    const card = parent.createDiv({ cls: 'nc-endpoint-card' });
    const hdr = card.createDiv({ cls: 'nc-endpoint-card-header' });
    hdr.createSpan({ text: p.name || bi('Untitled', '未命名') });
    const del = hdr.createEl('button', { text: bi('Delete', '删除'), cls: 'mod-warning' });
    del.onclick = async () => {
      this.plugin.settings.customPrompts = this.plugin.settings.customPrompts.filter(x => x.id !== p.id);
      await this.plugin.saveSettings(); this.display();
    };
    new Setting(card).setName(bi('Name', '名称')).addText(t => t.setValue(p.name).onChange(async v => { p.name = v; await this.plugin.saveSettings(); }));
    new Setting(card).setName(bi('Folder', '文件夹')).setDesc(bi('Path prefix.', '路径前缀。'))
      .addText(t => t.setValue(p.folderScope ?? '').onChange(async v => { p.folderScope = v; await this.plugin.saveSettings(); }));
    new Setting(card).setName(bi('System prompt', 'System prompt')).addTextArea(t => { t.inputEl.rows = 6; t.setValue(p.systemPrompt).onChange(async v => { p.systemPrompt = v; await this.plugin.saveSettings(); }); });
  }

  private openAddEndpointModal() {
    const m = new AddEndpointModal(this.app, this.plugin, async (ep, plainKey) => {
      // Encrypt the key BEFORE pushing to the settings array so it never lands in
      // memory as plaintext + then gets persisted.
      if (plainKey && ep.kind === 'custom-api') {
        const ok = await this.plugin.storeApiKey(ep, plainKey);
        if (!ok) return;          // refuse to save if encryption locked
      }
      this.plugin.settings.endpoints.push(ep);
      if (!this.plugin.settings.activeEndpointId) this.plugin.settings.activeEndpointId = ep.id;
      await this.plugin.saveSettings();
      this.display();
    });
    m.open();
  }
}

/* ============================================================
   Add Endpoint Modal — new beautiful design
   ============================================================ */
class AddEndpointModal extends Modal {
  private selectedKind: Endpoint['kind'] = 'custom-api';
  private readonly selectPopup = new Popup();
  private draft: Partial<Endpoint> = {
    apiStyle: 'openai',
    baseUrl: '',
    model: '',
    label: bi('New endpoint', '新端点'),
  };
  private plainKey = '';     // never stored on draft.apiKey — encrypted at save time
  private formEl: HTMLElement;
  private detectStatusEl: HTMLElement;
  private modelInput: HTMLInputElement;

  constructor(app: App, _plugin: GlossaPlugin, private onSave: (ep: Endpoint, plainKey: string) => void | Promise<void>) {
    super(app);
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass('nc-add-modal');
    contentEl.addClass('nc-add-modal-content');
    contentEl.empty();

    const hdr = contentEl.createDiv({ cls: 'nc-add-modal-header' });
    hdr.createEl('h2', { text: bi('Add model endpoint', '添加模型端点') });
    hdr.createEl('p', {
      text: bi(
        'Choose a preset or enter an OpenAI-compatible / Anthropic-compatible API manually. Detect models before saving when the endpoint supports it.',
        '可选择预设，也可手动填写 OpenAI 兼容或 Anthropic 兼容 API。端点支持时，可在保存前探测模型列表。',
      ),
    });

    /* Presets (visible for custom-api) */
    const presetsSec = contentEl.createDiv({ cls: 'nc-presets-section' });
    presetsSec.createEl('h3', { text: bi('Provider presets', '服务商预设') });
    const grid = presetsSec.createDiv({ cls: 'nc-preset-grid' });
    for (const p of PRESETS) {
      const chip = grid.createDiv({ cls: 'nc-preset-chip' });
      const dot = chip.createSpan({ cls: 'nc-preset-dot' });
      setStyle(dot, { background: p.color });
      chip.createSpan({ cls: 'nc-preset-name', text: p.name });
      chip.title = `${p.baseUrl} · ${p.defaultModel}`;
      chip.onclick = () => {
        this.draft.label = p.name;
        this.draft.baseUrl = p.baseUrl;
        this.draft.model = p.defaultModel;
        this.draft.apiStyle = p.apiStyle;
        this.renderForm();
      };
      makeKeyboardClickable(chip, p.name);
    }

    /* Form */
    this.formEl = contentEl.createDiv({ cls: 'nc-add-form' });
    this.renderForm();
  }

  onClose() {
    this.selectPopup.destroy();
  }

  private renderForm() {
    const { formEl } = this;
    formEl.empty();

    const row = (label: string, build: (parent: HTMLElement) => void) => {
      const r = formEl.createDiv({ cls: 'nc-add-form-row' });
      r.createEl('label', { text: label });
      const right = r.createDiv();
      build(right);
      return r;
    };

    row(bi('Display name', '显示名称'), (p) => {
      const inp = p.createEl('input', { type: 'text', value: this.draft.label ?? '' });
      inp.autocomplete = 'off';
      inp.oninput = () => { this.draft.label = inp.value; };
    });

    if (this.selectedKind === 'custom-api') {
      row(bi('API format', 'API 格式'), (p) => {
        createAlignedSelect(
          p,
          this.selectPopup,
          [
            { value: 'openai', label: 'OpenAI-compatible' },
            { value: 'anthropic', label: 'Anthropic-style' },
          ] as const,
          this.draft.apiStyle ?? 'openai',
          value => { this.draft.apiStyle = value; },
          bi('API format', 'API 格式'),
        );
      });
      row('Base URL', (p) => {
        const inp = p.createEl('input', { type: 'text', value: this.draft.baseUrl ?? '' });
        inp.placeholder = HTTPS_API_PLACEHOLDER;
        inp.autocomplete = 'off';
        inp.spellcheck = false;
        inp.oninput = () => { this.draft.baseUrl = inp.value; };
      });
      row('API key', (p) => {
        const inp = p.createEl('input', { type: 'password', value: this.plainKey });
        inp.placeholder = API_KEY_PLACEHOLDER;
        inp.autocomplete = 'off';
        inp.spellcheck = false;
        inp.oninput = () => { this.plainKey = inp.value; };
      });
      row(bi('Model', '模型'), (p) => {
        const wrap = p.createDiv({ cls: 'nc-row-with-btn' });
        this.modelInput = wrap.createEl('input', { type: 'text', value: this.draft.model ?? '' });
        this.modelInput.placeholder = ['e.g. ', 'deepseek-chat'].join('');
        this.modelInput.autocomplete = 'off';
        this.modelInput.spellcheck = false;
        this.modelInput.oninput = () => { this.draft.model = this.modelInput.value; };
        const btn = wrap.createEl('button', { text: bi('Detect', '探测') });
        btn.type = 'button';
        btn.setAttribute('aria-label', bi('Detect models', '探测模型'));
        btn.onclick = () => this.detectModels(btn);
      });
      this.detectStatusEl = formEl.createDiv({ cls: 'nc-detect-status' });
    }

    const actions = formEl.createDiv({ cls: 'nc-add-form-actions' });
    const cancel = actions.createEl('button', { text: bi('Cancel', '取消') });
    cancel.type = 'button';
    cancel.onclick = () => this.close();
    const save = actions.createEl('button', { text: bi('Save endpoint', '保存端点'), cls: 'mod-cta' });
    save.type = 'button';
    save.onclick = () => this.save();
  }

  private async detectModels(btn: HTMLButtonElement) {
    if (btn.disabled) return;
    if (!this.draft.baseUrl || !this.plainKey) {
      this.detectStatusEl.setText(bi('Enter the Base URL and API key first.', '请先填写 Base URL 与 API key。'));
      return;
    }
    const baseUrl = this.validBaseUrl(this.draft.baseUrl);
    if (!baseUrl) {
      this.detectStatusEl.setText(bi('Base URL must use HTTP(S).', 'Base URL 必须使用 HTTP(S)。'));
      return;
    }
    this.detectStatusEl.setText(bi('Detecting models…', '正在探测模型…'));
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.textContent = bi('Detecting…', '探测中…');
    // Use plaintext key directly for detection — never persisted from this temp ep.
    const ep: Endpoint = {
      id: 'tmp', kind: 'custom-api',
      label: this.draft.label ?? '', baseUrl, apiKey: this.plainKey,
      apiStyle: this.draft.apiStyle ?? 'openai',
    };
    try {
      const list = normalizeModelList(await new CustomApiProvider(ep).listModels());
      btn.textContent = bi('Detect', '探测');
      if (list.length === 0) {
        this.detectStatusEl.setText(bi('The endpoint returned no models.', '端点没有返回模型列表。'));
        return;
      }
      this.detectStatusEl.setText(bi(`Found ${list.length} models.`, `找到 ${list.length} 个模型。`));
      // Replace model input with dropdown
      const oldRow = this.modelInput.closest('.nc-add-form-row');
      if (oldRow) {
        const right = oldRow.querySelector('div') as HTMLElement;
        right.empty();
        const cur = this.draft.model;
        const selected = cur && list.includes(cur) ? cur : list[0];
        this.draft.model = selected;
        createAlignedSelect(
          right,
          this.selectPopup,
          list.map(model => ({ value: model, label: model })),
          selected,
          value => { this.draft.model = value; },
          bi('Detected model', '已探测模型'),
        );
      }
    } catch (e) {
      btn.textContent = bi('Detect', '探测');
      this.detectStatusEl.setText(bi(`Detection failed: ${e.message}`, `探测失败：${e.message}`));
    } finally {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
    }
  }

  private save() {
    if (this.selectedKind === 'custom-api' && (!this.draft.baseUrl || !this.plainKey)) {
      new Notice(bi('Enter the Base URL and API key.', '请填写 Base URL 与 API key。')); return;
    }
    if (this.selectedKind === 'custom-api') {
      const baseUrl = this.validBaseUrl(this.draft.baseUrl);
      if (!baseUrl) { new Notice(bi('Base URL must use HTTP(S).', 'Base URL 必须使用 HTTP(S)。')); return; }
      this.draft.baseUrl = baseUrl;
    }
    const ep: Endpoint = {
      id: uid(),
      kind: this.selectedKind,
      label: this.draft.label || bi('New endpoint', '新端点'),
      ...this.draft,
      apiKey: '',          // populated by storeApiKey() in caller
      proxyMode: 'global',
    };
    if (ep.kind === 'claude-code-cli' && !ep.maxTurns) ep.maxTurns = 1;
    if (ep.kind === 'claude-code-cli' && ep.bareMode == null) ep.bareMode = true;
    const warn = localCliWarning(ep.kind) ?? codexSafetyWarning(ep);
    if (warn) new Notice(`Warning: ${warn}`, 10000);
    void this.onSave(ep, this.plainKey);
    this.close();
  }

  private validBaseUrl(raw?: string): string | null {
    const trimmed = (raw ?? '').trim();
    if (!trimmed) return null;
    try {
      const u = new URL(trimmed);
      if (!/^https?:$/.test(u.protocol)) return null;
      return trimmed.replace(/\/+$/, '');
    } catch {
      return null;
    }
  }
}

/* ============================================================
   Codex diagnostic modal — full transcript of the test run
   ============================================================ */
class CodexDiagnosticModal extends Modal {
  constructor(app: App, private result: AnyValue) { super(app); }

  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass('nc-codex-diag-modal');
    contentEl.empty();
    contentEl.createEl('h2', { text: 'Codex CLI diagnostic' });
    const r = this.result;

    // Verdict block at the top
    const verdict = contentEl.createDiv({ cls: 'nc-codex-diag-verdict' });
    verdict.textContent = r.diagnosis;
    if (r.diagnosis.startsWith('✅')) verdict.addClass('ok');
    else if (r.diagnosis.startsWith('⚠'))  verdict.addClass('warn');
    else verdict.addClass('fail');

    // Summary table
    const summary = contentEl.createDiv({ cls: 'nc-codex-diag-summary' });
    const row = (k: string, v: string) => {
      const r1 = summary.createDiv({ cls: 'nc-codex-diag-row' });
      r1.createSpan({ text: k, cls: 'nc-codex-diag-k' });
      r1.createSpan({ text: v, cls: 'nc-codex-diag-v' });
    };
    row('Version check', r.version.ok ? `✓ ${r.version.message}` : `✗ ${r.version.message}`);
    row('Working dir', r.cwd);
    row('Exit code', String(r.exitCode));
    row('Duration', `${r.durationMs}ms`);
    // Surface model arg explicitly — easy to miss in the long Command pre.
    const mIdx = r.args.indexOf('-m');
    const modelArg = mIdx >= 0 ? r.args[mIdx + 1] : '';
    row('Model arg', modelArg || '(none — codex uses ~/.codex/config.toml)');
    row('PATH', (r.env.PATH ?? '').slice(0, 200) + ((r.env.PATH?.length ?? 0) > 200 ? '…' : ''));
    row('OPENAI_API_KEY', r.env.OPENAI_API_KEY ?? '(not set)');
    // Where the proxy (if any) is coming from. "settings" = user filled Global
    // proxy URL field. "shell-rc" = auto-captured from $SHELL -lic 'env' at
    // startup. "none" = neither — codex will go direct.
    const pSource = r.env.proxySource ?? 'none';
    row('Proxy source', pSource === 'settings' ? 'Settings → Network → Proxy'
                       : pSource === 'shell-rc' ? `auto-detected from ~/.zshrc (HTTPS=${r.env.shellProxyHTTPS ?? '(empty)'})`
                       : '⚠ NONE — fill Settings → Network → Proxy');

    // Args
    contentEl.createEl('h4', { text: 'Command' });
    const cmd = contentEl.createEl('pre', { cls: 'nc-codex-diag-pre' });
    cmd.textContent = `codex ${r.args.map((a: string) => /\s|"/.test(a) ? `'${a}'` : a).join(' ')}`;

    // Event timeline — most useful section for debugging
    if (r.eventTimeline?.length) {
      contentEl.createEl('h4', { text: `Event timeline (${r.eventTimeline.length} events)` });
      const tl = contentEl.createDiv({ cls: 'nc-codex-diag-timeline' });
      for (const ev of r.eventTimeline) {
        const row = tl.createDiv({ cls: 'nc-codex-diag-tl-row' });
        row.createSpan({ cls: 'nc-codex-diag-tl-time', text: `+${(ev.at / 1000).toFixed(2)}s` });
        row.createSpan({ cls: 'nc-codex-diag-tl-type', text: ev.type });
        if (ev.payload) row.createSpan({ cls: 'nc-codex-diag-tl-payload', text: ev.payload });
      }
    }

    // Parsed text
    contentEl.createEl('h4', { text: `Parsed reply (${r.parsedText.length} chars)` });
    contentEl.createEl('pre', { cls: 'nc-codex-diag-pre', text: r.parsedText || '(none)' });

    // stdout
    contentEl.createEl('h4', { text: `stdout (${r.stdout.length} bytes)` });
    contentEl.createEl('pre', { cls: 'nc-codex-diag-pre nc-codex-diag-stream', text: r.stdout.slice(0, 6000) || '(empty)' });

    // stderr
    contentEl.createEl('h4', { text: `stderr (${r.stderr.length} bytes)` });
    contentEl.createEl('pre', { cls: 'nc-codex-diag-pre nc-codex-diag-stream', text: r.stderr.slice(0, 6000) || '(empty)' });

    const footer = contentEl.createDiv({ cls: 'modal-button-container' });
    setStyle(footer, { display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '12px' });
    // Quick-fix button when no proxy was detected.
    const haveProxy = !!(r.env.HTTPS_PROXY || r.env.HTTP_PROXY || r.env.ALL_PROXY);
    if (!haveProxy && /Reconnect|timeout|network|connection|tls|dns/i.test(r.diagnosis)) {
      footer.createEl('button', { text: 'Open proxy settings', cls: 'mod-warning' }).onclick = () => {
        this.close();
        // Defer-and-scroll: re-open settings, then scroll the proxy input into view.
        window.setTimeout(() => {
          (this.app as AnyValue).setting.open();
          (this.app as AnyValue).setting.openTabById('glossa');
          window.setTimeout(() => {
            // Find by stable data-glossa-id, NOT by label text. The label was
            // renamed multiple times (Global proxy URL → Proxy → 代理) and
            // every rename broke this scroll-to-field jump.
            const target = activeDocument.querySelector('[data-glossa-id="global-proxy"]');
            if (target) {
              target.scrollIntoView({ behavior: 'smooth', block: 'center' });
              target.querySelector('input')?.focus();
            }
          }, 200);
        }, 50);
      };
    }
    footer.createEl('button', { text: 'Close' }).onclick = () => this.close();
  }
}
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- Re-enable review lint rules after dynamic boundary module. */
