import { execSync, execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const execFileAsync = promisify(execFile);

const EXTRA_PATHS = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  path.join(os.homedir(), '.local/bin'),
  path.join(os.homedir(), '.cargo/bin'),
  path.join(os.homedir(), '.npm-global/bin'),
  path.join(os.homedir(), 'go/bin'),
  path.join(os.homedir(), '.bun/bin'),
];

/* GUI apps on macOS don't load ~/.zshrc, so any proxy / env vars the user set
 * there are invisible to subprocesses we spawn (codex hangs trying to reach
 * OpenAI directly when the user actually routes traffic through a local
 * proxy). To recover those vars we run a login shell once at startup and
 * snapshot its environment.
 *
 * Whitelist is intentionally narrow — we don't want to leak random session
 * state (SSH agents, shell history, locale tweaks) into every spawn. Anything
 * a network-bound CLI typically reads belongs here. */
const SHELL_ENV_WHITELIST = new Set([
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
  'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
  'OPENAI_API_KEY', 'OPENAI_BASE_URL',
  'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL',
  'LANG', 'LC_ALL', 'LC_CTYPE',
  'SSL_CERT_FILE', 'NODE_EXTRA_CA_CERTS',
  // Codex CLI itself respects these
  'CODEX_HOME', 'XDG_CONFIG_HOME',
]);

let _shellEnvCache: NodeJS.ProcessEnv | null = null;
let _shellEnvPromise: Promise<NodeJS.ProcessEnv> | null = null;

/** Async capture of the user's login-shell env. Whitelist-filtered, cached.
 *  Returns immediately if already loaded; first caller kicks off the actual
 *  subprocess. macOS GUI apps don't load .zshrc, so this is how we recover
 *  HTTPS_PROXY etc. for spawned CLIs. */
export function loadShellEnv(): Promise<NodeJS.ProcessEnv> {
  if (_shellEnvCache) return Promise.resolve(_shellEnvCache);
  if (_shellEnvPromise) return _shellEnvPromise;
  _shellEnvPromise = (async () => {
    try {
      const shell = process.env.SHELL ?? '/bin/zsh';
      // -i sources .zshrc (where proxy lives for most users), -l also sources
      // .zprofile/.zlogin. Both together is maximally generous.
      const { stdout } = await execFileAsync(shell, ['-lic', 'env'], {
        timeout: 4000,
        maxBuffer: 256 * 1024,
        encoding: 'utf-8',
      });
      const out: NodeJS.ProcessEnv = {};
      for (const line of stdout.split('\n')) {
        const eq = line.indexOf('=');
        if (eq <= 0) continue;
        const k = line.slice(0, eq);
        const v = line.slice(eq + 1);
        if (SHELL_ENV_WHITELIST.has(k)) out[k] = v;
      }
      _shellEnvCache = out;
      return out;
    } catch {
      _shellEnvCache = {};
      return _shellEnvCache;
    }
  })();
  return _shellEnvPromise;
}

/** Snapshot of what loadShellEnv found, for debugging surfaces.
 *  Returns the cached shell env (possibly empty if loadShellEnv hasn't
 *  resolved yet). makeChildEnv uses this synchronously so spawn paths stay sync. */
export function shellEnvSnapshot(): NodeJS.ProcessEnv { return _shellEnvCache ?? {}; }

/**
 * Augmented PATH for subprocesses launched from Electron's renderer.
 *
 * Order of precedence (later overrides earlier):
 *   1. process.env (Electron renderer's env — usually thin on macOS GUI)
 *   2. shell env (proxy / API keys from ~/.zshrc, loaded once at startup)
 *   3. explicit `proxy` arg (highest priority — user override from settings)
 *
 * Always augments PATH with common bin dirs and forces HOME to os.homedir().
 */
/** Env vars that grant API access to the LLM provider. Spawning the official
 *  codex / claude CLIs requires these; spawning a third-party MCP server does
 *  NOT — and leaking them there would let a malicious or careless server
 *  exfiltrate the user's key. Keep this list narrow. */
const LLM_CREDENTIAL_KEYS = new Set([
  'OPENAI_API_KEY', 'OPENAI_BASE_URL',
  'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL',
]);

export function makeChildEnv(proxy?: string): NodeJS.ProcessEnv {
  const cur = process.env.PATH ?? '';
  const augmented = [...new Set([...EXTRA_PATHS, ...cur.split(':')])].filter(Boolean).join(':');
  // Synchronous: use whatever the shell-env loader has cached so far. If
  // loadShellEnv() hasn't resolved yet on first spawn, we get an empty merge —
  // not the end of the world (user can fall back to manual globalProxy). The
  // plugin onload kicks off the load, so by the time the user sends a real
  // message, the cache is warm.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...shellEnvSnapshot(),
    PATH: augmented,
    HOME: os.homedir(),
  };
  if (proxy) {
    env.HTTP_PROXY = proxy;
    env.HTTPS_PROXY = proxy;
    env.ALL_PROXY = proxy;
    env.http_proxy = proxy;
    env.https_proxy = proxy;
    env.all_proxy = proxy;
    // Don't proxy local
    env.NO_PROXY = (env.NO_PROXY ? env.NO_PROXY + ',' : '') + 'localhost,127.0.0.1';
    env.no_proxy = env.NO_PROXY;
  }
  return env;
}

/** Whitelist of env vars an MCP server is allowed to inherit from the user
 *  shell. Anything OUTSIDE this list is stripped before spawn — so secrets
 *  the user keeps in their shell (GITHUB_TOKEN, AWS_*, SLACK_*, GOOGLE_API_KEY,
 *  DEEPSEEK_API_KEY, …) cannot be exfiltrated by a malicious or careless MCP
 *  server. Per-server `cfg.env` is still applied AFTER this filter so users
 *  can explicitly opt back into forwarding a key when they trust a specific
 *  server (e.g. a Slack server they wrote themselves).
 *
 *  This list intentionally only includes process plumbing — PATH, HOME,
 *  locale, proxy. Adding API-key shapes here would defeat the point.
 *
 *  Replaces the prior denylist (LLM_CREDENTIAL_KEYS), which was a 4-entry
 *  blacklist that missed dozens of common third-party API keys. */
const MCP_ENV_ALLOWLIST = new Set([
  // Process plumbing
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TEMP', 'TMP',
  // Locale
  'LANG', 'LC_ALL', 'LC_CTYPE', 'LC_TIME', 'LC_COLLATE',
  // TLS / certs (some servers need these to talk to enterprise CAs)
  'SSL_CERT_FILE', 'NODE_EXTRA_CA_CERTS',
  // Node runtime knobs (--max-old-space-size etc.)
  'NODE_OPTIONS', 'NODE_PATH',
  // Proxy (we OVERRIDE these explicitly below when a proxy arg is passed)
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
  'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
  // Terminal / display (some servers detect TTY for output formatting)
  'TERM', 'COLORTERM', 'DISPLAY',
  // Windows equivalents
  'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMFILES', 'PROGRAMDATA', 'SYSTEMROOT', 'COMSPEC',
]);

/** Env for spawning a third-party MCP server.
 *
 *  Allowlist-based (a flip from the prior denylist of just 4 LLM keys):
 *  only env vars in MCP_ENV_ALLOWLIST inherit from the parent process /
 *  shell snapshot. Secrets (GITHUB_TOKEN, AWS_SECRET_ACCESS_KEY,
 *  SLACK_TOKEN, GOOGLE_API_KEY, GROQ_API_KEY, DEEPSEEK_API_KEY, …) stay in
 *  the parent and never reach the child. Per-server `cfg.env` is applied
 *  by the caller AFTER this — so a user who trusts a specific MCP server
 *  can still explicitly forward a secret to it. */
export function makeChildEnvForMcp(proxy?: string): NodeJS.ProcessEnv {
  // Start from the full augmented env (so PATH/proxy logic is unified) then
  // filter aggressively.
  const full = makeChildEnv(proxy);
  const filtered: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(full)) {
    if (MCP_ENV_ALLOWLIST.has(k)) filtered[k] = v;
  }
  // makeChildEnv already augmented PATH and set HOME; both are in the allowlist
  // so they survive the filter.
  return filtered;
}

export function resolveBinary(name: string): string | null {
  for (const dir of EXTRA_PATHS) {
    const p = path.join(dir, name);
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* ignore */ }
  }
  try {
    const shell = process.env.SHELL ?? '/bin/zsh';
    const out = execSync(`${shell} -ilc 'command -v ${name}'`, { encoding: 'utf-8', timeout: 4000 }).trim();
    if (out && out.startsWith('/') && fs.existsSync(out)) return out;
  } catch { /* ignore */ }
  return null;
}
