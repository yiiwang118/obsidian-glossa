import { App, PluginSettingTab, Setting, Notice, Modal } from 'obsidian';
import type GlossaPlugin from './main';
import type { Endpoint, CustomPrompt, SlashCommand } from './types';
import { reasoningOptionsForEndpoint } from './types';
import { resolveBinary } from './utils/env';
import { uid, setStyle } from './utils/dom';
import { CustomApiProvider } from './providers/custom_api';
import { buildProvider } from './providers/registry';
import { MCP_CATALOG, MCP_CATEGORIES, fetchCatalog, type McpEntry } from './agent/mcp_marketplace';
import { TOOLS } from './agent/tools';
import { metaFor } from './agent/tool_meta';
import { t, bi } from './utils/i18n';

const HTTP_PROXY_PLACEHOLDER = ['http', '://127.0.0.1:7890'].join('');
const HTTPS_API_PLACEHOLDER = ['https', '://api.example.com/v1'].join('');
const HTTPS_URL_PLACEHOLDER = ['https', '://...'].join('');
const API_KEY_PLACEHOLDER = 'sk-' + '...';
const MCP_LABEL = 'M' + 'CP';
const DETECT_BUTTON_LABEL = '↻ ' + 'Detect';
const IMPORT_URL_BUTTON_LABEL = '+ ' + 'Import URL';

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

const KIND_CARDS = [
  { kind: 'custom-api' as const,      title: 'Custom API',     badge: 'HTTP',  desc: 'Any OpenAI / Anthropic-compatible endpoint. DeepSeek, Qwen, GLM, MiniMax, Ollama, etc.' },
  { kind: 'codex-cli' as const,       title: 'Codex CLI',      badge: 'LOCAL', desc: 'Reuses your local codex binary + ~/.codex/auth.json' },
  { kind: 'claude-code-cli' as const, title: 'Claude Code',    badge: 'LOCAL', desc: 'Reuses local claude (--bare --max-turns 1)' },
];

function renderWarningHint(parent: HTMLElement, text: string) {
  const hint = parent.createEl('div', { cls: 'nc-info-hint nc-warning-hint' });
  hint.createEl('strong', { text: 'Warning' });
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

type SettingsTab = 'general' | 'providers' | 'agent' | 'security' | 'rag' | 'mcp' | 'workflows' | 'advanced';

export class GlossaSettingTab extends PluginSettingTab {
  private activeTab: SettingsTab = 'general';

  constructor(app: App, public plugin: GlossaPlugin) { super(app, plugin); }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('nc-settings');

    this.renderHeading(containerEl, 'Glossa', undefined, true);
    const intro = containerEl.createEl('p', {
      text: 'AI sidekick for your Obsidian vault — chat, agent mode, retrieval, and tool integrations.',
      cls: 'setting-item-description',
    });
    intro.dataset.glossaAlways = 'true';

    // ---- Tab bar ----
    const tabs: { id: SettingsTab; label: string }[] = [
      { id: 'general',   label: 'General' },
      { id: 'providers', label: 'Providers' },
      { id: 'agent',     label: 'Agent' },
      { id: 'security',  label: 'Security' },
      { id: 'rag',       label: 'RAG' },
      { id: 'mcp',       label: 'MCP' },
      { id: 'workflows', label: 'Workflows' },
      { id: 'advanced',  label: 'Advanced' },
    ];
    const bar = containerEl.createEl('div', { cls: 'nc-settings-tabs' });
    for (const t of tabs) {
      const tabEl = bar.createEl('div', { cls: 'nc-settings-tab' + (this.activeTab === t.id ? ' active' : ''), text: t.label });
      tabEl.onclick = () => { this.activeTab = t.id; this.display(); };
    }

    // Render all the sections into a single document, then hide everything not matching activeTab.
    // (Keeps code simple — full-page rebuild is fine at human speed.)
    this.renderAll(containerEl);
    this.applyTabFilter(containerEl);
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
      // Top-of-page items: title, opening description, tab bar — always visible.
      if (child.dataset.glossaAlways === 'true' || child.classList.contains('nc-settings-tabs')) {
        setStyle(child, { display: '' });
        continue;
      }

      // Explicit data-tab attribute on h3 / setting block.
      const explicit = child.dataset?.tab as SettingsTab | undefined;
      if (explicit) { currentTab = explicit; }
      // Legacy: nc-security-banner used to drift state; keep for safety.
      else if (child.classList.contains('nc-security-banner')) { currentTab = 'security'; }

      setStyle(child, { display: (currentTab === this.activeTab) ? '' : 'none' });
    }
  }

  private renderHeading(containerEl: HTMLElement, text: string, tab?: SettingsTab, always = false): Setting {
    const heading = new Setting(containerEl).setName(text).setHeading();
    if (tab) heading.settingEl.dataset.tab = tab;
    if (always) heading.settingEl.dataset.glossaAlways = 'true';
    return heading;
  }

  private createSettingsGroup(parent: HTMLElement, title: string, desc?: string, open = false): HTMLElement {
    const details = parent.createEl('details', { cls: 'nc-settings-group' });
    details.open = open;
    const summary = details.createEl('summary', { cls: 'nc-settings-group-summary' });
    summary.createEl('span', { cls: 'nc-settings-group-title', text: title });
    if (desc) summary.createEl('span', { cls: 'nc-settings-group-desc', text: desc });
    return details.createEl('div', { cls: 'nc-settings-group-body' });
  }

  private renderAll(containerEl: HTMLElement): void {

    // Security banner — only shown when encryption is ON, so users in the
    // default (plaintext) flow aren't nagged about it on every settings open.
    // When encryption is on we still surface lock/mixed states so the user can
    // act on them. The dedicated "Encryption" section near the bottom handles
    // the opt-in for users who want it.
    if (this.plugin.settings.encryptionEnabled) {
      const hasAnyPlainKey = this.plugin.settings.endpoints.some(ep => ep.apiKey && !ep.apiKey.startsWith('NCENC1:'));
      const hasAnyEncKey   = this.plugin.settings.endpoints.some(ep => ep.apiKey && ep.apiKey.startsWith('NCENC1:'));
      const sec = containerEl.createEl('div', { cls: 'nc-security-banner', attr: { 'data-tab': 'security' } });
      let title = '', body = '';
      if (!this.plugin.isUnlocked()) {
        title = '🔒 Encrypted — locked';
        body = `Keys are AES-GCM encrypted at rest. Run "Unlock encrypted keys" from the command palette to use them.`;
        setStyle(sec, { borderColor: '#5b9bff' }); setStyle(sec, { background: 'rgba(91,155,255,0.10)' });
      } else if (hasAnyPlainKey && hasAnyEncKey) {
        title = '⚠ Mixed';
        body = `Some endpoints have plaintext keys despite encryption being on. Re-enter their API keys to encrypt them.`;
        setStyle(sec, { borderColor: '#d4a72c' }); setStyle(sec, { background: 'rgba(212,167,44,0.10)' });
      } else {
        title = '🔓 Encrypted — unlocked';
        body = `API keys decrypt in memory only. Restart Obsidian → lock again. Passphrase is never stored.`;
        setStyle(sec, { borderColor: '#3fb950' }); setStyle(sec, { background: 'rgba(63,185,80,0.08)' });
      }
      sec.createEl('div', { cls: 'nc-security-title', text: title });
      sec.createEl('div', { cls: 'nc-security-body', text: body });
    }

    /* ----- Language ----- */
    const langSetting = new Setting(containerEl)
      .setName(t('language'))
      .setDesc(t('language_desc'))
      .addDropdown(d => d
        .addOption('auto', t('lang_auto'))
        .addOption('en',   t('lang_en'))
        .addOption('zh',   t('lang_zh'))
        .setValue(this.plugin.settings.uiLanguage)
        .onChange(async v => {
          this.plugin.settings.uiLanguage = v as any;
          await this.plugin.saveSettings();
          // setLanguage() inside saveSettings triggers onLanguageChange
          // subscribers; the view re-renders itself, and we redraw this tab.
          this.display();
        }));
    langSetting.settingEl.dataset.tab = 'general';

    /* ----- Font size — drives the WHOLE plugin (prose + reasoning + lists) ----- */
    const fontSetting = new Setting(containerEl)
      .setName(t('font_size'))
      .setDesc(t('font_size_desc'))
      .addSlider(s => {
        s.setLimits(11, 18, 1).setValue(this.plugin.settings.reasoningFontSize ?? 13).setDynamicTooltip();
        // Debounce: Obsidian's slider fires 'input' on every drag pixel, which
        // would re-run iterateAllLeaves+applyCssVars per pixel — heavy. Wait
        // 150ms after the user stops moving before applying.
        let timer: any = null;
        s.onChange(v => {
          this.plugin.settings.reasoningFontSize = v;
          if (timer) window.clearTimeout(timer);
          timer = window.setTimeout(async () => {
            timer = null;
            await this.plugin.saveSettings();
            this.plugin.app.workspace.iterateAllLeaves(l => {
              const view: any = (l.view as any);
              if (typeof view.applyCssVars === 'function') view.applyCssVars();
            });
          }, 150);
        });
      });
    fontSetting.settingEl.dataset.tab = 'general';

    /* ----- Active endpoint ----- */
    const activeEpSetting = new Setting(containerEl)
      .setName(bi('Active endpoint', '当前 endpoint'))
      .setDesc('')
      .addDropdown(dd => {
        if (this.plugin.settings.endpoints.length === 0) dd.addOption('', '(None — add one below)');
        else for (const ep of this.plugin.settings.endpoints) dd.addOption(ep.id, `${ep.label} · ${ep.kind}`);
        dd.setValue(this.plugin.settings.activeEndpointId ?? '');
        dd.onChange(async v => { this.plugin.settings.activeEndpointId = v || null; await this.plugin.saveSettings(); });
      });
    activeEpSetting.settingEl.dataset.tab = 'providers';

    /* ----- Proxy ----- */
    this.renderHeading(containerEl, bi('Network', '网络'), 'advanced');
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

    /* ----- Context ----- */
    this.renderHeading(containerEl, bi('Context', '上下文'), 'advanced');
    new Setting(containerEl).setName(bi('Auto-attach current file', '自动附加当前文件')).addToggle(t => t
      .setValue(this.plugin.settings.autoAttachCurrentFile)
      .onChange(async v => { this.plugin.settings.autoAttachCurrentFile = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName(bi('Auto-attach selection', '自动附加选中'))
      .setDesc(bi('Markdown / PDF / HTML.', 'Markdown / PDF / HTML。'))
      .addToggle(t => t
        .setValue(this.plugin.settings.autoAttachSelection)
        .onChange(async v => { this.plugin.settings.autoAttachSelection = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName(bi('Warn token threshold', 'Token 警告阈值'))
      .addText(t => t.setValue(String(this.plugin.settings.warnTokenThreshold))
        .onChange(async v => { this.plugin.settings.warnTokenThreshold = parseInt(v) || 50000; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName(bi('Cost bar', '费用条')).addToggle(t => t
      .setValue(this.plugin.settings.showCostBar)
      .onChange(async v => { this.plugin.settings.showCostBar = v; await this.plugin.saveSettings(); }));

    /* ----- Agent ----- */
    this.renderHeading(containerEl, 'Agent', 'agent');
    new Setting(containerEl).setName(bi('Permission', '权限'))
      .setDesc(bi('read-only · workspace-write · full', 'read-only · workspace-write · full'))
      .addDropdown(d => d.addOption('read-only', 'Read-only').addOption('workspace-write', 'Workspace-write').addOption('full', 'Full')
        .setValue(this.plugin.settings.permissionLevel)
        .onChange(async v => { this.plugin.settings.permissionLevel = v as any; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName(bi('Default mode', '默认模式'))
      .setDesc(bi('Plan = no writes. Act = full agent.', 'Plan 不写文件。Act 完整 agent。'))
      .addDropdown(d => d.addOption('act', 'Act').addOption('plan', 'Plan')
        .setValue(this.plugin.settings.runMode)
        .onChange(async v => { this.plugin.settings.runMode = v as any; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName(bi('Max steps', '最大步数'))
      .setDesc('')
      .addText(t => t.setValue(String(this.plugin.settings.agentMaxSteps))
        .onChange(async v => { this.plugin.settings.agentMaxSteps = parseInt(v) || 20; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName(bi('Project context', '项目上下文'))
      .setDesc(bi('Auto-load AGENTS.md / CLAUDE.md / .codex.md.', '自动加载 AGENTS.md / CLAUDE.md / .codex.md。'))
      .addToggle(t => t.setValue(this.plugin.settings.loadProjectContext)
        .onChange(async v => { this.plugin.settings.loadProjectContext = v; await this.plugin.saveSettings(); }));

    /* Auto-approve checkboxes per tool */
    const autoGroup = this.createSettingsGroup(
      containerEl,
      bi('Auto-approve tools', '自动批准工具'),
      bi('Advanced. Only enable tools you trust.', '高级项。只给可信工具开启。'),
    );
    const autoCard = autoGroup.createEl('div', { cls: 'nc-endpoint-card nc-settings-plain-card' });
    autoCard.createEl('div', { cls: 'nc-endpoint-card-header' }).createEl('span', { text: bi('Auto-approve', '自动批准') });
    // Single source of truth for the tool list — pulled from the live TOOLS registry,
    // so flag changes there propagate automatically (fixes #7 web_fetch mismatch).
    const allTools = Object.values(TOOLS).map(t => ({
      name: t.spec.name,
      dangerous: t.dangerous,
      verb: metaFor(t.spec.name).verb,
    }));
    // Sort: safe reads first, then writes/network last
    allTools.sort((a, b) => Number(a.dangerous) - Number(b.dangerous) || a.name.localeCompare(b.name));
    for (const t of allTools) {
      const label = t.dangerous ? `${t.name}  ⚠` : t.name;
      new Setting(autoCard).setName(label).setDesc('')
        .addToggle(tg => tg.setValue(this.plugin.settings.agentAlwaysApproveTools.includes(t.name))
          .onChange(async v => {
            const list = new Set(this.plugin.settings.agentAlwaysApproveTools);
            if (v) list.add(t.name); else list.delete(t.name);
            this.plugin.settings.agentAlwaysApproveTools = [...list];
            await this.plugin.saveSettings();
          }));
    }

    /* ----- Persisted permission rules (from "Always allow…" choices) ----- */
    const ruleGroup = this.createSettingsGroup(
      containerEl,
      bi('Approval rules', '批准规则'),
      bi('Saved “always allow” choices and audit log.', '保存的“始终允许”选择和审计日志。'),
    );
    ruleGroup.createEl('p', { cls: 'setting-item-description',
      text: 'Rules you saved by clicking "always allow…" in the inline approval. The agent loop consults these before prompting.' });
    const rules = this.plugin.settings.permissionRules ?? [];
    if (rules.length === 0) {
      ruleGroup.createEl('p', { cls: 'setting-item-description', text: '(None yet)' });
    } else {
      for (const r of rules) {
        const row = ruleGroup.createEl('div', { cls: 'nc-permission-rule' });
        const lab = row.createEl('span');
        lab.appendChild(activeDocument.createTextNode(`${r.behavior === 'allow' ? '✓' : '✗'} `));
        const codeEl = lab.appendChild(activeDocument.createElement('code'));
        codeEl.textContent = r.tool;
        if (r.scope !== 'global' && r.value) {
          lab.appendChild(activeDocument.createTextNode(` · ${r.scope}: `));
          const v = lab.appendChild(activeDocument.createElement('code'));
          v.textContent = r.value;
        } else {
          lab.appendChild(activeDocument.createTextNode(` · everywhere`));
        }
        row.createEl('span', { cls: 'nc-permission-rule-meta', text: new Date(r.addedAt).toLocaleDateString() });
        const del = row.createEl('button', { text: '✕', cls: 'mod-warning' });
        setStyle(del, { marginLeft: 'auto' });
        del.onclick = async () => {
          this.plugin.settings.permissionRules = rules.filter(x => x !== r);
          await this.plugin.saveSettings();
          this.display();
        };
      }
      new Setting(ruleGroup).addButton(b => b.setButtonText('Clear all rules').setWarning().onClick(async () => {
        this.plugin.settings.permissionRules = [];
        await this.plugin.saveSettings();
        this.display();
      }));
    }

    /* ----- Approval audit log ----- */
    const log = this.plugin.settings.permissionLog ?? [];
    if (log.length > 0) {
      const det = ruleGroup.createEl('details', { cls: 'nc-settings-subdetails' });
      const summary = det.createEl('summary', { text: `Last ${log.length} decisions (most recent first)` });
      setStyle(summary, { cursor: 'pointer', fontSize: '12px', color: 'var(--text-muted)' });
      const tbl = det.createEl('div');
      setStyle(tbl, { maxHeight: '240px', overflowY: 'auto', fontSize: '11px', fontFamily: 'var(--font-monospace)', marginTop: '8px' });
      for (const e of log.slice().reverse().slice(0, 100)) {
        const row = tbl.createEl('div');
        setStyle(row, { padding: '3px 0', display: 'flex', gap: '8px', borderBottom: '1px solid var(--background-modifier-border)' });
        const date = new Date(e.at);
        const dateEl = row.createEl('span', { text: date.toLocaleTimeString() });
        setStyle(dateEl, { color: 'var(--text-faint)', minWidth: '80px' });
        const colors: Record<string, string> = {
          'allow': '#3fb950', 'auto-allow': '#3fb950', 'allowed-by-rule': '#5b9bff',
          'deny': '#f85149', 'auto-deny': '#f85149', 'denied-by-rule': '#f85149',
        };
        const decisionEl = row.createEl('span', { text: e.decision });
        setStyle(decisionEl, { color: colors[e.decision] ?? 'var(--text-muted)', minWidth: '110px', fontWeight: '600' });
        const toolEl = row.createEl('span', { text: e.tool });
        setStyle(toolEl, { color: 'var(--text-normal)', minWidth: '120px' });
        if (e.scope) {
          const scopeEl = row.createEl('span', { text: e.scope });
          setStyle(scopeEl, { color: 'var(--text-muted)' });
        }
        if (e.args) {
          const argsEl = row.createEl('span', { text: e.args });
          setStyle(argsEl, { color: 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '1' });
        }
      }
      new Setting(ruleGroup).addButton(b => b.setButtonText('Clear log').onClick(async () => {
        this.plugin.settings.permissionLog = [];
        await this.plugin.saveSettings();
        this.display();
      }));
    }

    /* ----- Encryption (optional) ----- */
    this.renderHeading(containerEl, bi('Encryption', '加密'), 'security');
    containerEl.createEl('p', { cls: 'setting-item-description',
      text: this.plugin.settings.encryptionEnabled
        ? (this.plugin.isUnlocked() ? bi('🔓 unlocked', '🔓 已解锁') : bi('🔒 locked', '🔒 已锁定'))
        : bi('Off. Enabling wraps API keys with a passphrase-derived AES-256 key.',
             '关闭。开启后用 passphrase 派生 AES-256 加密 API key。') });
    // Scope clarification — kept brief. Users should know chats.json is plaintext.
    const scope = containerEl.createEl('div', { cls: 'nc-info-hint' });
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
        .setDesc('')
        .addButton(b => b.setButtonText(bi('Lock', '锁定')).onClick(() => { this.plugin.lock(); this.display(); }));
      new Setting(containerEl).setName(bi('Encrypt plaintext keys', '加密明文密钥'))
        .setDesc(bi('Wrap any remaining plaintext API keys.', '加密剩余明文 API key。'))
        .addButton(b => b.setButtonText(bi('Run', '运行')).setCta().onClick(async () => {
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
        }));
    }
    const maintenance = this.createSettingsGroup(
      containerEl,
      bi('Maintenance', '维护'),
      bi('Dangerous cleanup actions. Usually unnecessary.', '危险清理操作。通常不需要。'),
    );
    new Setting(maintenance).setName(bi('Purge checkpoints', '清空检查点'))
      .setDesc('')
      .addButton(b => b.setButtonText(bi('Purge', '清空')).setWarning().onClick(async () => {
        const { confirmModal } = await import('./ui/confirm_modal');
        const ok = await confirmModal(this.app, {
          title: bi('Purge checkpoints', '清空检查点'),
          body: bi('Delete all checkpoint snapshots?', '删除所有检查点快照？'),
          confirmText: bi('Delete', '删除'),
          danger: true,
        });
        if (!ok) return;
        await this.plugin.checkpoint.purgeAll();
        new Notice(bi('Checkpoints purged.', '已清空检查点。'));
      }));
    new Setting(maintenance).setName(bi('Purge embedding index', '清空嵌入索引'))
      .setDesc('')
      .addButton(b => b.setButtonText(bi('Purge', '清空')).setWarning().onClick(async () => {
        const { confirmModal } = await import('./ui/confirm_modal');
        const ok = await confirmModal(this.app, {
          title: bi('Purge embedding index', '清空嵌入索引'),
          body: bi('Delete the embedding index?', '删除嵌入索引？'),
          confirmText: bi('Delete', '删除'),
          danger: true,
        });
        if (!ok) return;
        try { await this.plugin.app.vault.adapter.remove(`${this.plugin.manifest.dir}/embeddings.json`); } catch { /* ignore */ }
        new Notice(bi('Embedding index removed.', '已删除嵌入索引。'));
      }));
    new Setting(maintenance).setName(bi('Purge legacy chat content', '清理旧对话内容'))
      .setDesc('')
      .addButton(b => b.setButtonText(bi('Run', '运行')).onClick(async () => {
        const n = await this.plugin.store.purgeLegacyContext();
        new Notice(bi(`Stripped ${n} legacy fields.`, `已清理 ${n} 个旧字段。`));
      }));

    /* ----- Embedding RAG ----- */
    this.renderHeading(containerEl, bi('Semantic search', '语义搜索'), 'rag');
    new Setting(containerEl).setName(bi('Endpoint', 'Endpoint'))
      .setDesc(bi('OpenAI-compatible /embeddings.', 'OpenAI 兼容 /embeddings。'))
      .addDropdown(d => {
        d.addOption('', '(None)');
        for (const ep of this.plugin.settings.endpoints) {
          if (ep.kind !== 'custom-api') continue;
          if ((ep.apiStyle ?? 'openai') !== 'openai') continue;
          d.addOption(ep.id, ep.label);
        }
        d.setValue(this.plugin.settings.embeddingEndpointId ?? '');
        d.onChange(async v => { this.plugin.settings.embeddingEndpointId = v || null; await this.plugin.saveSettings(); });
      });
    new Setting(containerEl).setName(bi('Model', '模型'))
      .setDesc(bi('e.g. text-embedding-3-small', '例：text-embedding-3-small'))
      .addText(t => t.setValue(this.plugin.settings.embeddingModel).onChange(async v => { this.plugin.settings.embeddingModel = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName(bi('Chunk size / overlap', '分块大小 / 重叠'))
      .setDesc('')
      .addText(t => t.setValue(String(this.plugin.settings.embeddingChunkSize)).onChange(async v => { this.plugin.settings.embeddingChunkSize = parseInt(v) || 1500; await this.plugin.saveSettings(); }))
      .addText(t => t.setValue(String(this.plugin.settings.embeddingChunkOverlap)).onChange(async v => { this.plugin.settings.embeddingChunkOverlap = parseInt(v) || 200; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName(bi('Rebuild index', '重建索引'))
      .setDesc(`${this.plugin.embeddingIndex.size()} chunks · ${this.plugin.embeddingIndex.modelInfo().model || '(none)'}`)
      .addButton(b => b.setButtonText(bi('Build', '构建')).setCta().onClick(async () => { await this.plugin.rebuildEmbeddings(); this.display(); }));

    /* ----- Checkpoint ----- */
    this.renderHeading(containerEl, bi('Checkpoints', '检查点'), 'security');
    new Setting(containerEl).setName(bi('Snapshot before edits', '编辑前快照'))
      .setDesc(bi('Enables the Rollback button on edits.', '为编辑启用 Rollback 按钮。'))
      .addToggle(t => t.setValue(this.plugin.settings.checkpointEnabled).onChange(async v => { this.plugin.settings.checkpointEnabled = v; await this.plugin.saveSettings(); }));

    /* ----- Auto-compaction ----- */
    this.renderHeading(containerEl, bi('Auto-compact', '自动压缩'), 'agent');
    new Setting(containerEl).setName(bi('Enable', '开启'))
      .setDesc(bi('Summarise older turns when context fills up.', '上下文将满时压缩历史轮次。'))
      .addToggle(t => t.setValue(this.plugin.settings.autoCompactEnabled).onChange(async v => { this.plugin.settings.autoCompactEnabled = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName(bi('Threshold (%)', '阈值 (%)'))
      .setDesc('')
      .addSlider(s => s.setLimits(40, 95, 5).setValue(this.plugin.settings.autoCompactThresholdPct).setDynamicTooltip()
        .onChange(async v => { this.plugin.settings.autoCompactThresholdPct = v; await this.plugin.saveSettings(); }));

    /* ----- MCP servers ----- */
    this.renderHeading(containerEl, bi('MCP servers', 'MCP 服务'), 'mcp');
    new Setting(containerEl).addButton(b => b.setButtonText(bi('+ Add', '+ 新增')).onClick(async () => {
      this.plugin.settings.mcpServers.push({ id: uid(), name: 'server-' + (this.plugin.settings.mcpServers.length + 1), command: '', args: [], enabled: true });
      await this.plugin.saveSettings(); this.display();
    }))
    .addButton(b => b.setButtonText(bi('Marketplace', '市场')).setCta().onClick(() => {
      new McpMarketplaceModal(this.plugin, () => this.display()).open();
    }))
    .addButton(b => b.setButtonText(bi('Reconnect all', '全部重连')).onClick(async () => {
      await this.plugin.mcp.start(this.plugin.settings.mcpServers);
      new Notice(bi(`${this.plugin.mcp.clients.length} server(s), ${this.plugin.mcp.allTools().length} tools.`,
                    `${this.plugin.mcp.clients.length} 个服务，${this.plugin.mcp.allTools().length} 个工具。`));
    }));
    for (const s of this.plugin.settings.mcpServers) {
      const client = this.plugin.mcp.clients.find(c => c.cfg.id === s.id);
      const statusBadge = client?.status === 'connected' ? '🟢 connected'
                       : client?.status === 'connecting' ? '🟡 connecting'
                       : client?.status === 'failed' ? `🔴 failed${client.lastError ? ' — ' + client.lastError.slice(0, 60) : ''}`
                       : '⚪ idle';
      const card = containerEl.createEl('div', { cls: 'nc-endpoint-card' });
      const hdr = card.createEl('div', { cls: 'nc-endpoint-card-header' });
      hdr.createEl('span', { text: s.name });
      hdr.createEl('span', { cls: 'nc-endpoint-kind-badge', text: statusBadge });
      const del = hdr.createEl('button', { text: bi('Delete', '删除'), cls: 'mod-warning' });
      del.onclick = async () => {
        this.plugin.settings.mcpServers = this.plugin.settings.mcpServers.filter(x => x.id !== s.id);
        await this.plugin.saveSettings(); this.display();
      };
      new Setting(card).setName(bi('Name', '名称')).addText(t => t.setValue(s.name).onChange(async v => { s.name = v; await this.plugin.saveSettings(); }));
      new Setting(card).setName(bi('Command', '命令')).setDesc(bi('⚠ Spawns a local process.', '⚠ 会启动本地进程。'))
        .addText(t => t.setValue(s.command).onChange(async v => { s.command = v; await this.plugin.saveSettings(); }));
      new Setting(card).setName(bi('Args', '参数'))
        .setDesc(bi('Shell-quoted.', 'Shell 风格转义。'))
        .addText(t => t.setValue((s.args ?? []).map(a => /\s|"/.test(a) ? `'${a.replace(/'/g, "\\'")}'` : a).join(' '))
          .onChange(async v => {
            const { shellSplit } = await import('./utils/shell_split');
            s.args = shellSplit(v);
            await this.plugin.saveSettings();
          }));
      new Setting(card).setName(bi('Enabled', '启用')).addToggle(tg => tg.setValue(s.enabled).onChange(async v => { s.enabled = v; await this.plugin.saveSettings(); }));
      if (client) {
        new Setting(card).setName(bi('Tools', '工具')).setDesc(client.listTools().map(t => t.originalName).join(', ') || bi('(none yet)', '（暂无）'));
        const res = client.listResources();
        if (res.length > 0) {
          new Setting(card).setName(bi('Resources', '资源')).setDesc(res.map(r => r.name ?? r.uri).join(', '));
        }
        new Setting(card).setName(bi('Restart', '重启'))
          .setDesc(client.status === 'failed' && client.lastError ? `Error: ${client.lastError.slice(0, 100)}` : '')
          .addButton(b => b.setButtonText(bi('↻ Restart', '↻ 重启')).onClick(async () => {
            await this.plugin.mcp.restart(s.id);
            new Notice(bi(`Restarted ${s.name}: ${client.status}`, `已重启 ${s.name}：${client.status}`));
            this.display();
          }));
        if (client.recentStderr()) {
          const pre = card.createEl('details');
          pre.createEl('summary', { text: bi('Recent stderr', '最近 stderr') });
          const stderrEl = pre.createEl('pre', { text: client.recentStderr() });
          setStyle(stderrEl, { maxHeight: '160px', overflow: 'auto', fontSize: '11px' });
        }
      }
    }

    /* ----- Endpoints ----- */
    this.renderHeading(containerEl, bi('Endpoints', 'Endpoints'), 'providers');
    const addBtn = containerEl.createEl('button', { text: bi('+ Add endpoint', '+ 新增 endpoint'), cls: 'nc-add-endpoint-btn mod-cta' });
    addBtn.onclick = () => this.openAddEndpointModal();

    for (const ep of this.plugin.settings.endpoints) this.renderEndpointCard(containerEl, ep);

    /* ----- Chats folder ----- */
    this.renderHeading(containerEl, bi('Persistence', '持久化'), 'general');
    new Setting(containerEl).setName(bi('Chats folder', '对话文件夹'))
      .setDesc(bi('Export destination.', '导出目标。'))
      .addText(t => t.setValue(this.plugin.settings.chatsFolder).onChange(async v => {
        this.plugin.settings.chatsFolder = v || 'Chats'; await this.plugin.saveSettings();
      }));

    /* ----- Custom slash ----- */
    this.renderHeading(containerEl, bi('Custom slash', '自定义 /'), 'advanced');
    containerEl.createEl('p', {
      text: '${selection} ${file} ${filename} ${selection-or-file} ${vault} ${args}',
      cls: 'setting-item-description',
    });
    new Setting(containerEl).addButton(b => b.setButtonText('+ ' + 'Add command').onClick(async () => {
      this.plugin.settings.customSlashCommands.push({
        id: uid(), trigger: '/my-cmd', title: 'My command',
        template: 'Do something with ${selection}', custom: true,
      });
      await this.plugin.saveSettings(); this.display();
    }));
    for (const c of this.plugin.settings.customSlashCommands) this.renderSlashCmd(containerEl, c);

    /* ----- Workflows ----- */
    this.renderHeading(containerEl, bi('Workflows', '工作流'), 'workflows');
    new Setting(containerEl).addButton(b => b.setButtonText(bi('+ Add', '+ 新增')).onClick(async () => {
      this.plugin.settings.workflows.unshift({ id: uid(), title: bi('Untitled', '未命名'), prompt: '', createdAt: Date.now() });
      await this.plugin.saveSettings(); this.display();
    }));
    for (const w of this.plugin.settings.workflows) {
      const card = containerEl.createEl('div', { cls: 'nc-endpoint-card' });
      const hdr = card.createEl('div', { cls: 'nc-endpoint-card-header' });
      hdr.createEl('span', { text: new Date(w.createdAt).toLocaleDateString() });
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
  private async buildProviderFor(ep: Endpoint): Promise<any> {
    const vaultRoot = (this.app.vault.adapter as any).basePath as string | undefined;
    return buildProvider(ep, this.plugin.settings.globalProxy, vaultRoot);
  }

  private renderEndpointCard(parent: HTMLElement, ep: Endpoint) {
    const card = parent.createEl('div', { cls: 'nc-endpoint-card' });
    const hdr = card.createEl('div', { cls: 'nc-endpoint-card-header' });
    const left = hdr.createEl('div');
    left.createEl('span', { text: ep.label });
    left.createEl('span', { text: ep.kind, cls: 'nc-endpoint-kind-badge' });
    // Right side of header: Test connectivity + Delete
    const testBtn = hdr.createEl('button', { text: 'Test', cls: 'nc-endpoint-test-btn' });
    const testStatus = hdr.createEl('span', { cls: 'nc-endpoint-test-status' });
    testBtn.onclick = async () => {
      testStatus.removeClass('ok'); testStatus.removeClass('fail');
      testStatus.setText('…');
      const epDec = await this.plugin.getDecryptedEndpoint(ep);
      if (!epDec) { testStatus.setText('Locked'); testStatus.addClass('fail'); return; }
      try {
        const provider: any = await this.buildProviderFor(epDec);
        if (!provider?.testConnect) { testStatus.setText('Unsupported'); return; }
        const r = await provider.testConnect();
        testStatus.setText(r.message);
        testStatus.addClass(r.ok ? 'ok' : 'fail');
        if (r.ok) new Notice(`${ep.label}: ${r.message}`);
        else new Notice(`${ep.label} failed: ${r.message}`, 8000);
      } catch (e: any) {
        testStatus.setText(e.message ?? String(e));
        testStatus.addClass('fail');
      }
    };
    const delBtn = hdr.createEl('button', { text: 'Delete', cls: 'mod-warning' });
    delBtn.onclick = async () => {
      // Find every place this endpoint id is referenced so the deletion
      // doesn't leave dangling pointers (which caused 404s on embedding
      // rebuild and "no endpoint" ghost state on session restore).
      const refs: string[] = [];
      const isEmbedRef = this.plugin.settings.embeddingEndpointId === ep.id;
      if (isEmbedRef) refs.push('embedding endpoint');
      const sessionRefs: string[] = [];
      try {
        for (const s of (this.plugin.store?.all() ?? [])) {
          if (s.endpointId === ep.id) sessionRefs.push(s.title || s.id);
        }
      } catch { /* store might not be ready */ }
      if (sessionRefs.length > 0) {
        refs.push(`${sessionRefs.length} chat session${sessionRefs.length === 1 ? '' : 's'}`);
      }

      // If something refers to this endpoint, confirm before nulling out.
      if (refs.length > 0) {
        const { confirmModal } = await import('./ui/confirm_modal');
        const ok = await confirmModal(this.plugin.app, {
          title: `Delete endpoint "${ep.label}"?`,
          body:
            `Endpoint is referenced by:\n\n  • ${refs.join('\n  • ')}\n\n` +
            `Deleting will detach those references (they'll show as "no endpoint" until you pick a new one).`,
          confirmText: 'Delete & detach',
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

    const basic = card.createEl('div', { cls: 'nc-endpoint-basic' });
    const advanced = this.createSettingsGroup(
      card,
      bi('Advanced', '高级'),
      bi('Headers, proxy, diagnostics, sandbox, and compatibility options.', '请求头、代理、诊断、沙盒与兼容选项。'),
    );

    new Setting(basic).setName(bi('Label', '名称')).addText(t => t.setValue(ep.label).onChange(async v => { ep.label = v; await this.plugin.saveSettings(); }));

    if (ep.kind === 'custom-api') {
      new Setting(basic).setName(bi('API style', 'API 风格'))
        .addDropdown(d => d.addOption('openai', 'OpenAI').addOption('anthropic', 'Anthropic')
          .setValue(ep.apiStyle ?? 'openai')
          .onChange(async v => { ep.apiStyle = v as any; await this.plugin.saveSettings(); }));
      new Setting(basic).setName(bi('Base URL', '地址')).addText(t => t.setValue(ep.baseUrl ?? '').onChange(async v => {
        const trimmed = v.trim();
        if (trimmed) {
          // Reject anything that isn't http(s) — Electron's renderer fetch will
          // happily open file:// (local file disclosure) or data:// otherwise.
          try {
            const u = new URL(trimmed);
            if (!/^https?:$/.test(u.protocol)) {
              new Notice(`Base URL refused: only http(s) is allowed (got ${u.protocol}).`, 6000);
              return;
            }
          } catch {
            // Invalid URL → keep value as draft but don't save; user is mid-typing.
          }
        }
        ep.baseUrl = trimmed;
        await this.plugin.saveSettings();
      }));
      new Setting(basic).setName(bi('API Key', 'API Key'))
        .setDesc(ep.apiKey?.startsWith('NCENC1:') ? bi('✓ encrypted', '✓ 已加密') : (this.plugin.settings.encryptionEnabled ? bi('will encrypt on save', '保存时加密') : bi('plaintext', '明文')))
        .addText(t => {
          t.inputEl.type = 'password';
          const enc = ep.apiKey?.startsWith('NCENC1:');
          t.setPlaceholder(enc ? bi('(encrypted)', '（已加密）') : 'sk-…')
           .setValue(enc ? '' : (ep.apiKey ?? ''))
           .onChange(async v => { if (v) { await this.plugin.storeApiKey(ep, v); await this.plugin.saveSettings(); } });
        });

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
          const name = ep.kind === 'codex-cli' ? 'codex' : 'claude';
          const p = resolveBinary(name);
          if (p) { ep.binaryPath = p; await this.plugin.saveSettings(); this.display(); new Notice(`Found ${p}`); }
          else new Notice(`Not found. Install ${name} first.`);
        }));
      new Setting(basic).setName(t('cli_default_model'))
        .setDesc(t('cli_default_model_desc'))
        .addText(tx => tx.setValue(ep.model ?? '').onChange(async v => { ep.model = v; await this.plugin.saveSettings(); }));
      new Setting(basic).setName(t('reasoning_effort'))
        .setDesc(t('reasoning_effort_desc_cli'))
        .addDropdown(d => {
          const opts = reasoningOptionsForEndpoint(ep);
          for (const v of opts) d.addOption(v, t(`effort_${v}`));
          d.setValue(opts.includes(ep.reasoningEffort ?? 'off') ? (ep.reasoningEffort ?? 'off') : 'off');
          d.onChange(async v => { ep.reasoningEffort = v as any; await this.plugin.saveSettings(); });
        });
      new Setting(basic).setName(t('cli_working_dir')).setDesc(t('cli_working_dir_desc'))
        .addText(t => t.setValue(ep.cwd ?? '').onChange(async v => { ep.cwd = v; await this.plugin.saveSettings(); }))
        .addButton(b => b.setButtonText('Use vault').onClick(async () => {
          const vaultPath = (this.app.vault.adapter as any).basePath;
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
        const hint = advanced.createEl('div', { cls: 'nc-info-hint' });
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

        new Setting(advanced).setName(t('codex_sandbox'))
          .setDesc(t('codex_sandbox_desc'))
          .addDropdown(d => d.addOption('', '(Default)').addOption('read-only', 'Read-only').addOption('workspace-write', 'Workspace-write').addOption('danger-full-access', 'Danger-full-access ⚠')
            .setValue(ep.codexSandboxMode ?? '')
            .onChange(async v => {
              ep.codexSandboxMode = (v || undefined) as any;
              await this.plugin.saveSettings();
              const warn = codexSafetyWarning(ep);
              if (warn) new Notice(`Warning: ${warn}`, 10000);
              this.display();
            }));
        new Setting(advanced).setName(t('codex_approval'))
          .setDesc(t('codex_approval_desc'))
          .addDropdown(d => d.addOption('', '(Default)').addOption('untrusted', 'Untrusted').addOption('on-failure', 'On-failure').addOption('on-request', 'On-request').addOption('never', 'Never ⚠')
            .setValue(ep.codexApprovalPolicy ?? '')
            .onChange(async v => {
              ep.codexApprovalPolicy = (v || undefined) as any;
              await this.plugin.saveSettings();
              const warn = codexSafetyWarning(ep);
              if (warn) new Notice(`Warning: ${warn}`, 10000);
              this.display();
            }));
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
              const provider: any = await this.buildProviderFor(epDec);
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
            } catch (e: any) {
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
          .addText(tx => tx.setValue(String(ep.maxTurns ?? 1)).onChange(async v => { ep.maxTurns = parseInt(v) || 1; await this.plugin.saveSettings(); }));
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
          .addText(t => t.setValue(String(ep.claudeMaxBudgetUSD ?? '')).onChange(async v => { ep.claudeMaxBudgetUSD = parseFloat(v) || 0; await this.plugin.saveSettings(); }));
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
      new Setting(advanced).setName(bi('Proxy mode', '代理模式'))
        .setDesc(ep.kind === 'custom-api'
          ? bi('Follows system proxy.', '跟随系统代理。')
          : bi(`global = ${this.plugin.settings.globalProxy || 'unset'} · none · override`,
               `global = ${this.plugin.settings.globalProxy || '未设'} · none · override`))
        .addDropdown(d => d.addOption('global', 'Global').addOption('none', 'None').addOption('override', 'Override')
          .setValue(ep.proxyMode ?? 'global')
          .onChange(async v => { ep.proxyMode = v as any; await this.plugin.saveSettings(); this.display(); }));
      if (ep.proxyMode === 'override') {
        new Setting(advanced).setName(bi('Proxy URL', '代理 URL')).addText(t => t.setPlaceholder(HTTP_PROXY_PLACEHOLDER).setValue(ep.proxy ?? '').onChange(async v => { ep.proxy = v.trim(); await this.plugin.saveSettings(); }));
      }
    }
  }

  private renderModelRow(card: HTMLElement, ep: Endpoint) {
    let inputComp: any;

    const setting = new Setting(card).setName('Model').setDesc(bi('Click "Detect" to fetch the supported model list from /v1/models.', '点击 "Detect" 从 /v1/models 拉取该端点支持的模型列表。'));
    setting.addText(t => { inputComp = t; t.setValue(ep.model ?? '').onChange(async v => { ep.model = v; await this.plugin.saveSettings(); }); });
    setting.addButton(b => b.setButtonText(bi('↻ Detect', '↻ 探测')).onClick(async () => {
      if (!ep.baseUrl || !ep.apiKey) { new Notice(bi('Fill Base URL + API Key first.', '请先填写 Base URL + API Key。')); return; }
      b.setButtonText(bi('detecting…', '探测中…'));
      try {
        const epDec = await this.plugin.getDecryptedEndpoint(ep);
        if (!epDec) { b.setButtonText(bi('↻ Detect', '↻ 探测')); return; }
        const list = await new CustomApiProvider(epDec).listModels();
        if (list.length === 0) { new Notice(bi('No models returned.', '未返回模型列表。')); }
        else { ep.availableModels = list; await this.plugin.saveSettings(); new Notice(bi(`Found ${list.length} models.`, `找到 ${list.length} 个模型。`)); this.display(); }
      } catch (e: any) { new Notice(bi(`Failed: ${e.message}`, `失败：${e.message}`)); }
      finally { b.setButtonText(bi('↻ Detect', '↻ 探测')); }
    }));

    if (ep.availableModels && ep.availableModels.length > 0) {
      new Setting(card).setName(bi('Pick model', '选择模型')).addDropdown(d => {
        d.addOption('', `(${ep.availableModels!.length})`);
        for (const m of ep.availableModels!) d.addOption(m, m);
        d.setValue(ep.model && ep.availableModels!.includes(ep.model) ? ep.model : '');
        d.onChange(async v => { if (v) { ep.model = v; await this.plugin.saveSettings(); inputComp.setValue(v); } });
      });
    }

    // Reasoning effort — unified across all three endpoint kinds
    new Setting(card).setName(t('reasoning_effort'))
      .setDesc(t('reasoning_effort_desc'))
      .addDropdown(d => {
        const opts = reasoningOptionsForEndpoint(ep);
        for (const v of opts) d.addOption(v, t(`effort_${v}`));
        d.setValue(opts.includes(ep.reasoningEffort ?? 'off') ? (ep.reasoningEffort ?? 'off') : 'off');
        d.onChange(async v => { ep.reasoningEffort = v as any; await this.plugin.saveSettings(); });
      });
  }

  private renderSlashCmd(parent: HTMLElement, c: SlashCommand) {
    const card = parent.createEl('div', { cls: 'nc-endpoint-card' });
    const hdr = card.createEl('div', { cls: 'nc-endpoint-card-header' });
    hdr.createEl('span', { text: c.trigger });
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
    const card = parent.createEl('div', { cls: 'nc-endpoint-card' });
    const hdr = card.createEl('div', { cls: 'nc-endpoint-card-header' });
    hdr.createEl('span', { text: p.name || bi('Untitled', '未命名') });
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
  private draft: Partial<Endpoint> = {
    apiStyle: 'openai',
    baseUrl: '',
    model: '',
    label: 'New endpoint',
  };
  private plainKey = '';     // never stored on draft.apiKey — encrypted at save time
  private formEl: HTMLElement;
  private detectStatusEl: HTMLElement;
  private modelInput: HTMLInputElement;

  constructor(app: App, _plugin: GlossaPlugin, private onSave: (ep: Endpoint, plainKey: string) => void) {
    super(app);
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass('nc-add-modal');
    contentEl.addClass('nc-add-modal-content');
    contentEl.empty();

    const hdr = contentEl.createEl('div', { cls: 'nc-add-modal-header' });
    hdr.createEl('h2', { text: 'Add endpoint' });
    hdr.createEl('p', { text: bi('Pick a kind → click a preset to fill defaults → paste API key → Detect models → Save', '选一种类型 → 点 preset 一键填好 → 输入 API Key → Detect 拉模型列表 → Save') });

    /* Kind tabs */
    const kinds = contentEl.createEl('div', { cls: 'nc-kind-tabs' });
    const kindCards: HTMLElement[] = [];
    for (const kc of KIND_CARDS) {
      const card = kinds.createEl('div', { cls: 'nc-kind-card' });
      const title = card.createEl('div', { cls: 'nc-kind-title' });
      title.createEl('span', { text: kc.title });
      title.createEl('span', { cls: 'nc-kind-title-badge', text: kc.badge });
      card.createEl('div', { cls: 'nc-kind-desc', text: kc.desc });
      card.onclick = () => {
        this.selectedKind = kc.kind;
        kindCards.forEach(c => c.removeClass('selected'));
        card.addClass('selected');
        this.renderForm();
      };
      kindCards.push(card);
    }
    kindCards[0].addClass('selected');

    /* Presets (visible for custom-api) */
    const presetsSec = contentEl.createEl('div', { cls: 'nc-presets-section' });
    presetsSec.createEl('h3', { text: 'Quick presets' });
    const grid = presetsSec.createEl('div', { cls: 'nc-preset-grid' });
    for (const p of PRESETS) {
      const chip = grid.createEl('div', { cls: 'nc-preset-chip' });
      const dot = chip.createEl('span', { cls: 'nc-preset-dot' });
      setStyle(dot, { background: p.color });
      chip.createEl('span', { cls: 'nc-preset-name', text: p.name });
      chip.title = `${p.baseUrl} · ${p.defaultModel}`;
      chip.onclick = () => {
        this.draft.label = p.name;
        this.draft.baseUrl = p.baseUrl;
        this.draft.model = p.defaultModel;
        this.draft.apiStyle = p.apiStyle;
        this.selectedKind = 'custom-api';
        kindCards.forEach((c, i) => c.toggleClass('selected', KIND_CARDS[i].kind === 'custom-api'));
        this.renderForm();
      };
    }

    /* Form */
    this.formEl = contentEl.createEl('div', { cls: 'nc-add-form' });
    this.renderForm();
  }

  private renderForm() {
    const { formEl } = this;
    formEl.empty();

    const row = (label: string, build: (parent: HTMLElement) => void) => {
      const r = formEl.createEl('div', { cls: 'nc-add-form-row' });
      r.createEl('label', { text: label });
      const right = r.createEl('div');
      build(right);
      return r;
    };

    row('Label', (p) => {
      const inp = p.createEl('input', { type: 'text', value: this.draft.label ?? '' });
      inp.oninput = () => { this.draft.label = inp.value; };
    });

    if (this.selectedKind === 'custom-api') {
      row('API style', (p) => {
        const sel = p.createEl('select');
        sel.createEl('option', { value: 'openai', text: 'OpenAI-compatible' });
        sel.createEl('option', { value: 'anthropic', text: 'Anthropic-style' });
        sel.value = this.draft.apiStyle ?? 'openai';
        sel.onchange = () => { this.draft.apiStyle = sel.value as any; };
      });
      row('Base URL', (p) => {
        const inp = p.createEl('input', { type: 'text', value: this.draft.baseUrl ?? '' });
        inp.placeholder = HTTPS_API_PLACEHOLDER;
        inp.oninput = () => { this.draft.baseUrl = inp.value; };
      });
      row('API Key', (p) => {
        const inp = p.createEl('input', { type: 'password', value: this.plainKey });
        inp.placeholder = API_KEY_PLACEHOLDER;
        inp.oninput = () => { this.plainKey = inp.value; };
      });
      row('Model', (p) => {
        const wrap = p.createEl('div', { cls: 'nc-row-with-btn' });
        this.modelInput = wrap.createEl('input', { type: 'text', value: this.draft.model ?? '' });
        this.modelInput.placeholder = ['e.g. ', 'deepseek-chat'].join('');
        this.modelInput.oninput = () => { this.draft.model = this.modelInput.value; };
        const btn = wrap.createEl('button', { text: DETECT_BUTTON_LABEL });
        btn.onclick = () => this.detectModels(btn);
      });
      this.detectStatusEl = formEl.createEl('div', { cls: 'nc-detect-status' });
    }

    if (this.selectedKind === 'codex-cli' || this.selectedKind === 'claude-code-cli') {
      const warn = localCliWarning(this.selectedKind);
      if (warn) renderWarningHint(formEl, warn);
      const binName = this.selectedKind === 'codex-cli' ? 'codex' : 'claude';
      row('Binary', (p) => {
        const wrap = p.createEl('div', { cls: 'nc-row-with-btn' });
        const inp = wrap.createEl('input', { type: 'text', value: (this.draft as any).binaryPath ?? '' });
        inp.placeholder = `/path/to/${binName}`;
        inp.oninput = () => { (this.draft as any).binaryPath = inp.value; };
        const btn = wrap.createEl('button', { text: 'Auto' });
        btn.onclick = () => {
          const r = resolveBinary(binName);
          if (r) { inp.value = r; (this.draft as any).binaryPath = r; new Notice(`Found ${r}`); }
          else new Notice(`Not found. Install ${binName}.`);
        };
      });
      row('Default model', (p) => {
        const inp = p.createEl('input', { type: 'text', value: this.draft.model ?? '' });
        inp.placeholder = this.selectedKind === 'codex-cli'
          ? 'leave empty → uses ~/.codex/config.toml'
          : 'leave empty → uses claude default (sonnet)';
        inp.oninput = () => { this.draft.model = inp.value; };
      });
    }

    const actions = formEl.createEl('div', { cls: 'nc-add-form-actions' });
    const cancel = actions.createEl('button', { text: 'Cancel' });
    cancel.onclick = () => this.close();
    const save = actions.createEl('button', { text: 'Save', cls: 'mod-cta' });
    save.onclick = () => this.save();
  }

  private async detectModels(btn: HTMLButtonElement) {
    if (!this.draft.baseUrl || !this.plainKey) {
      this.detectStatusEl.setText('Need base URL + API key first.');
      return;
    }
    const baseUrl = this.validBaseUrl(this.draft.baseUrl);
    if (!baseUrl) {
      this.detectStatusEl.setText('Base URL must be HTTP(s).');
      return;
    }
    this.detectStatusEl.setText('Detecting…');
    btn.textContent = 'Detecting…';
    // Use plaintext key directly for detection — never persisted from this temp ep.
    const ep: Endpoint = {
      id: 'tmp', kind: 'custom-api',
      label: this.draft.label ?? '', baseUrl, apiKey: this.plainKey,
      apiStyle: this.draft.apiStyle ?? 'openai',
    };
    try {
      const list = await new CustomApiProvider(ep).listModels();
      btn.textContent = DETECT_BUTTON_LABEL;
      if (list.length === 0) { this.detectStatusEl.setText('No models returned (endpoint /models 404 or empty).'); return; }
      this.detectStatusEl.setText(`Found ${list.length} models. Pick one:`);
      // Replace model input with dropdown
      const oldRow = this.modelInput.closest('.nc-add-form-row') as HTMLElement;
      if (oldRow) {
        const right = oldRow.querySelector('div') as HTMLElement;
        right.empty();
        const sel = right.createEl('select');
        setStyle(sel, { flex: '1' });
        for (const m of list) sel.createEl('option', { value: m, text: m });
        const cur = this.draft.model;
        sel.value = cur && list.includes(cur) ? cur : list[0];
        this.draft.model = sel.value;
        sel.onchange = () => { this.draft.model = sel.value; };
      }
    } catch (e: any) {
      btn.textContent = DETECT_BUTTON_LABEL;
      this.detectStatusEl.setText(`Failed: ${e.message}`);
    }
  }

  private save() {
    if (this.selectedKind === 'custom-api' && (!this.draft.baseUrl || !this.plainKey)) {
      new Notice('Need base URL + API key.'); return;
    }
    if (this.selectedKind === 'custom-api') {
      const baseUrl = this.validBaseUrl(this.draft.baseUrl);
      if (!baseUrl) { new Notice('Base URL must be HTTP(s).'); return; }
      this.draft.baseUrl = baseUrl;
    }
    const ep: Endpoint = {
      id: uid(),
      kind: this.selectedKind,
      label: this.draft.label || 'New endpoint',
      ...this.draft,
      apiKey: '',          // populated by storeApiKey() in caller
      proxyMode: 'global',
    } as Endpoint;
    if (ep.kind === 'claude-code-cli' && !ep.maxTurns) ep.maxTurns = 1;
    if (ep.kind === 'claude-code-cli' && ep.bareMode == null) ep.bareMode = true;
    const warn = localCliWarning(ep.kind) ?? codexSafetyWarning(ep);
    if (warn) new Notice(`Warning: ${warn}`, 10000);
    this.onSave(ep, this.plainKey);
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
   MCP marketplace modal — one-click install of curated servers
   ============================================================ */
interface McpExternalEntry extends McpEntry { __source: string; }

class McpMarketplaceModal extends Modal {
  private filter: McpEntry['category'] | 'all' = 'all';
  private query = '';
  private listEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private external: McpExternalEntry[] = [];   // entries fetched from user catalog URLs (this session)

  constructor(private plugin: GlossaPlugin, private onChange: () => void) {
    super(plugin.app);
  }

  async onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass('nc-mcp-marketplace-modal');
    contentEl.empty();
    contentEl.createEl('h2', { text: `${MCP_LABEL} marketplace` });
    contentEl.createEl('p', {
      cls: 'setting-item-description',
      text: `Curated ${MCP_LABEL} servers. Clicking install adds the entry to your config (disabled by default — fill in any required arg / env, then enable).`,
    });

    /* Filter chips + search + URL controls */
    const bar = contentEl.createEl('div', { cls: 'nc-mcp-bar' });
    const chip = (label: string, value: McpEntry['category'] | 'all') => {
      const b = bar.createEl('button', { text: label, cls: 'nc-mcp-chip' + (this.filter === value ? ' active' : '') });
      b.onclick = () => { this.filter = value; this.rerenderChips(); this.render(); };
      return b;
    };
    chip('All', 'all');
    for (const c of MCP_CATEGORIES) chip(c.label, c.id);
    const search = bar.createEl('input', { attr: { placeholder: 'Search…', type: 'text' }, cls: 'nc-mcp-search' });
    search.oninput = () => { this.query = (search.value || '').toLowerCase(); this.render(); };
    const importBtn = bar.createEl('button', { text: IMPORT_URL_BUTTON_LABEL, cls: 'nc-mcp-import-btn' });
    importBtn.onclick = () => this.promptImport();

    /* Saved URLs row */
    const urlsBar = contentEl.createEl('div', { cls: 'nc-mcp-urls' });
    this.renderUrlsBar(urlsBar);

    this.statusEl = contentEl.createEl('div', { cls: 'nc-mcp-status' });
    this.listEl = contentEl.createEl('div', { cls: 'nc-mcp-list' });
    this.render();

    // Auto-load any saved catalog URLs in the background
    this.loadSavedUrls();
  }

  private rerenderChips() {
    // Cheap: rebuild header rather than tracking individual chip elements
    const { contentEl } = this;
    const oldBar = contentEl.querySelector('.nc-mcp-bar');
    const oldUrls = contentEl.querySelector('.nc-mcp-urls');
    if (oldBar) oldBar.remove();
    if (oldUrls) oldUrls.remove();
    const h2 = contentEl.querySelector('h2');
    const p  = contentEl.querySelector('p.setting-item-description');
    const after = (p ?? h2)?.nextSibling ?? null;
    // Build a fresh bar and insert it after the header text
    const bar = contentEl.createEl('div', { cls: 'nc-mcp-bar' });
    contentEl.insertBefore(bar, after);
    const chip = (label: string, value: McpEntry['category'] | 'all') => {
      const b = bar.createEl('button', { text: label, cls: 'nc-mcp-chip' + (this.filter === value ? ' active' : '') });
      b.onclick = () => { this.filter = value; this.rerenderChips(); this.render(); };
    };
    chip('All', 'all');
    for (const c of MCP_CATEGORIES) chip(c.label, c.id);
    const search = bar.createEl('input', { attr: { placeholder: 'Search…', type: 'text', value: this.query }, cls: 'nc-mcp-search' });
    search.oninput = () => { this.query = (search.value || '').toLowerCase(); this.render(); };
    const importBtn = bar.createEl('button', { text: IMPORT_URL_BUTTON_LABEL, cls: 'nc-mcp-import-btn' });
    importBtn.onclick = () => this.promptImport();

    const urlsBar = contentEl.createEl('div', { cls: 'nc-mcp-urls' });
    contentEl.insertBefore(urlsBar, this.statusEl);
    this.renderUrlsBar(urlsBar);
  }

  private renderUrlsBar(host: HTMLElement) {
    host.empty();
    const urls = this.plugin.settings.mcpCatalogUrls ?? [];
    if (urls.length === 0) return;
    host.createEl('span', { text: 'Catalogs:', cls: 'nc-mcp-urls-label' });
    for (const u of urls) {
      const chip = host.createEl('span', { cls: 'nc-mcp-url-chip' });
      const short = u.length > 50 ? u.slice(0, 24) + '…' + u.slice(-20) : u;
      chip.createEl('span', { text: short, title: u });
      const remove = chip.createEl('button', { text: '✕', title: 'Remove' });
      remove.onclick = async () => {
        this.plugin.settings.mcpCatalogUrls = this.plugin.settings.mcpCatalogUrls.filter(x => x !== u);
        this.external = this.external.filter(e => e.__source !== u);
        await this.plugin.saveSettings();
        this.rerenderChips();
        this.render();
      };
    }
  }

  private async loadSavedUrls() {
    const urls = this.plugin.settings.mcpCatalogUrls ?? [];
    if (urls.length === 0) return;
    this.statusEl.setText(`Loading ${urls.length} catalog${urls.length === 1 ? '' : 's'}…`);
    const merged: McpExternalEntry[] = [];
    const errors: string[] = [];
    for (const u of urls) {
      try {
        const entries = await fetchCatalog(u);
        for (const e of entries) merged.push({ ...e, __source: u });
      } catch (e: any) {
        errors.push(`${u}: ${e.message}`);
      }
    }
    this.external = merged;
    this.statusEl.setText(errors.length
      ? `Loaded ${merged.length} external entries · ${errors.length} failed`
      : `Loaded ${merged.length} external entries`);
    if (errors.length) this.statusEl.title = errors.join('\n');
    this.render();
  }

  private async promptImport() {
    const url = await this.askUrl();
    if (!url) return;
    this.statusEl.setText('Fetching…');
    try {
      const entries = await fetchCatalog(url);
      // Persist URL (dedupe)
      const urls = new Set(this.plugin.settings.mcpCatalogUrls ?? []);
      urls.add(url);
      this.plugin.settings.mcpCatalogUrls = [...urls];
      await this.plugin.saveSettings();
      // Merge into session catalog
      this.external = this.external.filter(e => e.__source !== url);
      for (const e of entries) this.external.push({ ...e, __source: url });
      this.statusEl.setText(`Imported ${entries.length} entries from ${url}`);
      this.rerenderChips();
      this.render();
    } catch (e: any) {
      this.statusEl.setText(`Import failed: ${e.message}`);
    }
  }

  private askUrl(): Promise<string | null> {
    return new Promise(resolve => {
      const modal = new (class extends Modal {
        url = '';
        constructor(app: App) { super(app); }
        onOpen() {
          this.contentEl.createEl('h3', { text: `Import ${MCP_LABEL} catalog` });
          this.contentEl.createEl('p', { cls: 'setting-item-description',
            text: `Paste a URL that returns a JSON array of ${MCP_LABEL} entries. Common locations: raw.githubusercontent.com or a public gist.` });
          const input = this.contentEl.createEl('input', { attr: { placeholder: HTTPS_URL_PLACEHOLDER, type: 'url' } });
          setStyle(input, { width: '100%' });
          setStyle(input, { padding: '6px 10px' });
          setStyle(input, { marginTop: '8px' });
          input.oninput = () => { this.url = input.value.trim(); };
          const actions = this.contentEl.createEl('div', { cls: 'modal-button-container' });
          setStyle(actions, { display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '12px' });
          const cancel = actions.createEl('button', { text: 'Cancel' });
          cancel.onclick = () => { resolve(null); this.close(); };
          const ok = actions.createEl('button', { text: 'Import', cls: 'mod-cta' });
          ok.onclick = () => { resolve(this.url || null); this.close(); };
          input.focus();
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { resolve(this.url || null); this.close(); }
            else if (e.key === 'Escape') { resolve(null); this.close(); }
          });
        }
      })(this.plugin.app);
      modal.open();
    });
  }

  private render() {
    if (!this.listEl) return;
    this.listEl.empty();
    const installedIds = new Set(this.plugin.settings.mcpServers.map(s => s.name));
    type Row = McpEntry & { __source?: string };
    const combined: Row[] = [
      ...MCP_CATALOG.map(e => ({ ...e })),
      ...this.external.map(e => ({ ...e })),
    ];
    const filtered = combined.filter(e =>
      (this.filter === 'all' || e.category === this.filter) &&
      (!this.query || e.name.toLowerCase().includes(this.query) || e.description.toLowerCase().includes(this.query))
    );
    if (filtered.length === 0) {
      this.listEl.createEl('div', { cls: 'nc-mcp-empty', text: 'No matches.' });
      return;
    }
    for (const entry of filtered) {
      const row = this.listEl.createEl('div', { cls: 'nc-mcp-row' });
      const left = row.createEl('div', { cls: 'nc-mcp-left' });
      const top = left.createEl('div', { cls: 'nc-mcp-row-top' });
      top.createEl('span', { cls: 'nc-mcp-name', text: entry.name });
      top.createEl('span', { cls: 'nc-mcp-cat', text: entry.category });
      if ((entry as Row).__source) top.createEl('span', { cls: 'nc-mcp-cat nc-mcp-cat-ext', text: 'Custom' });
      left.createEl('div', { cls: 'nc-mcp-desc', text: entry.description });
      const cmd = `${entry.install.command} ${entry.install.args.join(' ')}`;
      left.createEl('code', { cls: 'nc-mcp-cmd', text: cmd });
      const hints: string[] = [];
      if (entry.envHints?.length) hints.push('env: ' + entry.envHints.map(h => h.name).join(', '));
      if (entry.argHints?.length) hints.push('args: ' + entry.argHints.map(h => h.placeholder).join(', '));
      if (hints.length) left.createEl('div', { cls: 'nc-mcp-hints', text: hints.join(' · ') });

      const right = row.createEl('div', { cls: 'nc-mcp-right' });
      const isInstalled = installedIds.has(entry.id);
      const installBtn = right.createEl('button', { text: isInstalled ? 'Installed' : 'Install', cls: 'mod-cta' });
      if (isInstalled) installBtn.disabled = true;
      installBtn.onclick = async () => {
        // Catalog entries are JSON authored by THIRD PARTIES. The command
        // and args they ship become real shell spawn arguments. Without a
        // confirmation gate, importing a malicious catalog → one-click
        // install = spawn('rm', ['-rf', '$HOME']).
        //
        // Defense: surface the exact command + args + cwd to the user
        // before we persist anything. The entry is still saved as DISABLED
        // by default (a second click is needed to actually run it), but
        // showing the command at install time means a malicious entry
        // can't hide behind a friendly name.
        const cmdLine = `${entry.install.command} ${entry.install.args.join(' ')}`.trim();
        const { confirmModal } = await import('./ui/confirm_modal');
        const ok = await confirmModal(this.plugin.app, {
          title: `Install MCP server "${entry.name}"?`,
          body:
            `This will save the following spawn definition to your settings (disabled by default — you must enable it manually before it runs):\n\n` +
            `  command: ${entry.install.command}\n` +
            `  args:    ${JSON.stringify(entry.install.args)}\n` +
            (entry.envHints?.length ? `  env:     ${entry.envHints.map(h => h.name).join(', ')}\n` : '') +
            `\nFull command line: ${cmdLine.slice(0, 300)}\n\n` +
            `Only install entries from catalogs you trust.`,
          confirmText: 'Install (disabled)',
          danger: true,
        });
        if (!ok) return;

        const env: Record<string, string> = {};
        for (const h of entry.envHints ?? []) env[h.name] = '';
        this.plugin.settings.mcpServers.push({
          id: uid(),
          name: entry.id,
          command: entry.install.command,
          args: entry.install.args.slice(),
          enabled: false,
          env: Object.keys(env).length ? env : undefined,
        });
        await this.plugin.saveSettings();
        installBtn.textContent = 'Installed';
        installBtn.disabled = true;
        new Notice(`Added "${entry.name}" — disabled by default. Edit args/env, then enable.`);
        this.onChange();
      };
      if (entry.homepage) {
        const docs = right.createEl('a', { text: 'Docs', href: entry.homepage });
        docs.setAttr('target', '_blank');
        docs.setAttr('rel', 'noopener');
      }
    }
  }
}

/* ============================================================
   Codex diagnostic modal — full transcript of the test run
   ============================================================ */
class CodexDiagnosticModal extends Modal {
  constructor(app: App, private result: any) { super(app); }

  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass('nc-codex-diag-modal');
    contentEl.empty();
    contentEl.createEl('h2', { text: 'Codex CLI diagnostic' });
    const r = this.result;

    // Verdict block at the top
    const verdict = contentEl.createEl('div', { cls: 'nc-codex-diag-verdict' });
    verdict.textContent = r.diagnosis;
    if (r.diagnosis.startsWith('✅')) verdict.addClass('ok');
    else if (r.diagnosis.startsWith('⚠'))  verdict.addClass('warn');
    else verdict.addClass('fail');

    // Summary table
    const summary = contentEl.createEl('div', { cls: 'nc-codex-diag-summary' });
    const row = (k: string, v: string) => {
      const r1 = summary.createEl('div', { cls: 'nc-codex-diag-row' });
      r1.createEl('span', { text: k, cls: 'nc-codex-diag-k' });
      r1.createEl('span', { text: v, cls: 'nc-codex-diag-v' });
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
      const tl = contentEl.createEl('div', { cls: 'nc-codex-diag-timeline' });
      for (const ev of r.eventTimeline) {
        const row = tl.createEl('div', { cls: 'nc-codex-diag-tl-row' });
        row.createEl('span', { cls: 'nc-codex-diag-tl-time', text: `+${(ev.at / 1000).toFixed(2)}s` });
        row.createEl('span', { cls: 'nc-codex-diag-tl-type', text: ev.type });
        if (ev.payload) row.createEl('span', { cls: 'nc-codex-diag-tl-payload', text: ev.payload });
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

    const footer = contentEl.createEl('div', { cls: 'modal-button-container' });
    setStyle(footer, { display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '12px' });
    footer.createEl('button', { text: 'Copy all', cls: 'mod-cta' }).onclick = () => {
      const mIdx = r.args.indexOf('-m');
      const modelArg = mIdx >= 0 ? r.args[mIdx + 1] : '(none — uses ~/.codex/config.toml)';
      const all = [
        `# Codex CLI diagnostic`,
        `Verdict: ${r.diagnosis}`,
        `Version: ${r.version.message}`,
        `cwd: ${r.cwd}`,
        `exit: ${r.exitCode}`,
        `duration: ${r.durationMs}ms`,
        `Model arg: ${modelArg}`,
        `PATH: ${r.env.PATH}`,
        `OPENAI_API_KEY: ${r.env.OPENAI_API_KEY ?? '(not set)'}`,
        `Proxy source: ${r.env.proxySource ?? 'none'}`,
        `Shell-captured HTTPS_PROXY: ${r.env.shellProxyHTTPS ?? '(not captured)'}`,
        `Shell-captured HTTP_PROXY: ${r.env.shellProxyHTTP ?? '(not captured)'}`,
        `Effective HTTPS_PROXY: ${r.env.HTTPS_PROXY ?? '(not set)'}`,
        `Effective HTTP_PROXY: ${r.env.HTTP_PROXY ?? '(not set)'}`,
        `Effective ALL_PROXY: ${r.env.ALL_PROXY ?? '(not set)'}`,
        `Effective NO_PROXY: ${r.env.NO_PROXY ?? '(not set)'}`,
        ``,
        `## Command`,
        `codex ${r.args.join(' ')}`,
        ``,
        `## Parsed reply`,
        r.parsedText || '(none)',
        ``,
        `## stdout`,
        r.stdout,
        ``,
        `## stderr`,
        r.stderr,
      ].join('\n');
      navigator.clipboard.writeText(all);
      new Notice('Diagnostic copied to clipboard.');
    };
    // Quick-fix button when no proxy was detected.
    const haveProxy = !!(r.env.HTTPS_PROXY || r.env.HTTP_PROXY || r.env.ALL_PROXY);
    if (!haveProxy && /Reconnect|timeout|network|connection|tls|dns/i.test(r.diagnosis)) {
      footer.createEl('button', { text: 'Open proxy settings', cls: 'mod-warning' }).onclick = () => {
        this.close();
        // Defer-and-scroll: re-open settings, then scroll the proxy input into view.
        window.setTimeout(() => {
          (this.app as any).setting.open();
          (this.app as any).setting.openTabById('glossa');
          window.setTimeout(() => {
            // Find by stable data-glossa-id, NOT by label text. The label was
            // renamed multiple times (Global proxy URL → Proxy → 代理) and
            // every rename broke this scroll-to-field jump.
            const target = activeDocument.querySelector('[data-glossa-id="global-proxy"]') as HTMLElement | null;
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
