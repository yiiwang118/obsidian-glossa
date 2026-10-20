import { REASONING_EFFORT_OPTIONS, type CliModelInfo, type Endpoint, type ReasoningEffort } from '../types';
import { bi, t } from '../utils/i18n';

/** First-party APIs whose reasoning controls are documented per model. Any
 *  other host (gateways, resellers, local servers) is treated as third party:
 *  every value is offered and sent unchanged. */
export type OfficialProvider = 'openai' | 'anthropic' | 'deepseek' | 'qwen' | 'glm' | 'kimi' | 'minimax' | 'doubao' | 'mimo' | 'gemini' | 'xai';

/** What choosing an entry sends. */
export type ReasoningEntryKind =
  /** Nothing: the provider's own default. */
  | 'omit'
  /** Switch reasoning off with the provider's documented switch. */
  | 'disable'
  /** Switch reasoning on without an effort value. */
  | 'enable'
  /** A documented effort value. */
  | 'level';

export interface ReasoningEntry {
  /** Stored in `Endpoint.reasoningEffort`. */
  value: ReasoningEffort;
  kind: ReasoningEntryKind;
  label: string;
  /** Short form for the composer pill. */
  short: string;
  isDefault?: boolean;
}

export interface AnthropicThinking {
  /** adaptive: thinking + output_config.effort; budget: thinking.budget_tokens; none: no reasoning. */
  style: 'adaptive' | 'budget' | 'none';
  /** The model thinks when the request sends no thinking setting. */
  thinksByDefault: boolean;
  /** How the model's thinking is switched off, when it can be. */
  disable?: 'disabled' | 'between_tools';
  /** `display: "summarized"` is needed for reasoning text to stream. */
  summarized: boolean;
  /** Also send output_config.effort with a thinking budget (Claude Opus 4.5). */
  budgetEffort?: boolean;
}

export interface ReasoningProfile {
  provider: OfficialProvider | null;
  /** The model matched a documented rule. */
  known: boolean;
  entries: ReasoningEntry[];
  /** Offer free-form effort input. */
  allowCustom: boolean;
  /** Why the control is unavailable, when there is nothing to choose. */
  note?: string;
  /** No setting exists because the model always reasons. */
  alwaysThinks?: boolean;
  /** Provider-documented remapping of values outside `entries`. */
  aliases?: Partial<Record<ReasoningEffort, ReasoningEffort>>;
  /** CLI without a chosen model: its own configuration decides the model, so
   *  its efforts are unknown until a model is picked. */
  needsModel?: boolean;
  anthropic?: AnthropicThinking;
}

const ORDER: ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const SHORT: Record<ReasoningEffort, string> = {
  off: '·', none: '0', minimal: 'MIN', low: 'L', medium: 'M', high: 'H', xhigh: 'X', max: 'MAX', ultra: 'U',
};
const ALL_LEVELS: ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

function defaultSuffix(isDefault?: boolean): string {
  return isDefault ? bi(' (default)', '（默认）') : '';
}

function level(value: ReasoningEffort, defaultValue?: ReasoningEffort): ReasoningEntry {
  const isDefault = value === defaultValue;
  const label = value === 'none' ? bi('none · no reasoning', 'none（不推理）') : value;
  return { value, kind: 'level', label: label + defaultSuffix(isDefault), short: SHORT[value], isDefault };
}

function levels(values: ReasoningEffort[], defaultValue?: ReasoningEffort): ReasoningEntry[] {
  return values.map(value => level(value, defaultValue));
}

function disable(value: ReasoningEffort, isDefault = false, label = bi('Thinking off', '关闭思考')): ReasoningEntry {
  return { value, kind: 'disable', label: label + defaultSuffix(isDefault), short: bi('Off', '关'), isDefault };
}

function enable(isDefault = false): ReasoningEntry {
  return { value: 'high', kind: 'enable', label: bi('Thinking on', '开启思考') + defaultSuffix(isDefault), short: bi('On', '开'), isDefault };
}

function omit(label = bi('Default', '默认'), short = '·'): ReasoningEntry {
  return { value: 'off', kind: 'omit', label, short };
}

/** A switch for models that only turn thinking on or off. */
function toggle(onByDefault: boolean): ReasoningEntry[] {
  return [disable('none', !onByDefault), enable(onByDefault)];
}

function fixed(note: string, alwaysThinks = false): Omit<ReasoningProfile, 'provider'> {
  return { known: true, entries: [], allowCustom: false, note, alwaysThinks };
}

const ALWAYS_THINKS = () => fixed(bi('This model always thinks; its depth is not adjustable.', '该模型始终思考，不能调整强度。'), true);
const NO_REASONING = () => fixed(bi('This model does not reason, so there is nothing to adjust.', '该模型不支持思考，无需设置。'));

function known(entries: ReasoningEntry[]): Omit<ReasoningProfile, 'provider'> {
  return { known: true, entries, allowCustom: false };
}

/** Recognise first-party API hosts. Anthropic counts only with its Messages
 *  format; other vendors only with their OpenAI-compatible format. */
export function officialProvider(ep: Pick<Endpoint, 'kind' | 'baseUrl' | 'apiStyle'> | null | undefined): OfficialProvider | null {
  if (!ep || ep.kind !== 'custom-api' || !ep.baseUrl) return null;
  let host = '';
  try { host = new URL(ep.baseUrl.trim()).hostname.toLowerCase(); } catch { return null; }
  const style = ep.apiStyle ?? 'openai';
  if (host === 'api.anthropic.com') return style === 'anthropic' ? 'anthropic' : null;
  if (style !== 'openai') return null;
  if (host === 'api.openai.com') return 'openai';
  if (host === 'api.deepseek.com') return 'deepseek';
  if (/^dashscope(?:-intl|-us)?\.aliyuncs\.com$/.test(host)) return 'qwen';
  if (host === 'open.bigmodel.cn' || host === 'api.z.ai') return 'glm';
  if (host === 'api.moonshot.cn' || host === 'api.moonshot.ai') return 'kimi';
  if (/^api\.minimaxi?\.(?:io|com|chat)$/.test(host)) return 'minimax';
  if (/^ark\.[a-z0-9-]+\.(?:volces|bytepluses)\.com$/.test(host)) return 'doubao';
  if (/(?:^|\.)xiaomimimo\.com$/.test(host)) return 'mimo';
  if (host === 'generativelanguage.googleapis.com') return 'gemini';
  if (host === 'api.x.ai') return 'xai';
  return null;
}

function modelId(ep: Pick<Endpoint, 'model'>): string {
  return (ep.model ?? '').trim().toLowerCase().replace(/^models\//, '');
}

/* ---------------- Per-provider rules (official documentation, 2026-10) ---------------- */

const DATE = '(?:-\\d{4}-\\d{2}-\\d{2})?$';

function openaiRule(id: string): Omit<ReasoningProfile, 'provider'> | null {
  if (!id) return null;
  if (/^(?:gpt-4|gpt-3\.5|chatgpt-)/.test(id) || /-chat(?:-latest)?$/.test(id) || /^gpt-5(?:\.\d+)?-chat/.test(id)) return NO_REASONING();
  if (/^o1-(?:mini|preview)/.test(id)) return ALWAYS_THINKS();
  if (new RegExp(`^gpt-6\\.1-sol${DATE}`).test(id)) return known(levels(ALL_LEVELS, 'medium'));
  if (new RegExp(`^gpt-6-astra${DATE}`).test(id)) return known([omit(), ...levels(ALL_LEVELS)]);
  if (new RegExp(`^gpt-6-(?:sol|luna)${DATE}`).test(id)) return known(levels(['none', ...ALL_LEVELS], 'medium'));
  if (new RegExp(`^gpt-5\\.6(?:-terra|-luna|-sol)?${DATE}`).test(id)) return known(levels(['none', ...ALL_LEVELS], 'medium'));
  if (new RegExp(`^gpt-5\\.5${DATE}`).test(id)) return known(levels(['none', 'low', 'medium', 'high', 'xhigh'], 'medium'));
  if (new RegExp(`^gpt-5\\.[42]${DATE}`).test(id)) return known(levels(['none', 'low', 'medium', 'high', 'xhigh'], 'none'));
  if (new RegExp(`^gpt-5\\.1${DATE}`).test(id)) return known(levels(['none', 'low', 'medium', 'high'], 'none'));
  if (new RegExp(`^gpt-5(?:-mini|-nano)?${DATE}`).test(id)) return known(levels(['minimal', 'low', 'medium', 'high'], 'medium'));
  if (new RegExp(`^o(?:1|3|4-mini|3-mini)${DATE}`).test(id)) return known(levels(['low', 'medium', 'high'], 'medium'));
  return null;
}

function anthropicRule(id: string): (Omit<ReasoningProfile, 'provider'> & { anthropic: AnthropicThinking }) | null {
  if (!id) return null;
  const adaptive = (thinking: Omit<AnthropicThinking, 'style'>, entries: ReasoningEntry[]) =>
    ({ ...known(entries), anthropic: { style: 'adaptive' as const, ...thinking } });
  if (/claude-(?:fable|mythos)-5/.test(id)) return adaptive({ thinksByDefault: true, summarized: true }, levels(ALL_LEVELS, 'high'));
  if (/claude-opus-5-5/.test(id)) return adaptive({ thinksByDefault: true, summarized: true }, levels(ALL_LEVELS, 'medium'));
  if (/claude-opus-5\b/.test(id)) return adaptive({ thinksByDefault: true, summarized: true, disable: 'disabled' }, [disable('none'), ...levels(ALL_LEVELS, 'high')]);
  if (/claude-sonnet-5-5/.test(id)) return adaptive({ thinksByDefault: true, summarized: true, disable: 'between_tools' }, [disable('none'), ...levels(ALL_LEVELS, 'high')]);
  if (/claude-sonnet-5\b/.test(id)) return adaptive({ thinksByDefault: true, summarized: true, disable: 'disabled' }, [disable('none'), ...levels(ALL_LEVELS, 'high')]);
  if (/claude-haiku-5-5/.test(id)) return adaptive({ thinksByDefault: true, summarized: true, disable: 'disabled' }, [disable('none'), ...levels(ALL_LEVELS, 'medium')]);
  const noThinking = { ...omit(bi('No thinking (default)', '不思考（默认）'), bi('Off', '关')), isDefault: true };
  if (/claude-opus-4-[78]/.test(id)) return adaptive({ thinksByDefault: false, summarized: true }, [noThinking, ...levels(ALL_LEVELS)]);
  if (/claude-(?:opus|sonnet)-4-6/.test(id)) {
    // xhigh arrived with Opus 4.7; on 4.6 it means high.
    return { ...adaptive({ thinksByDefault: false, summarized: false }, [noThinking, ...levels(['low', 'medium', 'high', 'max'])]), aliases: { xhigh: 'high' } };
  }
  if (/claude-opus-4-5/.test(id)) {
    return { ...known([noThinking, ...levels(['low', 'medium', 'high'])]), anthropic: { style: 'budget', thinksByDefault: false, summarized: false, budgetEffort: true } };
  }
  if (/claude-(?:sonnet-4-5|haiku-4-5|opus-4-1|3-7-sonnet)/.test(id) || /claude-(?:opus|sonnet)-4(?:-\d{8})?$/.test(id)) {
    return { ...known([noThinking, ...levels(['low', 'medium', 'high'])]), anthropic: { style: 'budget', thinksByDefault: false, summarized: false } };
  }
  if (/claude-3/.test(id)) return { ...NO_REASONING(), anthropic: { style: 'none', thinksByDefault: false, summarized: false } };
  return null;
}

function deepseekRule(id: string): Omit<ReasoningProfile, 'provider'> {
  // deepseek-flash / deepseek-v4-pro: thinking on by default at "high";
  // low / high / max are distinct, other names are server-side aliases.
  // `off` keeps its earlier meaning for DeepSeek: thinking switched off.
  void id;
  return { ...known([disable('off'), ...levels(['low', 'high', 'max'], 'high')]), aliases: { none: 'off', minimal: 'low', medium: 'high', xhigh: 'high', ultra: 'max' } };
}

function qwenRule(id: string): Omit<ReasoningProfile, 'provider'> | null {
  if (!/^(?:qwen|qwq|qvq)/.test(id)) return null;
  if (/^(?:qwq|qvq)|-thinking(?:-|$)|^qwen3\.8-2\.4t|^qwen3\.7-max-(?:preview|2026-05-17)/.test(id)) return ALWAYS_THINKS();
  if (/-instruct(?:-|$)/.test(id)) return NO_REASONING();
  if (/^qwen3\.[5-9]/.test(id)) return known(toggle(true));
  if (/^qwen-(?:plus|flash|turbo)(?:-latest|-\d{4}-\d{2}-\d{2})?$/.test(id)) return known(toggle(false));
  if (/^qwen3-\d/.test(id)) return known(toggle(true));
  return null;
}

function glmRule(id: string): Omit<ReasoningProfile, 'provider'> | null {
  if (/^glm-5\.3/.test(id)) return known(levels(['low', 'high', 'max'], 'max'));
  if (/^glm-5\.2/.test(id)) return known([disable('none'), ...levels(['high', 'max'], 'max')]);
  if (/^glm-(?:5(?:\.1)?|5-turbo|4\.[5-7])(?:$|-)/.test(id)) return known(toggle(true));
  if (/^glm-z1/.test(id)) return ALWAYS_THINKS();
  if (/^glm-4(?:-|v|$)/.test(id)) return NO_REASONING();
  return null;
}

function kimiRule(id: string): Omit<ReasoningProfile, 'provider'> | null {
  if (/^kimi-k3/.test(id)) return known(levels(['low', 'high', 'max'], 'max'));
  if (/^kimi-k2\.7-code/.test(id) || /^kimi-k2-thinking/.test(id)) return ALWAYS_THINKS();
  if (/^kimi-k2\.[56]/.test(id)) return known(toggle(true));
  if (/^(?:kimi-k2-|moonshot-v1)/.test(id)) return NO_REASONING();
  return null;
}

function minimaxRule(id: string): Omit<ReasoningProfile, 'provider'> | null {
  if (/^minimax-m3\.1-flash/.test(id)) return known(levels(ALL_LEVELS, 'max'));
  if (/^minimax-m3(?:$|-)/.test(id)) return known(toggle(true));
  if (/^minimax-m2/.test(id)) return ALWAYS_THINKS();
  if (/^(?:abab|minimax-text)/.test(id)) return NO_REASONING();
  return null;
}

function doubaoRule(id: string): Omit<ReasoningProfile, 'provider'> | null {
  const noThought = disable('minimal', false, bi('minimal · no thinking', 'minimal（不思考）'));
  if (/^doubao-seed-(?:2-1|evolving)/.test(id)) return known([noThought, ...levels(['low', 'medium', 'high'], 'high')]);
  if (/^doubao-seed-(?:2-0|character)/.test(id)) return known([noThought, ...levels(['low', 'medium', 'high'], 'medium')]);
  if (/^doubao-seed-1-[68]/.test(id)) return known([omit(), noThought, ...levels(['low', 'medium', 'high'])]);
  return null;
}

function mimoRule(id: string): Omit<ReasoningProfile, 'provider'> | null {
  if (/^mimo-v2(?:\.\d+)?(?:-|$)/.test(id)) return known(toggle(true));
  return null;
}

function geminiRule(id: string): Omit<ReasoningProfile, 'provider'> | null {
  if (/^gemini-2\.5-pro/.test(id)) return known([omit(bi('Dynamic (default)', '自动（默认）')), ...levels(['low', 'medium', 'high'])]);
  if (/^gemini-2\.5-flash/.test(id)) return known([omit(bi('Dynamic (default)', '自动（默认）')), disable('none'), ...levels(['low', 'medium', 'high'])]);
  if (/^gemini-3(?:\.[0-6])?-flash/.test(id)) return known(levels(['minimal', 'low', 'medium', 'high'], 'high'));
  if (/^gemini-(?:3\.\d+|[4-9](?:\.\d+)?)-/.test(id) || /^gemini-3-pro/.test(id)) return known(levels(['low', 'medium', 'high'], 'high'));
  return null;
}

function xaiRule(id: string): Omit<ReasoningProfile, 'provider'> | null {
  if (/^grok-4\.20-multi-agent/.test(id)) return null;
  if (/^grok-4\.(?:[6-9]|1\d)/.test(id)) return known(levels(['low', 'medium', 'high', 'xhigh'], 'high'));
  if (/^grok-4\.5/.test(id)) return known(levels(['low', 'medium', 'high'], 'high'));
  if (/^grok-3-mini/.test(id)) return known([omit(), ...levels(['low', 'high'])]);
  if (/^grok-(?:4(?:$|-)|3(?:$|-)|2|code)/.test(id)) return fixed(bi('This model does not accept a reasoning effort.', '该模型不接受思考强度参数。'));
  return null;
}

/** Documented values every provider family accepts, for its models we do not know yet. */
function providerFallback(provider: OfficialProvider): ReasoningEffort[] {
  switch (provider) {
    case 'openai': return ['none', 'minimal', ...ALL_LEVELS];
    case 'anthropic': return [...ALL_LEVELS];
    case 'gemini': return ['none', 'minimal', 'low', 'medium', 'high'];
    case 'xai': return ['low', 'medium', 'high', 'xhigh'];
    case 'doubao': return ['minimal', 'low', 'medium', 'high'];
    default: return [];
  }
}

function thirdParty(): ReasoningProfile {
  return {
    provider: null, known: false, allowCustom: true,
    entries: REASONING_EFFORT_OPTIONS.map(value => ({
      value, kind: value === 'off' ? 'omit' as const : 'level' as const, label: t(`effort_${value}`), short: SHORT[value],
    })),
  };
}

export function cliModelInfo(ep: Endpoint): CliModelInfo | undefined {
  if (!ep.model) return undefined;
  return ep.cliModels?.find(m => m.id === ep.model || m.resolvedModel === ep.model);
}

function cliProfile(ep: Endpoint): ReasoningProfile {
  const follow = omit(bi('CLI setting', '跟随 CLI 设置'), bi('Auto', '自动'));
  const catalog = ep.cliModels ?? [];
  // The CLI's own configuration picks the model when none is chosen here, so
  // its efforts are not guessed from the catalog's default entry.
  if (!ep.model) return { provider: null, known: false, entries: [follow], allowCustom: !catalog.length, needsModel: catalog.length > 0 };
  const info = cliModelInfo(ep);
  const efforts = [...new Set((info?.efforts ?? []).filter(v => v !== 'off' && REASONING_EFFORT_OPTIONS.includes(v)))];
  const defaultEffort = info?.defaultEffort && efforts.includes(info.defaultEffort) ? info.defaultEffort : undefined;
  return {
    provider: null,
    known: !!info,
    entries: [follow, ...levels(efforts, defaultEffort)],
    // Without the model in the CLI's catalog its accepted values are unknown.
    allowCustom: !info,
    note: info && !efforts.length ? bi('This model has no adjustable reasoning in the CLI.', '该模型在 CLI 中不能调整思考强度。') : undefined,
  };
}

/** The reasoning choices to show for an endpoint and its selected model. */
export function reasoningProfile(ep: Endpoint | null | undefined): ReasoningProfile | null {
  if (!ep) return null;
  if (ep.kind !== 'custom-api') return cliProfile(ep);
  const provider = officialProvider(ep);
  if (!provider) return thirdParty();
  const id = modelId(ep);
  const rule = provider === 'openai' ? openaiRule(id)
    : provider === 'anthropic' ? anthropicRule(id)
    : provider === 'deepseek' ? deepseekRule(id)
    : provider === 'qwen' ? qwenRule(id)
    : provider === 'glm' ? glmRule(id)
    : provider === 'kimi' ? kimiRule(id)
    : provider === 'minimax' ? minimaxRule(id)
    : provider === 'doubao' ? doubaoRule(id)
    : provider === 'mimo' ? mimoRule(id)
    : provider === 'gemini' ? geminiRule(id)
    : xaiRule(id);
  if (rule) return { provider, ...rule };
  // Official host, model not in the table yet: offer the provider's documented
  // values, or keep the pass-through when the provider has no shared set.
  const fallback = providerFallback(provider);
  if (!fallback.length) return thirdParty();
  return {
    provider, known: false, allowCustom: true,
    entries: [omit(), ...levels(fallback)],
    anthropic: provider === 'anthropic' ? { style: 'adaptive', thinksByDefault: false, summarized: true } : undefined,
  };
}

/** The entry that a stored value stands for. Values outside the documented
 *  set (for example after switching models) map to the nearest documented one. */
export function selectedReasoningEntry(profile: ReasoningProfile | null, effort: ReasoningEffort | undefined): ReasoningEntry | null {
  const entries = profile?.entries ?? [];
  if (!entries.length) return null;
  if (effort !== undefined) {
    const exact = entries.find(entry => entry.value === effort);
    if (exact) return exact;
  }
  if (effort === undefined || effort === 'off') {
    return entries.find(entry => entry.kind === 'omit') ?? entries.find(entry => entry.isDefault) ?? entries[0];
  }
  const alias = profile?.aliases?.[effort];
  if (alias) {
    const mapped = entries.find(entry => entry.value === alias);
    if (mapped) return mapped;
  }
  if (effort === 'none') {
    const off = entries.find(entry => entry.kind === 'disable');
    if (off) return off;
  }
  // Nearest documented level; ties go to the stronger one, and only `none`
  // itself may turn reasoning off.
  const rank = ORDER.indexOf(effort);
  let best: ReasoningEntry | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const entry of entries) {
    if (entry.kind !== 'level' && entry.kind !== 'enable') continue;
    if (entry.value === 'none' && effort !== 'none') continue;
    const distance = Math.abs(ORDER.indexOf(entry.kind === 'enable' ? 'high' : entry.value) - rank);
    if (distance <= bestDistance) { best = entry; bestDistance = distance; }
  }
  return best ?? entries.find(entry => entry.isDefault) ?? entries[0];
}

/** Effective entry for an endpoint as configured now. */
export function endpointReasoningEntry(ep: Endpoint | null | undefined): ReasoningEntry | null {
  return selectedReasoningEntry(reasoningProfile(ep), ep?.reasoningEffort);
}

/** No explicit choice: the request leaves reasoning to the provider's default.
 *  (`off` is an explicit choice only where it is a listed entry, as on DeepSeek.) */
function leftToDefault(profile: ReasoningProfile, effort: ReasoningEffort | undefined): boolean {
  if (effort === undefined) return true;
  return effort === 'off' && !profile.entries.some(entry => entry.value === 'off' && entry.kind !== 'omit');
}

/** The model reasons with the current selection (used to drop sampling
 *  parameters reasoning models reject). */
function reasoningActive(profile: ReasoningProfile, entry: ReasoningEntry | null): boolean {
  if (!entry) return !!profile.alwaysThinks;
  if (entry.kind === 'disable') return false;
  if (entry.kind === 'level') return entry.value !== 'none';
  if (entry.kind === 'enable') return true;
  // omit: the documented default decides.
  if (profile.anthropic) return profile.anthropic.thinksByDefault;
  const fallback = profile.entries.find(item => item.isDefault);
  return fallback ? fallback.kind !== 'disable' && fallback.value !== 'none' : true;
}

function lowestLevel(entries: ReasoningEntry[]): ReasoningEffort | undefined {
  return entries
    .filter(entry => entry.kind === 'level' && entry.value !== 'none')
    .sort((a, b) => ORDER.indexOf(a.value) - ORDER.indexOf(b.value))[0]?.value;
}

/** The cheapest reasoning setting an endpoint allows, for short helper
 *  requests (selection translation, inline completion): reasoning switched off
 *  where the provider documents a switch, otherwise its lightest level.
 *  Third-party APIs get `off` (nothing sent), as before. */
export function lightestReasoningEffort(ep: Endpoint): ReasoningEffort {
  const profile = reasoningProfile(ep);
  if (!profile || !profile.entries.length) return 'off';
  if (ep.kind !== 'custom-api') return lowestLevel(profile.entries) ?? 'off';
  if (!profile.provider) return 'off';
  const off = profile.entries.find(entry => entry.kind === 'disable');
  if (off) return off.value;
  if (profile.anthropic && !profile.anthropic.thinksByDefault) return 'off';
  if (profile.entries.some(entry => entry.kind === 'level' && entry.value === 'none')) return 'none';
  return lowestLevel(profile.entries) ?? 'off';
}

/** An official model still reasons with the endpoint's current setting, so
 *  short requests need output room for thinking before the answer. */
export function reasoningRemainsOn(ep: Endpoint): boolean {
  const profile = reasoningProfile(ep);
  if (!profile?.provider) return false;
  if (profile.alwaysThinks) return true;
  if (!profile.entries.length) return false;
  if (customEffortValueSafe(ep.customReasoningEffort)) return true;
  return reasoningActive(profile, selectedReasoningEntry(profile, ep.reasoningEffort));
}

function customEffortValueSafe(value?: string): boolean {
  const token = value?.trim();
  return !!token && token !== 'off';
}

/** Apply documented reasoning parameters for official OpenAI-compatible APIs.
 *  Returns false for third-party endpoints, which keep the unchanged pass-through. */
export function applyOfficialOpenAIReasoning(ep: Endpoint, body: Record<string, unknown>, custom?: string): boolean {
  const profile = reasoningProfile(ep);
  const provider = profile?.provider;
  if (!profile || !provider || provider === 'anthropic') return false;
  const entry = custom ? null : selectedReasoningEntry(profile, ep.reasoningEffort);
  const send = custom ? null : leftToDefault(profile, ep.reasoningEffort) ? null : entry;
  if (custom) body.reasoning_effort = custom;
  else if (send) {
    const entry = send;
    switch (provider) {
      case 'deepseek':
        if (entry.kind === 'disable') body.thinking = { type: 'disabled' };
        else if (entry.kind === 'level') { body.thinking = { type: 'enabled' }; body.reasoning_effort = entry.value; }
        break;
      case 'qwen':
        if (entry.kind === 'disable') body.enable_thinking = false;
        else if (entry.kind === 'enable') body.enable_thinking = true;
        break;
      case 'glm':
        if (entry.kind === 'disable') body.thinking = { type: 'disabled' };
        else if (entry.kind === 'enable') body.thinking = { type: 'enabled' };
        else if (entry.kind === 'level') { body.thinking = { type: 'enabled' }; body.reasoning_effort = entry.value; }
        break;
      case 'kimi':
      case 'mimo':
        if (entry.kind === 'disable') body.thinking = { type: 'disabled' };
        else if (entry.kind === 'enable') body.thinking = { type: 'enabled' };
        else if (entry.kind === 'level') body.reasoning_effort = entry.value;
        break;
      case 'minimax':
        if (entry.kind === 'disable') body.thinking = { type: 'disabled' };
        else if (entry.kind === 'enable') body.thinking = { type: 'adaptive' };
        else if (entry.kind === 'level') body.reasoning_effort = entry.value;
        break;
      default:
        // openai, doubao, gemini, xai: the documented value is reasoning_effort itself.
        if (entry.kind === 'level' || entry.kind === 'disable') body.reasoning_effort = entry.value;
        break;
    }
  }
  // MiniMax otherwise returns reasoning inside <think> tags in the answer text.
  if (provider === 'minimax') body.reasoning_split = true;
  // Kimi fixes temperature itself and rejects any other value.
  if (provider === 'kimi') delete body.temperature;
  if (provider === 'openai' && (custom ? custom !== 'none' : reasoningActive(profile, entry) && (profile.known || /^(?:gpt-[5-9]|o\d)/.test(modelId(ep))))) {
    // Reasoning models accept only the default temperature and count output as completion tokens.
    delete body.temperature;
    if (typeof body.max_tokens === 'number') { body.max_completion_tokens = body.max_tokens; delete body.max_tokens; }
  }
  return true;
}

const BUDGETS: Partial<Record<ReasoningEffort, number>> = { minimal: 2_048, low: 4_096, medium: 10_000, high: 16_000, xhigh: 24_000, max: 24_000, ultra: 24_000 };
/** Output room when thinking may run: thinking tokens count toward max_tokens. */
const ADAPTIVE_MAX_TOKENS = { streaming: 64_000, request: 32_000 };

/** Official Anthropic Messages API thinking. Returns false for other hosts,
 *  which keep the budget mapping that compatible gateways expect. */
export function applyOfficialAnthropicThinking(ep: Endpoint, body: Record<string, unknown>, custom: string | undefined, streaming: boolean): boolean {
  if (officialProvider(ep) !== 'anthropic') return false;
  const profile = reasoningProfile(ep);
  const thinking = profile?.anthropic;
  if (!profile || !thinking) return true;
  const roomy = (tokens: number) => { if (typeof body.max_tokens !== 'number' || body.max_tokens < tokens) body.max_tokens = tokens; };
  const adaptiveBlock = () => thinking.summarized ? { type: 'adaptive', display: 'summarized' } : { type: 'adaptive' };
  const outputRoom = streaming ? ADAPTIVE_MAX_TOKENS.streaming : ADAPTIVE_MAX_TOKENS.request;
  if (custom) {
    if (thinking.style === 'adaptive') { body.thinking = adaptiveBlock(); roomy(outputRoom); }
    body.output_config = { ...(body.output_config as Record<string, unknown> | undefined), effort: custom };
    return true;
  }
  const entry = leftToDefault(profile, ep.reasoningEffort) ? null : selectedReasoningEntry(profile, ep.reasoningEffort);
  if (thinking.style === 'adaptive') {
    if (entry?.kind === 'level') {
      body.thinking = adaptiveBlock();
      body.output_config = { ...(body.output_config as Record<string, unknown> | undefined), effort: entry.value };
      roomy(outputRoom);
    } else if (entry?.kind === 'disable' && thinking.disable) {
      body.thinking = { type: thinking.disable };
    } else if (thinking.thinksByDefault) {
      body.thinking = adaptiveBlock();
      roomy(outputRoom);
    }
  } else if (thinking.style === 'budget' && entry?.kind === 'level') {
    const budget = BUDGETS[entry.value] ?? BUDGETS.medium ?? 10_000;
    body.thinking = { type: 'enabled', budget_tokens: budget };
    if (thinking.budgetEffort) body.output_config = { ...(body.output_config as Record<string, unknown> | undefined), effort: entry.value };
    roomy(budget + 8_000);
  }
  return true;
}

/** Reasoning that must travel back with earlier assistant turns.
 *  DeepSeek rejects tool conversations without it, MiMo rejects tool calls
 *  without it, and Kimi keeps reasoning continuity with it. */
export function requiresReasoningReplay(ep: Endpoint | null | undefined): boolean {
  if (!ep) return false;
  const provider = officialProvider(ep);
  if (provider === 'deepseek' || provider === 'mimo' || provider === 'kimi') return true;
  const model = (ep.model ?? '').toLowerCase();
  return /reasoner|deepseek-r1|deepseek-v3.*think|deepseek[-_/.]?v4|qwq|r1-distill/.test(model);
}

/** Whether the provider error hint about unchanged effort values applies. */
export function effortPassesThroughUnchanged(ep: Endpoint): boolean {
  const profile = reasoningProfile(ep);
  return !profile?.provider || !profile.known;
}

/** Models that accept only their own sampling temperature, on any host:
 *  OpenAI reasoning models (GPT-5 and later, o-series) and Kimi K2.5+ / K3. */
export function modelRejectsCustomTemperature(model: string | undefined): boolean {
  const id = (model ?? '').trim().toLowerCase().replace(/^[\w.-]+\//, '');
  if (/^gpt-5(?:\.\d+)?-chat/.test(id)) return false;
  return /^(?:gpt-(?:5|[6-9])|o[134](?:-|$))/.test(id) || /^kimi-k(?:2\.[5-9]|2-thinking|3)/.test(id);
}

/** Temperature for an OpenAI-compatible request; undefined means leave it out. */
export function requestTemperature(ep: Pick<Endpoint, 'temperature' | 'model'>, requested: number | undefined): number | undefined {
  if (ep.temperature === 'omit') return undefined;
  if (typeof ep.temperature === 'number' && Number.isFinite(ep.temperature)) return ep.temperature;
  if (modelRejectsCustomTemperature(ep.model)) return undefined;
  return requested ?? 0.7;
}
