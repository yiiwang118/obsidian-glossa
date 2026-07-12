
export type Lang = 'en' | 'zh' | 'auto';

let _lang: 'en' | 'zh' = 'en';
/** Subscribers fired whenever setLanguage() actually changes the resolved
 *  language. UI surfaces (view, settings tab, modals) attach a listener so
 *  they can re-render without a full plugin reload. */
const _subs = new Set<() => void>();

export function setLanguage(l: Lang) {
  const before = _lang;
  if (l === 'auto') {
    const sys = (navigator.language || 'en').toLowerCase();
    _lang = sys.startsWith('zh') ? 'zh' : 'en';
  } else _lang = l;
  if (_lang !== before) for (const fn of _subs) try { fn(); } catch { /* ignore */ }
}

export function currentLanguage(): 'en' | 'zh' { return _lang; }
export function onLanguageChange(fn: () => void): () => void {
  _subs.add(fn);
  return () => _subs.delete(fn);
}

/** Inline bilingual literal — for one-off prose where adding a full i18n key
 *  is overkill. The English version is the primary copy (default). Use this
 *  for things like Setting descriptions; use `t()` for short repeated labels. */
export function bi(en: string, zh: string): string {
  return _lang === 'zh' ? zh : en;
}

type Dict = Record<string, { en: string; zh: string }>;

const D: Dict = {
  'new_chat':            { en: 'New chat',          zh: '新对话' },
  'settings':            { en: 'Settings',          zh: '设置' },
  'export_chat':         { en: 'Export chat to note', zh: '导出对话为笔记' },
  'chat_history':        { en: 'Chat history',      zh: '历史对话' },
  'more':                { en: 'More',              zh: '更多' },
  'attach_file':         { en: 'Attach',             zh: '附加' },
  'send':                { en: 'Send (⌘/Ctrl+↵)',    zh: '发送 (⌘/Ctrl+↵)' },
  'stop':                { en: 'Stop',              zh: '停止' },
  'no_endpoint':         { en: 'No endpoint',       zh: '未配置 endpoint' },
  'token_total':         { en: 'Total context tokens', zh: '上下文总 token 数' },
  'placeholder_input':   { en: 'Ask anything · @ context · / commands',
                           zh: '问任何事 · @ 上下文 · / 命令' },
  'plan_mode':           { en: 'Plan',              zh: 'Plan' },
  'act_mode':            { en: 'Act',               zh: 'Act' },
  'plan_tooltip':        { en: 'Plan — no writes. Click for Act.',
                           zh: 'Plan — 不写文件。点击切 Act。' },
  'act_tooltip':         { en: 'Act — full agent. Click for Plan.',
                           zh: 'Act — 完整 agent。点击切 Plan。' },
  'empty_title':         { en: 'Glossa',            zh: 'Glossa' },
  'empty_sub':           { en: '@ context · / commands',
                           zh: '@ 上下文 · / 命令' },
  'copy':                { en: 'Copy',              zh: '复制' },
  'regenerate':          { en: 'Regenerate',        zh: '重新生成' },
  'insert_cursor':       { en: 'Insert at cursor',  zh: '插入光标处' },
  'apply_replace':       { en: 'Apply (replace selection)', zh: '应用（替换选中）' },
  'save_as_note':        { en: 'Save as note',      zh: '保存为笔记' },
  'fork_from':           { en: 'Fork from here',    zh: '从此分叉' },
  'rollback_turn':       { en: 'Rollback file edits made in this turn', zh: '回滚本轮的文件改动' },
  'approve':             { en: 'Approve',           zh: '批准' },
  'deny':                { en: 'Deny',              zh: '拒绝' },
  'enc_unlocked':        { en: '🔓 unlocked',       zh: '🔓 已解锁' },
  'enc_locked':          { en: '🔒 locked',         zh: '🔒 已锁定' },
  'enc_off':             { en: '⚠ keys are plaintext',
                           zh: '⚠ API key 明文存储' },

  /* ----- CLI endpoint settings ----- */
  'cli_default_model':         { en: 'Model',             zh: '模型' },
  'cli_default_model_desc':    { en: 'Empty = CLI default.',
                                  zh: '留空使用 CLI 默认。' },
  'cli_working_dir':           { en: 'CWD',               zh: '工作目录' },
  'cli_working_dir_desc':      { en: 'Usually the vault root.',
                                  zh: '通常设为 vault 根目录。' },
  'cli_binary_path':           { en: 'Binary',            zh: '可执行文件' },
  'cli_binary_path_desc':      { en: 'Absolute path. "auto" probes common locations.',
                                  zh: '绝对路径。"auto" 自动搜索常见位置。' },
  'cli_full_agent':            { en: 'Full agent',        zh: '完整 agent' },
  'cli_full_agent_desc':       { en: 'CLI runs its own tools outside Glossa approvals/checkpoints. Off = single-shot.',
                                  zh: 'CLI 在 Glossa 审批/checkpoint 之外自己跑工具。关闭则单次调用。' },

  /* ----- Reasoning effort ----- */
  'reasoning_effort':          { en: 'Reasoning',         zh: '思考强度' },
  'reasoning_effort_desc':     { en: 'OpenAI-compatible APIs receive the selected value unchanged. Unsupported models return their API error.',
                                  zh: 'OpenAI 兼容 API 会原样收到所选值；模型不支持时直接显示 API 错误。' },
  'reasoning_effort_desc_cli': { en: 'Higher = deeper + more tokens.',
                                  zh: '越高越深，token 消耗越多。' },
  'effort_off':                { en: 'off (omit)',        zh: 'off（不发送）' },
  'effort_none':               { en: 'none',              zh: 'none' },
  'effort_minimal':            { en: 'minimal',           zh: 'minimal' },
  'effort_low':                { en: 'low',               zh: 'low' },
  'effort_medium':             { en: 'medium',            zh: 'medium' },
  'effort_high':               { en: 'high',              zh: 'high' },
  'effort_xhigh':              { en: 'xhigh',             zh: 'xhigh' },
  'effort_max':                { en: 'max',               zh: 'max' },
  'effort_ultra':              { en: 'ultra',             zh: 'ultra' },

  /* ----- Codex-specific ----- */
  'codex_sandbox':             { en: 'Sandbox',           zh: '沙箱' },
  'codex_sandbox_desc':        { en: '-c sandbox_mode. Default: read-only.',
                                  zh: '-c sandbox_mode。默认 read-only。' },
  'codex_approval':            { en: 'Approval',          zh: '审批' },
  'codex_approval_desc':       { en: '-c approval_policy. Default: never only in read-only; otherwise on-request.',
                                  zh: '-c approval_policy。默认只在 read-only 下 never；否则 on-request。' },
  'codex_use_oss':             { en: 'OSS (--oss)',       zh: 'OSS (--oss)' },
  'codex_config_overrides':    { en: '-c overrides',      zh: '-c 覆盖' },
  'codex_config_overrides_desc':{ en: 'One per line. e.g. model_reasoning_effort="xhigh"',
                                   zh: '每行一条。例：model_reasoning_effort="xhigh"' },

  /* ----- Claude CLI-specific ----- */
  'claude_bare':               { en: 'Bare (--bare)',     zh: 'Bare (--bare)' },
  'claude_bare_desc':          { en: 'Skip hooks / skills / memory.',
                                  zh: '跳过 hooks / skills / memory。' },
  'claude_max_turns':          { en: 'Max turns',         zh: '最大轮数' },
  'claude_max_turns_desc':     { en: '20–50 for full agent.',
                                  zh: '完整 agent 推荐 20–50。' },

  /* ----- 0.3 additions: font + general settings ----- */
  'font_size':                 { en: 'Font size',         zh: '字号' },
  'font_size_desc':            { en: 'Pixels. Default 14.',
                                  zh: '像素，默认 14。' },
  'language':                  { en: 'Language',          zh: '语言' },
  'language_desc':             { en: '',                  zh: '' },
  'lang_auto':                 { en: 'Auto (match system)', zh: '自动（跟随系统）' },
  'lang_en':                   { en: 'English',             zh: 'English' },
  'lang_zh':                   { en: 'Chinese / 中文',      zh: '中文' },

  /* ----- history modal / drawer ----- */
  'hist_title':                { en: 'History',             zh: '历史' },
  'hist_search':               { en: 'Search title or message…', zh: '搜索标题或内容…' },
  'hist_empty':                { en: 'No chats yet',        zh: '暂无对话' },
  'hist_empty_hint':           { en: "Start a conversation in the sidebar — it'll show up here.",
                                  zh: '在侧栏发送一条消息，它就会出现在这里。' },
  'hist_no_match':             { en: 'No matches',          zh: '无匹配结果' },
  'hist_n_sessions':           { en: 'sessions',            zh: '个对话' },
  'hist_open':                 { en: 'Open',                zh: '打开' },
  'hist_rename':               { en: 'Rename',              zh: '重命名' },
  'hist_duplicate':            { en: 'Duplicate',           zh: '复制' },
  'hist_delete':               { en: 'Delete',              zh: '删除' },
  'hist_delete_confirm':       { en: 'Delete this chat?',   zh: '确认删除这条对话？' },
  'hist_purge_old':            { en: 'Delete older than 7d', zh: '删除 7 天前的对话' },
  'hist_clear_all':            { en: 'Clear all',           zh: '清空全部' },
  'hist_close':                { en: 'Close',               zh: '关闭' },
  'today':                     { en: 'Today',               zh: '今天' },
  'yesterday':                 { en: 'Yesterday',           zh: '昨天' },

  /* ----- passphrase modal ----- */
  'pp_set_title':              { en: '🔒 Set encryption passphrase', zh: '🔒 设置加密 passphrase' },
  'pp_unlock_title':           { en: '🔓 Unlock Glossa',     zh: '🔓 解锁 Glossa' },
  'pp_set_desc':               { en: 'Used to wrap API keys (AES-256). Not saved — re-prompted on restart.',
                                  zh: '用来加密 API key (AES-256)。不保存，重启后会再问。' },
  'pp_unlock_desc':            { en: 'Unlock encrypted API keys.',
                                  zh: '解锁加密的 API key。' },
  'pp_placeholder':            { en: 'Passphrase',          zh: 'Passphrase' },
  'pp_confirm':                { en: 'Confirm',             zh: '再次输入' },
  'pp_mismatch':               { en: "Passphrases don't match.", zh: '两次输入不一致' },
  'pp_too_short':              { en: 'Passphrase must be at least 4 characters.', zh: 'Passphrase 至少 4 个字符' },
  'pp_cancel':                 { en: 'Cancel',              zh: '取消' },
  'pp_encrypt':                { en: 'Encrypt',             zh: '加密' },
  'pp_unlock':                 { en: 'Unlock',              zh: '解锁' },

  /* ----- settings sections ----- */
  'sec_general':               { en: 'General',             zh: '常规' },
  'sec_context':               { en: 'Context',             zh: '上下文' },
  'sec_agent':                 { en: 'Agent',               zh: 'Agent' },
  'sec_network':               { en: 'Network / Proxy',     zh: '网络 / 代理' },
  'sec_endpoints':             { en: 'Endpoints',           zh: 'Endpoint' },
  'sec_encryption':            { en: 'Encryption (optional)', zh: '加密（可选）' },
  'sec_semantic':              { en: 'Semantic search (RAG)', zh: '语义搜索 (RAG)' },
  'sec_mcp':                   { en: 'MCP servers',         zh: 'MCP 服务' },
  'sec_workflows':             { en: 'Workflows',           zh: '工作流' },
  'sec_slash':                 { en: 'Custom slash commands', zh: '自定义 / 命令' },
  'sec_prompts':               { en: 'Custom system prompts', zh: '自定义 system prompt' },
};

export function t(key: keyof typeof D  ): string {
  const entry = D[key];
  if (!entry) return key;
  return entry[_lang];
}
