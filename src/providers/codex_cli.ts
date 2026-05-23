import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { makeChildEnv, shellEnvSnapshot } from '../utils/env';
import type { Endpoint } from '../types';
import type { LLMProvider, ChatRequest, ChatChunk } from './types';

/**
 * `codex exec` integration.
 *
 * Two operating modes:
 * 1. Single-shot LLM (default): prompts are dispatched, we collect text replies. Codex's own
 *    agent tools (file edits, exec, etc) are *not* surfaced as tool calls — they happen inside
 *    the CLI and we just see the resulting text.
 * 2. Full agent (cliFullAgent=true): we forward Codex's stream-json events so its tool calls
 *    appear as tool cards in the Glossa UI. Approval policy + sandbox are configured via -c.
 *
 * STREAMING LIMITATION (codex 0.130.0):
 *   `codex exec --json` does NOT stream agent_message tokens. It emits a single
 *   `item.completed` event with the FULL text when the model finishes responding.
 *   So there's no token-by-token UI animation for codex prose — the message
 *   arrives in one chunk. We get streaming-like behavior only for:
 *     - item.started/completed events for tool calls (shown as cards live)
 *     - reasoning items (if codex chooses to surface them — config-dependent)
 *   For true token streaming the user should use a custom-api endpoint
 *   (OpenAI/Anthropic SSE). codex's design trades token streaming for
 *   richer agentic semantics (tool events, file changes, etc).
 */
export class CodexCliProvider implements LLMProvider {
  id: string;
  displayName: string;

  constructor(public ep: Endpoint) {
    this.id = ep.id;
    this.displayName = ep.label;
  }

  async isAvailable() {
    if (!this.ep.binaryPath) return false;
    try { fs.accessSync(this.ep.binaryPath, fs.constants.X_OK); return true; } catch { return false; }
  }
  defaultModel() { return this.ep.model ?? ''; }

  /** Spawn `codex --version` to verify the binary actually runs in our env. */
  async testConnect(): Promise<{ ok: boolean; message: string }> {
    if (!this.ep.binaryPath) return { ok: false, message: 'Binary path not set. Click auto or enter the absolute path.' };
    try { fs.accessSync(this.ep.binaryPath, fs.constants.X_OK); }
    catch { return { ok: false, message: `Cannot execute ${this.ep.binaryPath} — file missing or not +x.` }; }
    return new Promise(resolve => {
      let stdout = '', stderr = '';
      const proc = spawn(this.ep.binaryPath!, ['--version'], {
        env: makeChildEnv(), stdio: ['ignore', 'pipe', 'pipe'],
        cwd: this.ep.cwd && fs.existsSync(this.ep.cwd) ? this.ep.cwd : undefined,
      });
      const timer = setTimeout(() => { try { proc.kill('SIGTERM'); } catch {}; resolve({ ok: false, message: 'Timed out after 5s.' }); }, 5000);
      proc.stdout.on('data', d => stdout += d.toString());
      proc.stderr.on('data', d => stderr += d.toString());
      proc.on('error', e => { clearTimeout(timer); resolve({ ok: false, message: `spawn error: ${e.message}` }); });
      proc.on('exit', code => {
        clearTimeout(timer);
        if (code === 0) resolve({ ok: true, message: (stdout || stderr).trim().split('\n')[0] || 'OK' });
        else resolve({ ok: false, message: `exit ${code}: ${(stderr || stdout).trim().slice(0, 200)}` });
      });
    });
  }

  /** Deeper diagnostic — runs the actual `codex exec --json` pipeline against a tiny
   *  prompt and returns the full transcript so users can see WHY it's not producing
   *  output. Captures: version check, args sent, stdout JSON events, stderr stream,
   *  parsed text chunks, exit code, timing. */
  async runDiagnostic(opts?: { timeoutMs?: number; onEvent?: (line: string) => void }): Promise<{
    version: { ok: boolean; message: string };
    cwd: string;
    args: string[];
    env: {
      PATH?: string;
      HOME?: string;
      OPENAI_API_KEY?: string;
      HTTPS_PROXY?: string;
      HTTP_PROXY?: string;
      ALL_PROXY?: string;
      NO_PROXY?: string;
      // Where the proxy (if any) came from — helps differentiate
      // "user filled settings.globalProxy" vs "auto-captured from shell"
      // vs "still nothing".
      proxySource?: 'settings' | 'shell-rc' | 'none';
      shellProxyHTTPS?: string;
      shellProxyHTTP?: string;
    };
    stdout: string;
    stderr: string;
    exitCode: number | null;
    durationMs: number;
    parsedText: string;
    eventTimeline: { at: number; type: string; payload?: string }[];
    diagnosis: string;
  }> {
    const TIMEOUT = opts?.timeoutMs ?? 60_000;
    const version = await this.testConnect();
    const cwd = this.ep.cwd && fs.existsSync(this.ep.cwd) ? this.ep.cwd : (process.env.HOME || process.cwd());
    // If the user left the model field empty, DO NOT pass -m — codex uses
    // ~/.codex/config.toml's model. Overriding with a stale/invalid name causes
    // the request to silently hang (no error, just no agent_message).
    const model = (this.ep.model ?? '').trim();
    const args = ['exec', '--json', '--skip-git-repo-check'];
    if (model) args.push('-m', model);
    // Force reasoning_effort=low for the ping test so even xhigh-configured endpoints
    // return quickly. The user's normal config still applies in the actual sidebar runs.
    args.push('-c', 'sandbox_mode="read-only"',
              '-c', 'approval_policy="never"',
              '-c', 'model_reasoning_effort="low"');
    const explicitProxy = (this as any).__proxy as string | undefined;
    const childEnv = makeChildEnv(explicitProxy);
    const shellSnap = shellEnvSnapshot();
    const proxySource: 'settings' | 'shell-rc' | 'none' = explicitProxy
      ? 'settings'
      : (shellSnap.HTTPS_PROXY || shellSnap.HTTP_PROXY || shellSnap.https_proxy || shellSnap.http_proxy)
      ? 'shell-rc'
      : 'none';
    const envSnap = {
      PATH: childEnv.PATH,
      HOME: childEnv.HOME,
      OPENAI_API_KEY: childEnv.OPENAI_API_KEY ? '(set)' : undefined,
      // Proxy vars are the #1 reason codex hangs when launched from a GUI app
      // on macOS — surface them in the modal so the user can see whether our
      // shell-env loader actually picked them up.
      HTTPS_PROXY: childEnv.HTTPS_PROXY || childEnv.https_proxy,
      HTTP_PROXY: childEnv.HTTP_PROXY || childEnv.http_proxy,
      ALL_PROXY: childEnv.ALL_PROXY || childEnv.all_proxy,
      NO_PROXY: childEnv.NO_PROXY || childEnv.no_proxy,
      proxySource,
      shellProxyHTTPS: shellSnap.HTTPS_PROXY || shellSnap.https_proxy,
      shellProxyHTTP: shellSnap.HTTP_PROXY || shellSnap.http_proxy,
    };
    const started = Date.now();
    let stdout = '', stderr = '', parsedText = '';
    let exitCode: number | null = null;
    let spawnErr: string | null = null;
    const eventTimeline: { at: number; type: string; payload?: string }[] = [];
    let agentMessageReceived = false;

    await new Promise<void>(resolve => {
      let proc: ReturnType<typeof spawn>;
      try {
        proc = spawn(this.ep.binaryPath!, args, { cwd, env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] });
      } catch (e: any) {
        spawnErr = `Failed to spawn: ${e.message}`;
        resolve();
        return;
      }
      const killer = setTimeout(() => {
        try { proc.kill('SIGTERM'); } catch {}
        stderr += `\n[diagnostic timeout ${(TIMEOUT/1000)|0}s]`;
      }, TIMEOUT);
      // Idle-watchdog: if the agent message arrives, stop early (no need to wait full timeout).
      const earlyStop = () => { try { proc.kill('SIGTERM'); } catch {}; clearTimeout(killer); };

      let lineBuf = '';
      proc.stdout?.on('data', d => {
        const s = d.toString();
        stdout += s;
        lineBuf += s;
        const lines = lineBuf.split('\n');
        lineBuf = lines.pop() ?? '';
        for (const line of lines) {
          const l = line.trim();
          if (!l) continue;
          opts?.onEvent?.(l);
          try {
            const ev = JSON.parse(l);
            const evType = ev?.type ?? 'unknown';
            const itemType = ev?.item?.type;
            eventTimeline.push({
              at: Date.now() - started,
              type: itemType ? `${evType} · ${itemType}` : evType,
              payload: itemType === 'agent_message'
                ? (ev.item.text ?? '').slice(0, 120)
                : itemType === 'reasoning'
                ? (ev.item.text ?? '').slice(0, 120)
                : undefined,
            });
            // New canonical shape: item.completed { item: { type:'agent_message', text:'…' } }
            if ((evType === 'item.completed' || evType === 'item.updated') && itemType === 'agent_message') {
              if (typeof ev.item.text === 'string') parsedText = ev.item.text;
              if (evType === 'item.completed') { agentMessageReceived = true; setTimeout(earlyStop, 200); }
            }
            // Legacy fallback
            const legacy = ev?.delta?.text ?? ev?.text ?? ev?.msg?.text ?? ev?.content;
            if (typeof legacy === 'string' && !itemType) parsedText += legacy;
          } catch {}
        }
      });
      proc.stderr?.on('data', d => stderr += d.toString());
      proc.on('error', e => { spawnErr = `Process error: ${e.message}`; });
      proc.on('exit', c => { clearTimeout(killer); exitCode = c; resolve(); });
      try {
        proc.stdin?.write('Reply with the single word: pong\n');
        proc.stdin?.end();
      } catch (e: any) { spawnErr = `stdin write failed: ${e.message}`; }
    });

    const durationMs = Date.now() - started;

    // Authoritative cause if the stream emitted turn.failed / error
    let turnFailMsg: string | null = null;
    for (const line of stdout.split('\n')) {
      try {
        const ev = JSON.parse(line);
        if (ev?.type === 'turn.failed' && ev?.error?.message) { turnFailMsg = ev.error.message; break; }
        if (ev?.type === 'error' && ev?.message)              { turnFailMsg = ev.message; break; }
      } catch {}
    }
    // Only filter purely informational lines. The `failed to refresh available
    // models` line is NOT safe to drop wholesale — it carries the real auth
    // error (401 token_revoked) when the user's ChatGPT login has expired.
    // Drop the benign "timeout waiting for child process" variant only.
    const realStderr = stderr
      .split('\n')
      .filter(l => {
        const s = l.trim();
        if (/^Reading prompt from stdin/i.test(s)) return false;
        if (/^Sending request/i.test(s)) return false;
        if (/^Streaming/i.test(s)) return false;
        if (/^OpenAI Codex CLI/i.test(s)) return false;
        if (/failed to refresh available models: timeout waiting for child process/i.test(s)) return false;
        return true;
      })
      .join('\n')
      .trim();
    // Surface auth errors regardless of where they surface (stderr / stream / parsed text).
    const authErrorMatch =
      /token[_ ]?revoked|invalidated oauth token|401 unauthorized|auth error code:|oauth.+expired/i.test(stderr) ||
      /token[_ ]?revoked|invalidated oauth token|401 unauthorized|auth error code:|oauth.+expired/i.test(stdout);

    const haveProxy = !!(envSnap.HTTPS_PROXY || envSnap.HTTP_PROXY || envSnap.ALL_PROXY);
    let diagnosis = '';
    if (spawnErr) {
      diagnosis = `❌ ${spawnErr}\n\nThe codex binary path is wrong, or it's not executable from Obsidian's spawn environment.`;
    } else if (!version.ok) {
      diagnosis = `❌ Version check failed: ${version.message}`;
    } else if (authErrorMatch) {
      // Auth error takes precedence over the surface "Reconnecting..." network
      // error — the reconnect cascade is downstream of the 401 token_revoked.
      diagnosis = `❌ codex's ChatGPT OAuth token is invalid (revoked or expired).\n\n` +
                  `Fix — run in a terminal:\n` +
                  `  codex logout && codex login\n\n` +
                  `This usually happens when you logged into codex from another machine, your ChatGPT account was logged out from the web, or the token simply expired.`;
    } else if (turnFailMsg) {
      diagnosis = `❌ Turn failed: ${turnFailMsg}`;
      // The "Reconnecting... N/5" pattern is codex retrying a network call.
      // When launched from Obsidian on macOS, this almost always means we
      // failed to inherit the user's HTTPS_PROXY from ~/.zshrc — GUI apps
      // don't load shell rc files.
      if (/reconnect|timeout.+child process|network|connection|tls|dns/i.test(turnFailMsg)) {
        diagnosis += `\n\n`;
        if (!haveProxy) {
          diagnosis += `🔍 No proxy is reaching codex. The request is going direct to OpenAI and timing out.\n\n` +
                       `Quick fix (NO restart needed):\n` +
                       `  Settings → Network → Proxy\n` +
                       `  → fill in e.g.  http://127.0.0.1:7890  (your local proxy port)\n` +
                       `  → next Diagnose / chat picks it up immediately\n\n` +
                       `Alternative: if you'd rather not touch settings and have HTTPS_PROXY in ~/.zshrc, ` +
                       `reload the plugin (Settings → Community plugins → toggle off & on) — we snapshot the login shell's env on startup.`;
        } else {
          diagnosis += `🔍 Proxy IS injected (${envSnap.HTTPS_PROXY || envSnap.HTTP_PROXY || envSnap.ALL_PROXY}) but codex still can't connect.\n\n` +
                       `Verify the proxy itself works:\n` +
                       `  curl -x ${envSnap.HTTPS_PROXY || envSnap.HTTP_PROXY} -o /dev/null -s -w '%{http_code}\\n' https://api.openai.com/v1/models\n\n` +
                       `Expected: 401 (reachable, just needs auth — OK). If it hangs or returns 000, your proxy upstream is down.`;
        }
      }
    } else if (parsedText.toLowerCase().includes('pong')) {
      diagnosis = `✅ codex ran end-to-end ${model ? `with model "${model}"` : '(using codex config default model)'} in ${durationMs}ms (forced low reasoning for the probe).`;
    } else if (parsedText) {
      diagnosis = `✅ codex replied ${model ? `(model "${model}", ` : '('}${durationMs}ms) but didn't say "pong":\n${parsedText.slice(0, 200)}`;
    } else if (/thread\.started/.test(stdout) && !agentMessageReceived) {
      // Thread started but no agent_message — most likely we forced a model the
      // user's account doesn't have access to, or codex is silently waiting on auth/network.
      diagnosis = `⚠ codex started a thread but didn't produce an agent_message in ${(TIMEOUT/1000)|0}s.\n\n`;
      if (model) {
        diagnosis += `We passed \`-m ${model}\`, which OVERRIDES your ~/.codex/config.toml's model.\n` +
                     `If your config.toml uses a different model (e.g. gpt-5.5) and that's the one that works, ` +
                     `clear the "Model" field in this endpoint's settings — codex will then use its own config default and stop hanging.`;
      } else {
        diagnosis += `We did not pass -m (using your codex config's default model).\n` +
                     (realStderr
                       ? `stderr says:\n${realStderr.slice(0, 400)}`
                       : `No stderr. Likely auth/network — try \`codex login\` in a terminal, or check that \`codex exec\` works manually.`);
      }
    } else if (exitCode !== 0 && !parsedText) {
      diagnosis = `❌ codex exited ${exitCode} with no agent message.\n\nstderr: ${realStderr || '(empty)'}\n`;
      if (/auth|login|token|api[_ ]?key/i.test(realStderr)) diagnosis += `Likely an AUTH issue. Run \`codex login\` in a terminal, then retry.`;
      else if (/unknown.+model|model.+not.+found/i.test(realStderr)) diagnosis += `The model name "${model}" is not recognised by codex.`;
      else if (!realStderr) diagnosis += `codex died silently. Probably an arg-parsing issue — check the args below.`;
    } else {
      diagnosis = `⚠ Inconclusive. exit=${exitCode}, stdout=${stdout.length} bytes, stderr=${realStderr.length} bytes, parsedText=${parsedText.length} chars.`;
    }

    return { version, cwd, args, env: envSnap, stdout, stderr, exitCode, durationMs, parsedText, eventTimeline, diagnosis };
  }

  async *stream(req: ChatRequest): AsyncGenerator<ChatChunk> {
    if (!await this.isAvailable()) {
      yield { type: 'error', error: 'codex binary not found; set its absolute path in settings.' };
      return;
    }

    // Default to the app-server JSON-RPC protocol (token-level streaming).
    // Codex 0.130+ exposes this via `codex app-server --listen stdio://` —
    // same protocol its TUI uses. Users can opt out with codexUseAppServer=false
    // if they hit a regression.
    if (this.ep.codexUseAppServer !== false) {
      const { streamViaAppServer } = await import('./codex_app_server');
      yield* streamViaAppServer(this.ep, req, (this as any).__proxy, (this as any).__fallbackCwd);
      return;
    }

    const args: string[] = ['exec', '--json', '--skip-git-repo-check'];
    // Only pass -m when the user explicitly set a model in the endpoint.
    // Otherwise codex uses ~/.codex/config.toml's model — overriding with a
    // stale/wrong name causes silent hangs (no error, no agent_message).
    const modelArg = (req.model ?? this.ep.model ?? '').trim();
    if (modelArg) args.push('-m', modelArg);
    if (this.ep.codexUseOss) args.push('--oss');

    // Sandbox + approval.
    // SECURITY: non-fullAgent → force read-only + never (prompt-side constraint AND policy).
    // SECURITY: fullAgent default approval=never (because we don't have a real stdin bridge
    //   — see comment below). Caller can override explicitly in settings.
    const sandbox = this.ep.cliFullAgent
      ? (this.ep.codexSandboxMode ?? 'workspace-write')
      : 'read-only';
    const approval = this.ep.cliFullAgent
      ? (this.ep.codexApprovalPolicy ?? 'never')        // changed from 'on-request' to avoid hang
      : 'never';
    args.push('-c', `sandbox_mode="${sandbox}"`);
    args.push('-c', `approval_policy="${approval}"`);

    // Unified reasoning-effort knob → codex's -c model_reasoning_effort=<value>.
    // Codex accepts low/medium/high/xhigh natively (see model_reasoning_effort in codex docs).
    if (this.ep.reasoningEffort && this.ep.reasoningEffort !== 'off') {
      args.push('-c', `model_reasoning_effort="${this.ep.reasoningEffort}"`);
    }

    // Free-form config overrides (one per line "key=value")
    for (const line of (this.ep.codexConfigOverrides ?? '').split('\n')) {
      const trimmed = line.trim();
      if (trimmed && trimmed.includes('=')) args.push('-c', trimmed);
    }

    // Attached images: write data URIs to temp files, pass via --image
    const tempImageFiles: string[] = [];
    for (const img of (req.attachedImages ?? [])) {
      try {
        const m = img.dataUri.match(/^data:([^;]+);base64,(.+)$/);
        if (!m) continue;
        const ext = (m[1].split('/')[1] ?? 'png').replace(/[^a-z0-9]/gi, '');
        const tmp = path.join(os.tmpdir(), `glossa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`);
        fs.writeFileSync(tmp, Buffer.from(m[2], 'base64'));
        tempImageFiles.push(tmp);
        args.push('--image', tmp);
      } catch (e) { console.warn('[Glossa] codex image attach failed', e); }
    }

    for (const a of (this.ep.cliExtraArgs ?? [])) args.push(a);

    let prompt: string;
    if (this.ep.cliFullAgent) {
      // Forward everything as-is; let codex do its agent thing
      prompt = serializeMessages(req);
    } else {
      // Single-shot: prepend a stern instruction to discourage tool use
      const single = `You are responding inside an Obsidian sidebar. Respond with text only. Do NOT execute commands, write files, or call any tools.\n\n`;
      prompt = single + serializeMessages(req);
    }

    // Validate cwd — passing a non-existent path to spawn() throws synchronously and
    // the user just sees nothing. Fall back to vault root / $HOME if invalid.
    let cwd: string | undefined = this.ep.cwd && fs.existsSync(this.ep.cwd) ? this.ep.cwd : undefined;
    if (!cwd) cwd = (this as any).__fallbackCwd;
    if (!cwd || !fs.existsSync(cwd)) cwd = process.env.HOME || process.cwd();

    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(this.ep.binaryPath!, args, {
        cwd,
        env: makeChildEnv((this as any).__proxy),
      });
    } catch (e: any) {
      yield { type: 'error', error: `Failed to spawn codex: ${e.message ?? e}\nBinary: ${this.ep.binaryPath}\ncwd: ${cwd}` };
      return;
    }
    let earlySpawnError: string | null = null;
    proc.on('error', (e: any) => { earlySpawnError = `codex spawn error: ${e.message ?? e}`; });

    try { proc.stdin.write(prompt); } catch (e: any) {
      yield { type: 'error', error: `codex stdin write failed: ${e.message ?? e}\nCheck binaryPath + cwd in settings, and try the Test button.` };
      return;
    }
    // ALWAYS close stdin after writing the prompt. `codex exec` is one-shot —
    // it reads stdin to EOF, processes the prompt, streams the reply, exits.
    // Leaving stdin open made codex wait forever for more input ("nothing in
    // sidebar" symptom). The old fullAgent branch did not close stdin, which
    // was a bug — we never actually used the stdin bridge for follow-up messages.
    proc.stdin.end();
    // Hook abort → SIGTERM, but keep a handle so we can remove the listener at
    // end-of-stream. Without this, if the same AbortController is reused across
    // turns (consumer code can reasonably do this), listeners pile up and each
    // abort fires N kill() calls + N noisy errors in console.
    const onAbort = () => { try { proc.kill('SIGTERM'); } catch {} };
    req.signal?.addEventListener('abort', onAbort);

    // Per-request debug log gated by a settings flag — quiet by default, helpful
    // when the sidebar shows nothing and we need to see what codex is emitting.
    const debug = !!(this.ep as any).cliDebug;
    if (debug) {
      console.log('[Glossa] codex spawn:', { args, cwd, modelArg, promptLen: prompt.length, fullAgent: !!this.ep.cliFullAgent });
    }

    let buf = '';
    let bufText = '';
    let stderrBuf = '';
    proc.stderr.on('data', (d) => stderrBuf += d.toString());

    const callIdFromAny = (ev: any): string =>
      ev?.id || ev?.call_id || ev?.msg?.call_id || ev?.tool_call_id || `${Date.now()}_${Math.random().toString(36).slice(2,7)}`;

    /* Codex 0.x stream-json events (canonical schema in
     * codex-rs/exec/src/exec_events.rs). Shapes:
     *   { "type": "thread.started", "thread_id": "..." }
     *   { "type": "turn.started" }
     *   { "type": "item.started",   "item": { "id":"…", "type":"reasoning|agent_message|command_execution|...", ... } }
     *   { "type": "item.updated",   "item": { ... } }
     *   { "type": "item.completed", "item": { ... } }
     *   { "type": "turn.completed", "usage": { ... } }
     *   { "type": "turn.failed",    "error": { "message": "..." } }
     *   { "type": "error",          "message": "..." }
     *
     * Item.details flattened — so a completed agent message looks like:
     *   { type:"item.completed", item:{ id:"…", type:"agent_message", text:"…" } }
     * Reasoning: item.type === "reasoning", item.text === "…"
     * Commands: item.type === "command_execution", item.command, item.exit_code, item.aggregated_output, item.status
     */

    // Per-item streamed-text buffers. Codex emits the same content across
    // item.started → item.updated → item.completed for the same `item.id`, so
    // without per-id tracking we'd double-yield (e.g. reasoning text appearing
    // N times). Yield only the delta vs. what we've already streamed for that id.
    const agentMsgBufs = new Map<string, string>();
    const reasoningBufs = new Map<string, string>();
    let turnFailedMessage: string | null = null;
    // Captured usage from `turn.completed` events. Codex emits one of these
    // per turn with `{ usage: { input_tokens, output_tokens, cached_tokens, ... } }`
    // — without this, the cost bar always showed 0 for codex sessions and
    // users couldn't tell how much they'd spent.
    let capturedUsage: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } | null = null;

    for await (const chunk of proc.stdout as any) {
      buf += chunk.toString('utf-8');
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const s = line.trim();
        if (!s) continue;
        let ev: any; try { ev = JSON.parse(s); } catch { continue; }
        const evType: string | undefined = ev?.type;
        if (debug) console.log('[Glossa] codex ev:', evType, ev?.item?.type ?? '', JSON.stringify(ev).slice(0, 200));

        if (evType === 'turn.failed') {
          turnFailedMessage = ev?.error?.message ?? 'codex turn failed without message';
          continue;
        }
        if (evType === 'error') {
          turnFailedMessage = ev?.message ?? 'codex stream error';
          continue;
        }
        if (evType === 'turn.completed') {
          // Capture token usage so the cost bar reflects what the turn actually
          // consumed. Codex's schema:
          //   { type: 'turn.completed', usage: { input_tokens, output_tokens, cached_input_tokens } }
          // older builds also emitted `cached_tokens` / `prompt_tokens`. Accept both.
          const u = ev?.usage ?? {};
          capturedUsage = {
            input: typeof u.input_tokens === 'number' ? u.input_tokens
                 : typeof u.prompt_tokens === 'number' ? u.prompt_tokens
                 : undefined,
            output: typeof u.output_tokens === 'number' ? u.output_tokens
                  : typeof u.completion_tokens === 'number' ? u.completion_tokens
                  : undefined,
            cacheRead: typeof u.cached_input_tokens === 'number' ? u.cached_input_tokens
                     : typeof u.cached_tokens === 'number' ? u.cached_tokens
                     : undefined,
            cacheWrite: typeof u.cache_creation_input_tokens === 'number' ? u.cache_creation_input_tokens
                      : undefined,
          };
          continue;
        }

        // Item-based events — the new canonical shape
        if (evType === 'item.started' || evType === 'item.updated' || evType === 'item.completed') {
          const item = ev.item ?? {};
          const itemType: string = item.type ?? 'unknown';
          const id: string = item.id ?? `${Date.now()}_${Math.random().toString(36).slice(2,7)}`;

          if (itemType === 'agent_message') {
            const text: string = item.text ?? '';
            const prev = agentMsgBufs.get(id) ?? '';
            if (text.length > prev.length && text.startsWith(prev)) {
              const delta = text.slice(prev.length);
              yield { type: 'text', text: delta };
              agentMsgBufs.set(id, text);
              bufText += delta;
            } else if (text && !text.startsWith(prev)) {
              // Divergent rewrite (model corrected itself mid-stream). REPLACE
              // — don't accumulate. Previously we yielded the full new text AND
              // appended it to bufText (which already held `prev`), so the UI
              // displayed prev + text (double-emit). Now we yield only the
              // characters that differ from prev (or full text if shorter) and
              // bufText absorbs the replacement, not addition.
              yield { type: 'text', text };
              agentMsgBufs.set(id, text);
              // Net change: replace prev (length bufText was carrying) with new text
              bufText = bufText.slice(0, bufText.length - prev.length) + text;
            }
            continue;
          }

          if (itemType === 'reasoning') {
            const text: string = item.text ?? '';
            const prev = reasoningBufs.get(id) ?? '';
            if (text.length > prev.length && text.startsWith(prev)) {
              const delta = text.slice(prev.length);
              yield { type: 'reasoning', text: delta };
              reasoningBufs.set(id, text);
            } else if (text && !text.startsWith(prev)) {
              yield { type: 'reasoning', text };
              reasoningBufs.set(id, text);
            }
            continue;
          }

          if (!this.ep.cliFullAgent) continue;

          // Tool-like items only surface when full-agent mode is on
          if (itemType === 'command_execution') {
            const status = evType === 'item.completed'
              ? (item.exit_code === 0 ? 'success' : 'error')
              : 'running';
            yield {
              type: 'tool_event', id, name: 'bash',
              args: { command: item.command },
              status,
              result: String(item.aggregated_output ?? '').slice(0, 4000),
            };
            continue;
          }
          if (itemType === 'file_change') {
            yield {
              type: 'tool_event', id, name: 'file_change',
              args: { changes: item.changes ?? [] },
              status: evType === 'item.completed' ? 'success' : 'running',
            };
            continue;
          }
          if (itemType === 'mcp_tool_call' || itemType === 'collab_tool_call') {
            yield {
              type: 'tool_event', id, name: item.server ? `${item.server}__${item.tool ?? itemType}` : itemType,
              args: item.arguments ?? {},
              status: evType === 'item.completed' ? (item.error ? 'error' : 'success') : 'running',
              result: String(item.output ?? item.error ?? '').slice(0, 4000),
            };
            continue;
          }
          if (itemType === 'web_search') {
            yield {
              type: 'tool_event', id, name: 'web_search',
              args: { query: item.query },
              status: evType === 'item.completed' ? 'success' : 'running',
            };
            continue;
          }
          if (itemType === 'todo_list') {
            yield {
              type: 'tool_event', id, name: 'todo_list',
              args: { items: item.items ?? [] },
              status: evType === 'item.completed' ? 'success' : 'running',
            };
            continue;
          }
          if (itemType === 'error') {
            yield {
              type: 'tool_event', id, name: 'error',
              args: {}, status: 'error',
              result: String(item.message ?? 'unknown error').slice(0, 4000),
            };
            continue;
          }
        }

        // Legacy fallback: very old codex (< 0.x) used flat 'delta'/'chunk'/'message' events.
        const legacyText = ev?.delta?.text ?? ev?.text ?? ev?.msg?.text ?? ev?.content;
        if (typeof legacyText === 'string' && evType) {
          if (/delta|chunk/.test(evType)) {
            yield { type: 'text', text: legacyText }; bufText += legacyText;
          } else if (/(agent_message|message)$/.test(evType) && !bufText) {
            yield { type: 'text', text: legacyText }; bufText += legacyText;
          }
        }
      }
    }
    // Close stdin now that the stream finished (fullAgent kept it open earlier).
    try { if (!proc.stdin.destroyed) proc.stdin.end(); } catch {}
    const code = await new Promise<number>(res => proc.on('close', c => res(c ?? -1)));
    // Remove the abort listener and stream listeners now that we're done — keep
    // the AbortController reusable across turns without leaking handlers.
    req.signal?.removeEventListener('abort', onAbort);
    proc.stdout?.removeAllListeners();
    proc.stderr?.removeAllListeners();
    // Cleanup temp images
    for (const f of tempImageFiles) { try { fs.unlinkSync(f); } catch {} }
    if (earlySpawnError) {
      yield { type: 'error', error: earlySpawnError + '\nHint: click the "Test" button on the endpoint card to verify the binary is reachable from Obsidian.' };
      return;
    }
    if (turnFailedMessage) {
      yield { type: 'error', error: `codex turn failed: ${turnFailedMessage}` };
      return;
    }
    // Filter known info-level stderr lines so they don't masquerade as errors.
    // Codex prints "Reading prompt from stdin..." and a few other progress lines on stderr.
    const realStderr = stderrBuf
      .split('\n')
      .filter(line => {
        const s = line.trim();
        if (!s) return false;
        if (/^Reading prompt from stdin/i.test(s)) return false;
        if (/^Sending request/i.test(s)) return false;
        if (/^Streaming/i.test(s)) return false;
        if (/^OpenAI Codex CLI/i.test(s)) return false;
        return true;
      })
      .join('\n')
      .trim();
    if (code !== 0 && !bufText) {
      yield { type: 'error', error:
        `codex exited with code ${code} and no output.\n\n` +
        `stderr: ${realStderr.slice(0, 600) || '(empty)'}\n\n` +
        `Hint: this often means codex needs auth (run \`codex login\` in a terminal once), ` +
        `or the model name "${req.model ?? this.ep.model}" is unknown to codex. Click "Test" on the endpoint card to verify the binary itself works.` };
      return;
    }
    // Only surface stderr-as-error when it's substantive (not just info noise).
    if (!bufText && realStderr) {
      yield { type: 'error', error: `codex produced no output. stderr:\n${realStderr.slice(0, 600)}` };
      return;
    }
    // Surface accumulated usage if any turn.completed event carried it.
    // (Set by the event-parser loop above when it encounters turn.completed
    // or item.completed{type:'usage'}; see capturedUsage initialization.)
    yield { type: 'final', text: bufText, usage: capturedUsage ?? undefined };
  }
}

function serializeMessages(req: ChatRequest): string {
  const parts: string[] = [];
  if (req.systemPrompt) parts.push(`[System]\n${req.systemPrompt}\n`);
  for (const m of req.messages) {
    const role = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : 'Tool';
    parts.push(`[${role}]\n${m.content}\n`);
  }
  return parts.join('\n');
}
