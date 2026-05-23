/**
 * `codex app-server --listen stdio://` integration.
 *
 * Codex's TUI / desktop app use this JSON-RPC protocol (newline-delimited JSON
 * over stdio) instead of `codex exec --json`. The crucial difference is that
 * app-server emits token-level delta notifications:
 *
 *   - item/agentMessage/delta        → token-stream the visible prose
 *   - item/reasoning/textDelta       → token-stream the reasoning trace
 *   - item/reasoning/summaryTextDelta
 *   - item/commandExecution/outputDelta → live bash output
 *   - item/started / item/completed  → tool lifecycle (same as exec --json)
 *   - turn/started / turn/completed
 *
 * So a Glossa sidebar chat now feels exactly like codex's native TUI —
 * tokens flowing in real time instead of one big chunk on completion.
 *
 * Wire format (verified empirically against codex 0.130.0):
 *   - Send JSON-RPC messages line-delimited: `{"jsonrpc":"2.0","id":N,"method":..,"params":..}\n`
 *   - Receive line-delimited JSON. Each line is either a response (has `id`)
 *     or a notification (has `method` but no `id`).
 *
 * Lifecycle per stream() call:
 *   1. Spawn `codex app-server --listen stdio://`
 *   2. `initialize` request → wait response
 *   3. `thread/start` request → get fresh threadId
 *   4. `turn/start` with serialized history → triggers the conversation turn
 *   5. Consume notifications until `turn/completed` (or error)
 *   6. Kill subprocess
 *
 * V1 spawns a fresh app-server per turn (same model as legacy `codex exec`).
 * Future enhancement: keep app-server alive per ChatSession and reuse the
 * threadId across turns — that would unlock codex's own session caching.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { makeChildEnv } from '../utils/env';
import type { Endpoint } from '../types';
import type { ChatRequest, ChatChunk } from './types';

/** A pending JSON-RPC request awaiting its response. */
interface Pending {
  resolve: (result: any) => void;
  reject: (err: Error) => void;
}

/** Codex app-server sandbox mode strings — match what `codex exec` accepts. */
type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

interface AppServerOptions {
  binaryPath: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  configOverrides: string[];     // `key=value` pairs passed as repeated `-c`
  debug: boolean;
}

/** A minimal JSON-RPC client over stdio for codex app-server. */
class AppServerClient {
  private proc: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private buf = '';
  private notifyHandler: ((method: string, params: any) => void) | null = null;
  private errorHandler: ((err: Error) => void) | null = null;
  private stderrTail = '';
  private debug: boolean;
  closed = false;

  constructor(opts: AppServerOptions) {
    this.debug = opts.debug;
    const args = ['app-server', '--listen', 'stdio://'];
    for (const kv of opts.configOverrides) args.push('-c', kv);
    this.proc = spawn(opts.binaryPath, args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;

    this.proc.stdout.on('data', (chunk) => this.onStdout(chunk.toString('utf-8')));
    this.proc.stderr.on('data', (chunk) => {
      const s = chunk.toString('utf-8');
      this.stderrTail = (this.stderrTail + s).slice(-2000);
      if (this.debug) console.log('[Glossa] codex app-server stderr:', s);
    });
    this.proc.on('exit', (code) => {
      this.closed = true;
      // Fail any pending requests with a useful message.
      for (const [, p] of this.pending) {
        p.reject(new Error(`codex app-server exited (code=${code}) before response. stderr tail: ${this.stderrTail.slice(-400)}`));
      }
      this.pending.clear();
    });
    this.proc.on('error', (e) => {
      if (this.errorHandler) this.errorHandler(e);
    });
  }

  /** Parse newline-delimited JSON from stdout, dispatch to pending/notify. */
  private onStdout(s: string) {
    this.buf += s;
    let i: number;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      let msg: any;
      try { msg = JSON.parse(line); }
      catch (e) {
        if (this.debug) console.warn('[Glossa] non-JSON app-server line:', line.slice(0, 200));
        continue;
      }
      // JSON-RPC response: has `id` and (`result` or `error`)
      if (msg.id != null && (msg.result !== undefined || msg.error !== undefined)) {
        const p = this.pending.get(msg.id);
        if (!p) {
          if (this.debug) console.warn('[Glossa] orphan response id', msg.id);
          continue;
        }
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`${msg.error.message ?? 'rpc error'} (code=${msg.error.code ?? '?'})`));
        else p.resolve(msg.result);
        continue;
      }
      // JSON-RPC notification or server-initiated request
      if (msg.method) {
        if (this.debug) console.log('[Glossa] app-server notif:', msg.method);
        // Server-initiated request (has id) — auto-acknowledge with empty result
        // so codex doesn't block waiting for approval. Approvals are NOT
        // surfaced as interactive prompts in v1 (sandbox already constrains).
        if (msg.id != null) {
          this.send({ jsonrpc: '2.0', id: msg.id, result: this.autoAck(msg.method) });
          continue;
        }
        if (this.notifyHandler) this.notifyHandler(msg.method, msg.params ?? {});
      }
    }
  }

  /** Provide a reasonable default response for server-initiated approval requests. */
  private autoAck(method: string): any {
    // Default: allow / approve. Sandbox already limits damage in non-fullAgent mode.
    // For commandExecution/fileChange/applyPatch approval reviews, we say "allow".
    if (/approval|approveGuardian/i.test(method)) return { decision: 'approve' };
    return null;
  }

  setNotifyHandler(fn: (method: string, params: any) => void) { this.notifyHandler = fn; }
  setErrorHandler(fn: (err: Error) => void) { this.errorHandler = fn; }

  /** Send a request, await response. */
  request<T = any>(method: string, params: any, timeoutMs = 120_000): Promise<T> {
    if (this.closed) return Promise.reject(new Error('app-server closed'));
    return new Promise<T>((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`${method} timeout after ${timeoutMs}ms`));
        }
      }, timeoutMs);
      // Wrap resolve/reject to clear timer
      const orig = this.pending.get(id)!;
      this.pending.set(id, {
        resolve: (r) => { clearTimeout(timer); orig.resolve(r); },
        reject: (e) => { clearTimeout(timer); orig.reject(e); },
      });
      try { this.send({ jsonrpc: '2.0', id, method, params }); }
      catch (e: any) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }

  /** Send a notification (no id, no response). */
  notify(method: string, params: any) {
    this.send({ jsonrpc: '2.0', method, params });
  }

  private send(obj: any) {
    const line = JSON.stringify(obj) + '\n';
    if (!this.proc.stdin.writable) throw new Error('app-server stdin not writable');
    this.proc.stdin.write(line);
  }

  kill() {
    if (this.closed) return;
    try { this.proc.kill('SIGTERM'); } catch {}
    this.closed = true;
  }
}

/** Serialize the chat request as a single user-input text block. Codex sees
 *  this as the whole turn input (history is folded in since we spawn a fresh
 *  thread per call). Same shape `codex exec` saw via stdin pipe. */
function serializeAsTurnInput(req: ChatRequest): string {
  const parts: string[] = [];
  if (req.systemPrompt) parts.push(`[System]\n${req.systemPrompt}\n`);
  for (const m of req.messages) {
    const role = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : 'Tool';
    parts.push(`[${role}]\n${m.content}\n`);
  }
  return parts.join('\n');
}

/** Stream chunks from a fresh codex app-server invocation. Async generator that
 *  drives the JSON-RPC protocol and yields ChatChunks for the agent loop. */
export async function* streamViaAppServer(
  ep: Endpoint,
  req: ChatRequest,
  proxy: string | undefined,
  fallbackCwd: string | undefined,
): AsyncGenerator<ChatChunk> {
  if (!ep.binaryPath) {
    yield { type: 'error', error: 'codex binary not found; set its absolute path in settings.' };
    return;
  }
  try { fs.accessSync(ep.binaryPath, fs.constants.X_OK); }
  catch { yield { type: 'error', error: `Cannot execute ${ep.binaryPath} — file missing or not +x.` }; return; }

  // Resolve cwd (same fallback chain as legacy codex_cli stream())
  let cwd: string | undefined = ep.cwd && fs.existsSync(ep.cwd) ? ep.cwd : undefined;
  if (!cwd) cwd = fallbackCwd;
  if (!cwd || !fs.existsSync(cwd)) cwd = process.env.HOME || process.cwd();

  // Config overrides: same set we used for `codex exec`. The app-server reads
  // ~/.codex/config.toml the same way, so `-c key=value` overrides apply.
  const configOverrides: string[] = [];
  // Reasoning effort
  if (ep.reasoningEffort && ep.reasoningEffort !== 'off') {
    configOverrides.push(`model_reasoning_effort="${ep.reasoningEffort}"`);
  }
  // Free-form overrides
  for (const line of (ep.codexConfigOverrides ?? '').split('\n')) {
    const t = line.trim();
    if (t && t.includes('=')) configOverrides.push(t);
  }
  // OSS provider
  if (ep.codexUseOss) configOverrides.push('model_provider="oss"');

  // Attached images: write to tmp, build separate UserInput items
  const tempImageFiles: string[] = [];
  const imageInputs: any[] = [];
  for (const img of (req.attachedImages ?? [])) {
    try {
      const m = img.dataUri.match(/^data:([^;]+);base64,(.+)$/);
      if (!m) continue;
      const ext = (m[1].split('/')[1] ?? 'png').replace(/[^a-z0-9]/gi, '');
      const tmp = path.join(os.tmpdir(), `glossa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`);
      fs.writeFileSync(tmp, Buffer.from(m[2], 'base64'));
      tempImageFiles.push(tmp);
      imageInputs.push({ type: 'localImage', path: tmp });
    } catch (e) { console.warn('[Glossa] codex image attach failed', e); }
  }

  const debug = !!ep.cliDebug;
  const client = new AppServerClient({
    binaryPath: ep.binaryPath,
    cwd,
    env: makeChildEnv(proxy),
    configOverrides,
    debug,
  });

  // Channel: server-side notifications get pushed onto a queue the generator
  // drains. Using an in-memory queue + Promise-based wakeup, since we can't
  // `yield` directly from a setter.
  type Pending = { chunks: ChatChunk[]; done: boolean; error: string | null; aborted: boolean; wake: (() => void) | null };
  const state: Pending = { chunks: [], done: false, error: null, aborted: false, wake: null };
  const push = (chunk: ChatChunk) => {
    state.chunks.push(chunk);
    if (state.wake) { state.wake(); state.wake = null; }
  };
  const finish = (err?: string) => {
    state.done = true;
    if (err) state.error = err;
    if (state.wake) { state.wake(); state.wake = null; }
  };
  /** Abort = user pressed Stop. Should NOT surface as an error chunk to the
   *  agent loop (otherwise UI shows an angry red error bubble). Mark aborted
   *  so the finalize path knows to swallow any subsequent state.error. */
  const abort = () => { state.aborted = true; finish(); };
  /** Per-item buffered text — codex sends delta + then completed with full
   *  text. We dedupe so completion doesn't re-emit the streamed prefix. */
  const agentItemText = new Map<string, string>();
  const reasoningItemText = new Map<string, string>();
  /** Token usage captured from turn/completed. Reported with the final chunk. */
  let capturedUsage: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } | null = null;

  client.setNotifyHandler((method, params) => {
    if (debug) console.log('[Glossa] notif:', method, JSON.stringify(params).slice(0, 200));
    switch (method) {
      case 'item/agentMessage/delta': {
        const itemId: string = params.itemId ?? 'agent';
        const delta: string = params.delta ?? '';
        if (delta) {
          push({ type: 'text', text: delta });
          agentItemText.set(itemId, (agentItemText.get(itemId) ?? '') + delta);
        }
        return;
      }
      case 'item/reasoning/textDelta':
      case 'item/reasoning/summaryTextDelta': {
        const itemId: string = params.itemId ?? 'reasoning';
        const delta: string = params.delta ?? '';
        if (delta) {
          push({ type: 'reasoning', text: delta });
          reasoningItemText.set(itemId, (reasoningItemText.get(itemId) ?? '') + delta);
        }
        return;
      }
      case 'item/started': {
        const item = params.item ?? {};
        const id: string = item.id ?? `item_${Date.now()}`;
        const itemType: string = item.type ?? 'unknown';
        if (itemType === 'agent_message' || itemType === 'reasoning') return;
        // Surface tool-ish items as tool_event so UI renders cards.
        if (!ep.cliFullAgent) return;
        const ev = mapItemToEvent(id, item, 'running');
        if (ev) push(ev);
        return;
      }
      case 'item/completed': {
        const item = params.item ?? {};
        const id: string = item.id ?? `item_${Date.now()}`;
        const itemType: string = item.type ?? 'unknown';
        if (itemType === 'agent_message') {
          // Reconcile any text we missed (some codex versions only send the
          // completion event, no deltas). If we haven't streamed anything for
          // this item yet, push the full text now.
          const streamed = agentItemText.get(id) ?? '';
          const full: string = item.text ?? '';
          if (full && full.length > streamed.length) {
            push({ type: 'text', text: full.slice(streamed.length) });
            agentItemText.set(id, full);
          }
          return;
        }
        if (itemType === 'reasoning') {
          const streamed = reasoningItemText.get(id) ?? '';
          const full: string = item.text ?? '';
          if (full && full.length > streamed.length) {
            push({ type: 'reasoning', text: full.slice(streamed.length) });
          }
          return;
        }
        if (!ep.cliFullAgent) return;
        const ev = mapItemToEvent(id, item, item.exit_code === 0 || item.error == null ? 'success' : 'error');
        if (ev) push(ev);
        return;
      }
      case 'item/commandExecution/outputDelta':
      case 'command/exec/outputDelta': {
        // Live bash output streamed into the running tool card.
        if (!ep.cliFullAgent) return;
        const itemId: string = params.itemId ?? params.id ?? '';
        const delta: string = params.chunk ?? params.delta ?? params.output ?? '';
        if (!itemId || !delta) return;
        push({
          type: 'tool_event',
          id: itemId,
          name: 'bash',
          args: {},
          status: 'running',
          result: delta,
        });
        return;
      }
      case 'turn/completed': {
        // Capture usage so the cost bar reflects what the turn cost. See
        // codex_cli.ts for the same fix; app-server uses the same param
        // shape but under a slightly different method name. Without this,
        // the cost bar always read 0 for codex-app-server sessions.
        capturedUsage = extractCodexUsage(params?.usage);
        finish();
        return;
      }
      case 'turn/failed':
      case 'error': {
        const msg: string = params?.error?.message ?? params?.message ?? 'codex stream error';
        finish(msg);
        return;
      }
    }
  });
  client.setErrorHandler((err) => finish(`codex spawn error: ${err.message}`));

  // Race the protocol setup against abort
  let abortListener: (() => void) | null = null;
  if (req.signal) {
    abortListener = () => {
      if (!client.closed) {
        // Best-effort interrupt; not all installs honor it, so we also kill.
        client.notify('turn/interrupt', {});
        client.kill();
      }
      abort();
    };
    req.signal.addEventListener('abort', abortListener);
  }

  try {
    // 1. Handshake — must finish before any thread/turn call.
    await client.request('initialize', {
      clientInfo: { name: 'glossa', version: '0.3.0' },
      capabilities: null,
    }, 10_000);

    // 2. Fresh thread. Sandbox mirrors the codex_cli legacy rules:
    //   non-fullAgent → forced read-only; fullAgent → user-configured (default workspace-write)
    const sandbox: SandboxMode = ep.cliFullAgent
      ? (ep.codexSandboxMode ?? 'workspace-write')
      : 'read-only';
    const threadResp = await client.request('thread/start', {
      sandbox,
      model: (ep.model ?? '').trim() || null,
      cwd,
    }, 30_000);
    const threadId: string = threadResp?.thread?.id ?? threadResp?.threadId;
    if (!threadId) throw new Error(`thread/start returned no thread.id: ${JSON.stringify(threadResp).slice(0, 200)}`);

    // 3. Single turn with the full serialized history as one text input.
    const prompt = serializeAsTurnInput(req);
    const input = [
      { type: 'text', text: prompt, text_elements: [] },
      ...imageInputs,
    ];
    await client.request('turn/start', {
      threadId,
      input,
      effort: ep.reasoningEffort && ep.reasoningEffort !== 'off' ? ep.reasoningEffort : null,
    }, 30_000);

    // 4. Drain notifications until turn/completed
    while (!state.done || state.chunks.length > 0) {
      if (state.chunks.length === 0) {
        await new Promise<void>((resolve) => { state.wake = resolve; });
        continue;
      }
      const next = state.chunks.shift()!;
      yield next;
    }

    // Aborted runs exit silently — the user pressed Stop and doesn't want a
    // red error bubble. The finalize block in view.ts already cleans up
    // partial UI state (streaming class, pending tool cards, etc.).
    if (state.aborted) {
      yield { type: 'final', text: '', usage: capturedUsage ?? undefined };
      return;
    }
    if (state.error) {
      yield { type: 'error', error: `codex app-server: ${state.error}` };
      return;
    }
    yield { type: 'final', text: '', usage: capturedUsage ?? undefined };

  } catch (e: any) {
    if (!state.aborted) yield { type: 'error', error: `codex app-server: ${e.message ?? e}` };
    else yield { type: 'final', text: '' };
  } finally {
    if (abortListener && req.signal) req.signal.removeEventListener('abort', abortListener);
    client.kill();
    for (const f of tempImageFiles) { try { fs.unlinkSync(f); } catch {} }
  }
}

/** Accept any of the usage shapes codex has shipped across versions and
 *  normalize to Glossa's TokenUsage fields. Used by both the stream-json
 *  CLI path (codex_cli.ts) and the app-server protocol (this file) so they
 *  stay in lockstep when codex renames a field. */
function extractCodexUsage(u: any): { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } | null {
  if (!u || typeof u !== 'object') return null;
  return {
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
}

/** Translate an app-server `item.*` event into a Glossa tool_event chunk. */
function mapItemToEvent(id: string, item: any, status: 'running' | 'success' | 'error'): ChatChunk | null {
  const itemType: string = item.type ?? 'unknown';
  if (itemType === 'command_execution') {
    return {
      type: 'tool_event', id, name: 'bash',
      args: { command: item.command },
      status,
      result: String(item.aggregated_output ?? item.output ?? '').slice(0, 4000),
    };
  }
  if (itemType === 'file_change') {
    return {
      type: 'tool_event', id, name: 'file_change',
      args: { changes: item.changes ?? [] },
      status,
    };
  }
  if (itemType === 'mcp_tool_call' || itemType === 'collab_tool_call') {
    return {
      type: 'tool_event', id,
      name: item.server ? `${item.server}__${item.tool ?? itemType}` : itemType,
      args: item.arguments ?? {},
      status: status === 'success' && item.error ? 'error' : status,
      result: String(item.output ?? item.error ?? '').slice(0, 4000),
    };
  }
  if (itemType === 'web_search') {
    return { type: 'tool_event', id, name: 'web_search', args: { query: item.query }, status };
  }
  if (itemType === 'todo_list') {
    return { type: 'tool_event', id, name: 'todo_list', args: { items: item.items ?? [] }, status };
  }
  if (itemType === 'error') {
    return {
      type: 'tool_event', id, name: 'error', args: {}, status: 'error',
      result: String(item.message ?? 'unknown error').slice(0, 4000),
    };
  }
  return null;
}
