// Mode type kept for backwards-compat with persisted sessions, but the active
// runtime now uses RunMode ('plan' / 'act') everywhere. MODE_LABELS /
// MODE_DESCRIPTIONS were dead — referenced nowhere — and have been removed.
export type Mode = 'chat' | 'edit' | 'agent' | 'compose' | 'ask';

export interface TokenUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  costUSD?: number;
}

export interface ToolEvent {
  id: string;
  name: string;
  args: any;
  result?: string;
  /** Rich result content (e.g. image blocks from view_image). Sent back to the model
   *  on subsequent turns so it can re-reference the image / resource. */
  contentBlocks?: import('./providers/types').ToolContentBlock[];
  status: 'pending' | 'running' | 'success' | 'error' | 'denied';
  startedAt: number;
  endedAt?: number;
}

/** Lightweight metadata of a context item — used in saved chats instead of the full content,
 *  so that persisted chat logs do not embed note contents / data URIs. */
export interface ContextItemRef {
  kind: ContextItem['kind'];
  label: string;
  detail?: string;
  tokens: number;
  pinned: boolean;
  isCurrent?: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  /** Canonical content sent to the model. For slash-triggered user messages
   *  this is the FULL expanded prompt (template + ${selection-or-file} body).
   *  The UI prefers `displayContent` when set, so the chat bubble can show a
   *  compact handle like "/summarize" while the model still receives the
   *  expanded version on subsequent turns. */
  content: string;
  /** Optional pretty form shown in the chat bubble. When undefined, the UI
   *  falls back to `content`. */
  displayContent?: string;
  toolEvents?: ToolEvent[];
  timestamp: number;
  /** When multiple assistant messages are produced within a single user
   *  turn (codex emitting agent_message → tool → agent_message → tool …),
   *  they all share the same `turnId`. The UI groups them into one visual
   *  container so the vertical rhythm reads as one continuous answer. */
  turnId?: string;
  usage?: TokenUsage;
  /** Stored as metadata-only refs; never the full file/image content. */
  contextSnapshot?: ContextItemRef[];
  /** For user messages: the quoted selection text included in this turn (if any),
   *  rendered as a collapsible block below the user's message. */
  selectionEcho?: { text: string; source: string; file?: string };
  /** For assistant messages: chain-of-thought from reasoner models. Shown as collapsible. */
  reasoningContent?: string;
  /** When true, this assistant message is an auto-compaction summary that REPLACED a
   *  block of earlier messages. The agent loop continues to send it like a normal
   *  assistant turn; the UI renders it differently. */
  compactSummary?: boolean;
  /** Number of messages this summary replaced (for UI display + analytics). */
  summaryOfCount?: number;
  /** Estimated tokens of the original messages (so the UI can show "saved ~12k tok"). */
  summaryTokensSaved?: number;
  /** How many times this conversation has been compacted (1 = first summary,
   *  2 = a summary that incorporated an earlier summary, …). */
  summaryDepth?: number;
}

export interface ContextItem {
  id: string;
  kind: 'file' | 'folder' | 'tag' | 'selection' | 'web' | 'clipboard' | 'recent' | 'dataview' | 'image';
  label: string;
  detail?: string;
  source?: 'markdown' | 'pdf' | 'html' | 'glossa' | 'unknown';
  content: string;
  preview?: string;          // short preview for UI (selection text)
  tokens: number;
  pinned: boolean;
  isCurrent?: boolean;
}

export interface SlashCommand {
  id: string;
  trigger: string;
  title: string;
  description?: string;
  template: string;
  custom?: boolean;
}

/** Unified reasoning-effort knob mapped per provider:
 *   - Anthropic API: thinking { type:'enabled', budget_tokens: N }
 *   - OpenAI-compatible API: expose xhigh in Glossa, map to provider max when
 *     known; otherwise send 'xhigh' and let the endpoint decide
 *   - DeepSeek V4 API: reasoning_effort: 'high'|'max' (xhigh maps to max)
 *   - Codex CLI: `-c model_reasoning_effort="<value>"` — supports low/medium/high/xhigh
 *   - Claude Code CLI: `--thinking <value>` */
export type ReasoningEffort = 'off' | 'low' | 'medium' | 'high' | 'xhigh';

export interface Endpoint {
  id: string;
  label: string;
  kind: 'custom-api' | 'codex-cli' | 'claude-code-cli';

  // custom-api
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  availableModels?: string[];
  headers?: Record<string, string>;
  apiStyle?: 'openai' | 'anthropic';
  /** Reasoning effort knob, mapped to provider-specific args/headers. */
  reasoningEffort?: ReasoningEffort;

  // cli (common)
  binaryPath?: string;
  cwd?: string;
  cliExtraArgs?: string[];
  /** Let the CLI run its own agent (tools / files / etc) instead of single-shot LLM. */
  cliFullAgent?: boolean;
  /** Print spawn args + every stream-json event to devtools console — for debugging
   *  cases where the sidebar shows nothing but the CLI is supposedly working. */
  cliDebug?: boolean;

  // codex-cli specific
  codexSandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
  codexApprovalPolicy?: 'untrusted' | 'on-failure' | 'on-request' | 'never';
  codexUseOss?: boolean;
  codexConfigOverrides?: string;   // multi-line "key=value" pairs
  /** When true (default), use `codex app-server --listen stdio://` protocol
   *  for token-level streaming (same protocol codex's TUI uses). Falls back
   *  to legacy `codex exec --json` (no token streaming, only item-level
   *  completion events) when false. */
  codexUseAppServer?: boolean;

  /** Custom API: use Obsidian requestUrl (system-proxy aware, but no streaming). */
  useObsidianFetch?: boolean;

  // claude-code-cli specific
  bareMode?: boolean;
  maxTurns?: number;
  claudeAllowedTools?: string;     // space-separated, passed through
  claudeDisallowedTools?: string;
  claudeAddDirs?: string;          // newline-separated paths
  claudeMcpConfig?: string;        // path to mcp config
  claudeMaxBudgetUSD?: number;
  claudeFallbackModel?: string;

  // proxy
  proxy?: string;
  proxyMode?: 'global' | 'override' | 'none';
}

export function isDeepSeekEndpoint(ep: Partial<Pick<Endpoint, 'label' | 'baseUrl' | 'model'>>): boolean {
  const haystack = `${ep.label ?? ''} ${ep.baseUrl ?? ''} ${ep.model ?? ''}`.toLowerCase();
  return haystack.includes('deepseek');
}

export function reasoningOptionsForEndpoint(ep?: Endpoint | null): ReasoningEffort[] {
  if (!ep) return [];
  if (ep.kind === 'codex-cli') return ['off', 'low', 'medium', 'high', 'xhigh'];
  if (ep.kind === 'claude-code-cli') return ['off', 'low', 'medium', 'high'];
  if (ep.apiStyle === 'anthropic') return ['off', 'low', 'medium', 'high', 'xhigh'];
  if (isDeepSeekEndpoint(ep)) return ['off', 'high', 'xhigh'];
  return ['off', 'low', 'medium', 'high', 'xhigh'];
}

export function mapOpenAIReasoningEffort(ep: Endpoint, effort?: ReasoningEffort): string | null {
  if (!effort || effort === 'off') return null;
  if (isDeepSeekEndpoint(ep)) {
    if (effort === 'xhigh') return 'max';
    if (effort === 'low' || effort === 'medium') return 'high';
    return effort;
  }
  return effort;
}

export interface CustomPrompt {
  id: string;
  name: string;
  systemPrompt: string;
  folderScope?: string;
}

export type PermissionLevel = 'read-only' | 'workspace-write' | 'full';
export type RunMode = 'plan' | 'act';
export type WebSearchProvider = 'auto' | 'duckduckgo' | 'brave' | 'tavily' | 'exa' | 'serpapi';

/** A persisted decision the user made during a prior approval — used to auto-resolve
 *  future calls of the same tool against the same scope.
 *
 *  Three behaviors:
 *   - allow: skip approval, run directly
 *   - deny: refuse without prompting
 *   - ask:  still prompt, but pre-check the "Always allow…" choice (soft preference)
 *
 *  Tool can also be:
 *   - 'mcp:<server>:*' — match any tool from a specific MCP server
 *   - 'mcp:*'          — match any MCP tool
 */
export interface PermissionRule {
  tool: string;
  /** global = any args; path = exact file/folder path match; folder = path starts with value */
  scope: 'global' | 'folder' | 'path';
  /** Required for scope ∈ {folder,path}. */
  value?: string;
  behavior: 'allow' | 'deny' | 'ask';
  /** When true the rule is dropped at session boundary (so user can scope a one-session allow). */
  sessionOnly?: boolean;
  /** When set, the rule only applies inside this session id. Set automatically when
   *  the user picks "Just this session" from the approval UI. */
  scopedToSessionId?: string;
  addedAt: number;
}

/** Append-only approval log entry. Capped to last 200 in settings (FIFO). */
export interface PermissionLogEntry {
  at: number;
  tool: string;
  args?: string;        // JSON-stringified, capped to ~200 chars
  decision: 'allow' | 'deny' | 'auto-allow' | 'auto-deny' | 'denied-by-rule' | 'allowed-by-rule';
  scope?: string;       // e.g. 'global', 'folder:/Notes', 'path:Foo.md', 'session'
}

/** Normalize a server name into the prefix Glossa uses for MCP-exposed tool
 *  names (e.g. `weather-east` → `weather_east`). MUST stay in lockstep with
 *  mcp.ts's exposedName construction — otherwise a rule on the rule side
 *  applies a different prefix than the actual tool name, and the match
 *  silently fails. Exported so mcp.ts can import and reuse. */
export function normalizeMcpServerName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '_');
}

const PERMISSION_PATH_KEYS = new Set([
  'path',
  'paths',
  'file_path',
  'base_path',
  'target_path',
  'template_path',
  'from',
  'to',
]);

function permissionRulePaths(args: any): string[] {
  if (!args || typeof args !== 'object') return [];
  const out: string[] = [];
  const add = (v: unknown) => {
    if (typeof v !== 'string') return;
    const s = v.trim();
    if (s) out.push(s);
  };
  for (const [key, value] of Object.entries(args)) {
    const pathLike = PERMISSION_PATH_KEYS.has(key) || key.endsWith('_path') || key.endsWith('Path');
    if (!pathLike) continue;
    if (Array.isArray(value)) for (const item of value) add(item);
    else add(value);
  }
  return Array.from(new Set(out));
}

/** Match an MCP rule (tool name like 'mcp:weather:*' or 'mcp:*') against a tool call. */
function mcpRuleMatches(rule: PermissionRule, toolName: string): boolean {
  if (!rule.tool.startsWith('mcp:')) return false;
  if (rule.tool === 'mcp:*') return toolName.includes('__');   // our MCP namespacing
  // 'mcp:<server>:*' — match tools whose exposed name starts with '<server>__'
  const m = rule.tool.match(/^mcp:([^:]+):\*$/);
  if (!m) return false;
  return toolName.startsWith(normalizeMcpServerName(m[1]) + '__');
}

/** Check whether a rule matches a (tool, args) pair. */
export function matchPermissionRule(rule: PermissionRule, toolName: string, args: any, currentSessionId?: string): boolean {
  if (rule.scopedToSessionId && rule.scopedToSessionId !== currentSessionId) return false;
  if (rule.tool.startsWith('mcp:')) {
    if (!mcpRuleMatches(rule, toolName)) return false;
  } else if (rule.tool !== toolName) return false;
  if (rule.scope === 'global') return true;
  const paths = permissionRulePaths(args);
  if (paths.length === 0) return false;
  if (rule.scope === 'path') return paths.some(path => path === rule.value);
  if (rule.scope === 'folder') {
    const folder = (rule.value ?? '').replace(/\/$/, '');
    return paths.some(path => path === folder || path.startsWith(folder + '/'));
  }
  return false;
}

export interface GlossaSettings {
  activeEndpointId: string | null;
  endpoints: Endpoint[];
  mode: Mode;

  autoAttachCurrentFile: boolean;
  autoAttachSelection: boolean;

  customSlashCommands: SlashCommand[];
  customPrompts: CustomPrompt[];

  showCostBar: boolean;
  maxContextTokens: number;
  warnTokenThreshold: number;

  // agent
  agentMaxSteps: number;
  agentAlwaysApproveTools: string[];
  agentNeverApproveTools: string[];
  permissionLevel: PermissionLevel;     // claw-code-style 3-tier
  runMode: RunMode;                      // plan / act (Cline-style)
  loadProjectContext: boolean;           // auto-load AGENTS.md / CLAUDE.md / .codex.md

  chatsFolder: string;

  // proxy
  globalProxy: string;
  customApiUseObsidianFetch: boolean;

  // web research / downloads
  webSearchProvider: WebSearchProvider;
  webSearchApiKey: string;
  webAutoApproveNetworkReads: boolean;
  webDefaultDownloadFolder: string;
  webMaxDownloadBytes: number;
  webAllowAutoDownload: boolean;
  webSaveProvenance: boolean;

  // UI
  uiLanguage: 'en' | 'zh' | 'auto';
  /** Font size (px) for reasoning card body. Range 10–18. Default 12. */
  reasoningFontSize: number;
  /** Show a Zotero-style local reference preview when hovering citations in PDFs. */
  citationHoverEnabled: boolean;
  /** Delay before showing the PDF citation preview. Long enough to avoid accidental popups. */
  citationHoverDelayMs: number;
  /** When true, citation previews only trigger while Alt/Option is held. */
  citationHoverRequireModifier: boolean;

  // updates
  updateCheckEnabled: boolean;
  updateLastCheckedAt: number;
  updateDismissedVersion: string;
  updateLatestVersion: string;
  updateLatestReleaseUrl: string;

  // Workflows
  workflows: Workflow[];

  // encryption
  encryptionEnabled: boolean;
  encryptionSaltBase64: string;
  encryptionVerifier: string;          // encrypted constant — used to verify passphrase

  // embedding RAG
  embeddingEndpointId: string | null;
  embeddingModel: string;              // e.g. "text-embedding-3-small"
  embeddingChunkSize: number;          // characters per chunk
  embeddingChunkOverlap: number;
  embeddingAutoUpdate: boolean;
  /** True once the user has confirmed "yes I understand my vault content
   *  will be uploaded to the embedding endpoint". Shown on first build only.
   *  Settings → Reset embedding consent re-clears this for testing. */
  embeddingConsentGranted?: boolean;

  // checkpoint
  checkpointEnabled: boolean;

  // auto-compaction
  /** When true, auto-summarise the conversation when token usage crosses the threshold. */
  autoCompactEnabled: boolean;
  /** Trigger threshold as a percentage of maxContextTokens. e.g. 75 → compact when
   *  estimated session tokens exceed 75% of the budget. */
  autoCompactThresholdPct: number;

  // MCP
  mcpServers: McpServerConfig[];
  /** Extra MCP marketplace catalog URLs (JSON arrays of McpEntry). Loaded into the
   *  marketplace modal alongside the bundled catalog. */
  mcpCatalogUrls: string[];

  /** Persisted approval decisions ("always allow file_edit in /Projects"). Consulted
   *  by the agent loop BEFORE prompting the user. */
  permissionRules: PermissionRule[];
  /** Append-only audit log of approval decisions (last 200). */
  permissionLog: PermissionLogEntry[];
}

export interface McpServerConfig {
  id: string;
  name: string;
  command: string;
  args: string[];          // additional args
  enabled: boolean;
  env?: Record<string, string>;
}

export const DEFAULT_SETTINGS: GlossaSettings = {
  activeEndpointId: null,
  endpoints: [],
  mode: 'chat',
  autoAttachCurrentFile: true,
  autoAttachSelection: true,
  customSlashCommands: [],
  customPrompts: [],
  showCostBar: true,
  maxContextTokens: 1_000_000,
  warnTokenThreshold: 500_000,
  agentMaxSteps: 20,
  agentAlwaysApproveTools: ['search_vault', 'grep_vault', 'semantic_search', 'read_note', 'list_files', 'get_active_file', 'get_selection', 'query_metadata', 'search_by_tag', 'todo_write', 'view_image', 'discover_skills', 'run_skill'],
  agentNeverApproveTools: ['delete_note'],
  permissionLevel: 'read-only',
  runMode: 'plan',
  loadProjectContext: true,
  chatsFolder: 'Chats',
  globalProxy: '',
  customApiUseObsidianFetch: false,
  webSearchProvider: 'auto',
  webSearchApiKey: '',
  webAutoApproveNetworkReads: false,
  webDefaultDownloadFolder: 'Downloads/Glossa',
  webMaxDownloadBytes: 80 * 1024 * 1024,
  webAllowAutoDownload: false,
  webSaveProvenance: true,
  encryptionEnabled: false,
  encryptionSaltBase64: '',
  encryptionVerifier: '',
  embeddingEndpointId: null,
  embeddingModel: 'text-embedding-3-small',
  embeddingChunkSize: 1500,
  embeddingChunkOverlap: 200,
  embeddingAutoUpdate: false,
  checkpointEnabled: true,
  autoCompactEnabled: true,
  autoCompactThresholdPct: 75,
  mcpServers: [],
  mcpCatalogUrls: [],
  permissionRules: [],
  permissionLog: [],
  uiLanguage: 'en',
  reasoningFontSize: 13,
  citationHoverEnabled: false,
  citationHoverDelayMs: 700,
  citationHoverRequireModifier: false,
  updateCheckEnabled: true,
  updateLastCheckedAt: 0,
  updateDismissedVersion: '',
  updateLatestVersion: '',
  updateLatestReleaseUrl: '',
  workflows: [],
};

export interface Workflow {
  id: string;
  title: string;
  prompt: string;
  createdAt: number;
}

export interface PlanItem {
  /** Imperative form, e.g. "Fix authentication bug" */
  content: string;
  /** Present-continuous form shown in the spinner during execution,
   *  e.g. "Fixing authentication bug". Upstream Claude Code requires this. */
  activeForm?: string;
  status: 'pending' | 'in_progress' | 'completed';
}

/** Snapshot of pre-compact messages kept so the user can undo a compaction. Capped to
 *  the last 3 entries per session to bound disk + memory. */
export interface CompactSnapshot {
  summaryId: string;            // id of the compactSummary ChatMessage
  takenAt: number;
  messages: ChatMessage[];      // the messages REPLACED by this summary
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  mode: Mode;
  endpointId: string | null;
  messages: ChatMessage[];
  /** Latest todo_write snapshot — persisted so plan board survives session switches. */
  plan?: PlanItem[];
  /** Pre-compact message snapshots so users can undo. */
  compactHistory?: CompactSnapshot[];
}

/** Resolve the effective proxy for an endpoint. */
export function effectiveProxy(ep: Endpoint, globalProxy: string): string | undefined {
  if (ep.proxyMode === 'none') return undefined;
  if (ep.proxyMode === 'override' && ep.proxy) return ep.proxy;
  return globalProxy || undefined;
}

/** Context-window lookup keyed on substrings of the model id. Keep this table
 *  conservative: only return a value when the provider documents the family or
 *  the model id is specific enough. Unknown models return `null` so UI/prompt
 *  budgeting can fall back to the user's settings ceiling instead of showing a
 *  precise-looking guess. */
export function modelContextWindow(model: string | undefined | null): number | null {
  if (!model) return null;
  const m = model.toLowerCase();

  // Anthropic Claude: current Opus/Sonnet 4.6+ tier is 1M; older Claude 3.x /
  // 4.5 and Haiku remain 200k.
  if (/claude-(opus|sonnet)-4-7/.test(m)) return 1_000_000;
  if (/claude-(opus|sonnet)-4-6/.test(m)) return 1_000_000;
  if (/claude-(3[.-]5|3[.-]7|sonnet-4-5|haiku-4-5)/.test(m)) return 200_000;
  if (/claude/.test(m)) return 200_000;

  // OpenAI. GPT-4.1 is the long-context 1M family; GPT-4o / 4 Turbo are 128k.
  // GPT-5.4/5.5 full models are 1M; mini/nano/current base GPT-5 variants use
  // a smaller 400k-class window. o-series remains 200k.
  if (/gpt-5\.(4|5)(?!.*(?:mini|nano))/.test(m)) return 1_000_000;
  if (/gpt-5/.test(m)) return 400_000;
  if (/^o[1-5](\b|-)/.test(m)) return 200_000;
  if (/gpt-4\.1/.test(m)) return 1_000_000;
  if (/gpt-4o|gpt-4-turbo/.test(m)) return 128_000;
  if (/gpt-4-32k/.test(m)) return 32_000;
  if (/gpt-4/.test(m)) return 8_192;
  if (/gpt-3\.5-turbo-16k/.test(m)) return 16_384;
  if (/gpt-3\.5/.test(m)) return 16_384;

  // DeepSeek: official V4 Flash/Pro tier is 1M; older V3/R1 public ids are 64k.
  // Ambiguous aliases such as "deepseek-chat" change over time, so leave them
  // unknown unless the id names a documented family.
  if (/deepseek-v4|deepseek.*v4/.test(m)) return 1_000_000;
  if (/deepseek-v3/.test(m)) return 64_000;
  if (/deepseek-r1/.test(m)) return 64_000;
  if (/deepseek/.test(m)) return null;

  // Qwen / Alibaba Model Studio. Qwen3-Max is 262,144; current Plus/Flash
  // long-context variants are 1M. Older bare Qwen ids vary, so fall back.
  if (/qwen3?-max|qwen-max/.test(m)) return 262_144;
  if (/qwen.*(plus|flash|long)/.test(m)) return 1_000_000;
  if (/qwen/.test(m)) return null;

  // Gemini input token limits are 1,048,576 for current 2.5/3.x models; 1.5
  // Pro had a 2M window.
  if (/gemini-1\.5-pro/.test(m)) return 2_000_000;
  if (/gemini-1\.5|gemini-2|gemini-3/.test(m)) return 1_048_576;
  if (/gemini/.test(m)) return 1_048_576;

  // GLM / MiniMax / open-source families vary by hosted endpoint; keep only
  // stable broad defaults where the family is generally advertised that way.
  if (/abab|minimax/.test(m)) return 256_000;
  if (/llama-3|llama3|llama-4/.test(m)) return 128_000;
  if (/llama|mistral|mixtral/.test(m)) return 32_000;
  return null;
}
