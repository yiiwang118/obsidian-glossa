import { spawn, ChildProcess } from 'child_process';
import { makeChildEnvForMcp } from '../utils/env';
import type { McpServerConfig } from '../types';
import type { ToolSpec } from '../providers/types';

/** Cap on stderr history per MCP client. Without this, a chatty server could
 *  push lines forever and we'd keep them all in memory. */
const STDERR_MAX_LINES = 500;

/**
 * Minimal MCP (Model Context Protocol) client over stdio.
 * Implements the subset needed to: list tools, call a tool, get text result.
 *
 * Server is expected to follow MCP stdio JSON-RPC framing:
 *   Content-Length: N\r\n\r\n{...json...}
 * We use the simpler "newline-delimited JSON" if the server prefers that (autodetect).
 */
export interface McpTool {
  serverId: string;
  serverName: string;
  /** Exposed name to LLM, namespaced: "<server>__<tool>" */
  exposedName: string;
  originalName: string;
  description: string;
  inputSchema: any;
}

export interface McpResource {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

interface Pending {
  resolve: (r: any) => void;
  reject: (e: Error) => void;
  timer: number;
}

export class McpClient {
  private proc?: ChildProcess;
  private rpcId = 0;
  private pending = new Map<number, Pending>();
  private framing: 'lsp' | 'lines' = 'lines';
  private rxBuf = Buffer.alloc(0);
  private contentLengthExpected: number | null = null;
  private tools: McpTool[] = [];
  private resources: McpResource[] = [];
  private stderrLog: string[] = [];
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  status: 'idle' | 'connecting' | 'connected' | 'failed' = 'idle';
  lastError?: string;
  connectedAt?: number;

  constructor(public cfg: McpServerConfig) {}

  isConnected() { return !!this.proc && !this.proc.killed && this.status === 'connected'; }
  listTools(): McpTool[] { return this.tools; }
  listResources(): McpResource[] { return this.resources; }
  recentStderr(): string { return this.stderrLog.slice(-50).join('\n'); }

  async connect(): Promise<void> {
    if (this.isConnected()) return;
    if (!this.cfg.command) throw new Error('MCP: command not set');
    this.status = 'connecting';
    this.lastError = undefined;
    this.stderrLog = [];

    // Third-party MCP servers should NOT see the user's LLM API keys by
     // default — makeChildEnvForMcp() strips OPENAI_API_KEY / ANTHROPIC_API_KEY
     // out of the base inherited env. If a specific server legitimately needs
     // them, the user can re-add them via cfg.env (which still wins below).
    this.proc = spawn(this.cfg.command, this.cfg.args ?? [], {
      env: { ...makeChildEnvForMcp(), ...(this.cfg.env ?? {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc.stderr?.on('data', d => {
      const text = d.toString();
      for (const line of text.split('\n')) {
        if (!line) continue;
        this.stderrLog.push(line);
        // Bounded ring — drop oldest so a chatty server can't OOM us.
        if (this.stderrLog.length > STDERR_MAX_LINES) this.stderrLog.shift();
      }
      // Don't print each stderr line to devtools — chatty servers (filesystem,
      // GitHub) emit health-check logs that would drown the console. The full
      // stream is preserved in `stderrLog` (bounded ring) and surfaced to the
      // user via the MCP diagnostic modal, plus dumped en bloc on non-zero
      // exit (see `on('exit')` below).
    });
    this.proc.on('exit', (code) => {
      this.proc = undefined;
      this.status = 'failed';
      if (code) {
        this.lastError = `Process exited with code ${code}`;
        // Keep raw stderr out of devtools: third-party MCP servers can print
        // tokens, local paths, or provider errors. The bounded stderr ring is
        // still available from the MCP diagnostics UI when the user asks for it.
        console.warn(`[mcp:${this.cfg.name}] exited with code ${code}. Open MCP diagnostics for recent stderr.`);
      }
      // Reject any in-flight RPC calls so callers don't hang forever.
      const exitErr = new Error('MCP process exited');
      for (const [, p] of this.pending) {
        window.clearTimeout(p.timer);
        p.reject(exitErr);
      }
      this.pending.clear();
      // Exponential-backoff auto-reconnect (cap 5 attempts, max 30s between).
      // We surface reconnect attempts as `warn` rather than `log` because a
      // running reconnect loop is an abnormal state — the user usually wants
      // to know it's happening.
      if (this.cfg.enabled && this.reconnectAttempts < 5) {
        this.reconnectAttempts++;
        const delayMs = Math.min(30_000, 1000 * Math.pow(2, this.reconnectAttempts));
        if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
        this.reconnectTimer = window.setTimeout(() => {
          console.warn(`[mcp:${this.cfg.name}] auto-reconnect attempt ${this.reconnectAttempts}`);
          this.connect().catch(e => {
            this.lastError = `reconnect failed: ${e?.message ?? e}`;
          });
        }, delayMs);
      }
    });

    this.proc.stdout?.on('data', (chunk: Buffer) => this.onData(chunk));

    // Initialize
    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'glossa', version: '0.3.0' },
    }, 5000);
    await this.notify('notifications/initialized', {});

    // List tools — exposedName uses the shared normalizer (types.ts) so
    // permission-rule matching can apply the same transform symmetrically.
    // Otherwise mcp:weather-east:* could fail to match weather_east__forecast.
    const { normalizeMcpServerName } = await import('../types');
    const prefix = normalizeMcpServerName(this.cfg.name);
    const list = await this.request('tools/list', {}, 5000);
    this.tools = (list.tools ?? []).map((t: any) => ({
      serverId: this.cfg.id, serverName: this.cfg.name,
      exposedName: `${prefix}__${t.name}`,
      originalName: t.name,
      description: t.description ?? '',
      inputSchema: t.inputSchema ?? { type: 'object' },
    }));
    // List resources (optional capability — many servers don't implement this)
    try {
      const rlist = await this.request('resources/list', {}, 3000);
      this.resources = (rlist.resources ?? []).map((r: any) => ({
        uri: r.uri, name: r.name, description: r.description, mimeType: r.mimeType,
      }));
    } catch {
      this.resources = [];
    }
    this.status = 'connected';
    this.connectedAt = Date.now();
    this.reconnectAttempts = 0;     // clear the backoff counter on a successful connect
  }

  /** Read a resource by URI (MCP resources/read). Returns either a string or a list of content blocks. */
  async readResource(uri: string): Promise<string> {
    if (!this.isConnected()) await this.connect();
    const res = await this.request('resources/read', { uri }, 10_000);
    if (!res?.contents) return JSON.stringify(res);
    return res.contents
      .filter((c: any) => c.type === 'text' || c.text)
      .map((c: any) => c.text ?? '')
      .join('\n') || JSON.stringify(res);
  }

  async callTool(originalName: string, args: any): Promise<string> {
    if (!this.isConnected()) await this.connect();
    const res = await this.request('tools/call', { name: originalName, arguments: args }, 60_000);
    if (!res || !res.content) return JSON.stringify(res);
    const txt = res.content
      .filter((c: any) => c.type === 'text' || c.type === 'resource_text')
      .map((c: any) => c.text ?? '')
      .join('\n');
    return txt || JSON.stringify(res);
  }

  dispose() {
    if (this.reconnectTimer) { window.clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    try { this.proc?.kill('SIGTERM'); } catch { /* ignore */ }
    this.proc = undefined;
    this.status = 'idle';
  }

  /* ---- transport ---- */
  private onData(chunk: Buffer) {
    this.rxBuf = Buffer.concat([this.rxBuf, chunk]);
    // First message detection: if it looks like "Content-Length:" → LSP framing, else NDJSON.
    if (this.framing === 'lines' && this.rxBuf.indexOf('Content-Length:') === 0) this.framing = 'lsp';

    while (true) {
      if (this.framing === 'lsp') {
        if (this.contentLengthExpected == null) {
          const headEnd = this.rxBuf.indexOf('\r\n\r\n');
          if (headEnd < 0) return;
          const head = this.rxBuf.slice(0, headEnd).toString('utf-8');
          const m = head.match(/Content-Length:\s*(\d+)/i);
          if (!m) { this.rxBuf = this.rxBuf.slice(headEnd + 4); continue; }
          this.contentLengthExpected = parseInt(m[1], 10);
          this.rxBuf = this.rxBuf.slice(headEnd + 4);
        }
        if (this.rxBuf.length < this.contentLengthExpected) return;
        const body = this.rxBuf.slice(0, this.contentLengthExpected).toString('utf-8');
        this.rxBuf = this.rxBuf.slice(this.contentLengthExpected);
        this.contentLengthExpected = null;
        this.handleRpcMessage(body);
      } else {
        const nl = this.rxBuf.indexOf('\n');
        if (nl < 0) return;
        const line = this.rxBuf.slice(0, nl).toString('utf-8').trim();
        this.rxBuf = this.rxBuf.slice(nl + 1);
        if (line) this.handleRpcMessage(line);
      }
    }
  }
  private handleRpcMessage(raw: string) {
    let msg: any; try { msg = JSON.parse(raw); } catch { return; }
    if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      window.clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(msg.error.message ?? 'RPC error'));
      else p.resolve(msg.result);
      return;
    }
    // Server-pushed notification (no id) — handle tools/list_changed by
    // re-querying tools/list. Without this, a server that adds tools at
    // runtime (e.g. a workflow MCP that exposes a tool per registered
    // workflow) leaves us with the stale init-time list and the model
    // can't see anything new.
    if (msg.method === 'notifications/tools/list_changed') {
      this.refreshTools().catch(e => console.warn('[mcp] refreshTools failed', e));
    }
  }

  /** Re-query tools/list and fire `onToolsChanged` so the agent loop /
   *  view rebuild their tool surface. */
  private async refreshTools(): Promise<void> {
    try {
      const { normalizeMcpServerName } = await import('../types');
      const prefix = normalizeMcpServerName(this.cfg.name);
      const list = await this.request('tools/list', {}, 5000);
      this.tools = (list.tools ?? []).map((t: any) => ({
        serverId: this.cfg.id, serverName: this.cfg.name,
        exposedName: `${prefix}__${t.name}`,
        originalName: t.name,
        description: t.description ?? '',
        inputSchema: t.inputSchema ?? { type: 'object' },
      }));
      if (this.onToolsChanged) {
        try { this.onToolsChanged(); } catch (e) { console.warn('[mcp] onToolsChanged threw', e); }
      }
    } catch (e) {
      console.warn('[mcp] tools/list refresh failed', e);
    }
  }

  /** Subscribed by McpHub to bubble per-client tool changes up to the
   *  agent loop. */
  onToolsChanged: (() => void) | undefined;
  private send(obj: any) {
    if (!this.proc?.stdin) throw new Error('MCP not connected');
    const body = JSON.stringify(obj);
    if (this.framing === 'lsp') this.proc.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
    else this.proc.stdin.write(body + '\n');
  }
  private request(method: string, params: any, timeoutMs: number): Promise<any> {
    const id = ++this.rpcId;
    return new Promise<any>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP ${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ jsonrpc: '2.0', id, method, params }); }
      catch (e: any) {
        window.clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }
  private notify(method: string, params: any) {
    try { this.send({ jsonrpc: '2.0', method, params }); } catch { /* ignore */ }
    return Promise.resolve();
  }
}

export class McpHub {
  clients: McpClient[] = [];

  async start(servers: McpServerConfig[]) {
    await this.stop();
    const enabled = servers.filter(s => s.enabled);
    // Build the client objects synchronously so the settings UI sees them all at once,
    // then connect IN PARALLEL — previously serial start was the dominant latency on
    // multi-server setups.
    const clients = enabled.map(s => new McpClient(s));
    // Bubble per-client tools/list_changed notifications up through the hub.
    // Consumers subscribe via McpHub.onChange.
    for (const c of clients) c.onToolsChanged = () => this.emitChange();
    this.clients = clients;
    this._startPromise = Promise.all(clients.map(c => c.connect().catch(e => {
      c.status = 'failed';
      c.lastError = e?.message ?? String(e);
      console.warn(`[mcp] failed to start ${c.cfg.name}:`, c.lastError);
    }))).then(() => { /* settled */ });
    await this._startPromise;
  }

  /** Listeners for tool-list changes (server-pushed via tools/list_changed). */
  private changeListeners = new Set<() => void>();
  onChange(cb: () => void): () => void {
    this.changeListeners.add(cb);
    return () => this.changeListeners.delete(cb);
  }
  private emitChange() {
    for (const cb of this.changeListeners) {
      try { cb(); } catch (e) { console.warn('[mcp] hub change listener threw', e); }
    }
  }
  /** Promise that resolves when start()'s parallel connect()s are all settled.
   *  Consumers who must see complete tool lists (e.g. the first agent step)
   *  should await this; otherwise allTools() may return a partial set. */
  private _startPromise: Promise<void> | null = null;
  ready(): Promise<void> { return this._startPromise ?? Promise.resolve(); }
  async stop() { for (const c of this.clients) c.dispose(); this.clients = []; }

  /** Reconnect a specific server by id (used by the settings-page restart button). */
  async restart(serverId: string): Promise<void> {
    const c = this.clients.find(x => x.cfg.id === serverId);
    if (!c) return;
    c.dispose();
    await c.connect().catch(e => {
      c.status = 'failed';
      c.lastError = e?.message ?? String(e);
    });
  }

  allTools(): McpTool[] { return this.clients.flatMap(c => c.listTools()); }

  asToolSpecs(): ToolSpec[] {
    // Collision detection: two servers whose normalized prefix collides
    // (e.g. `weather-east` and `weather_east` both → `weather_east__`) would
    // produce identical exposedName values. The agent loop would resolve to
    // the FIRST matching client, silently dropping tools from the second.
    // We tag the warned-once-per-name in a Set on `this` so we don't log it
    // every turn.
    const seen = new Map<string, string>();   // exposedName → serverId
    const out: ToolSpec[] = [];
    for (const t of this.allTools()) {
      const prev = seen.get(t.exposedName);
      if (prev && prev !== t.serverId) {
        const key = `collision:${t.exposedName}`;
        if (!this._warnedCollisions.has(key)) {
          console.warn(`[mcp] tool name collision: "${t.exposedName}" exposed by both server "${prev}" and "${t.serverId}" — only the first will be reachable. Rename one of the servers (after normalization, non-alphanum → "_") to disambiguate.`);
          this._warnedCollisions.add(key);
        }
        continue;
      }
      seen.set(t.exposedName, t.serverId);
      out.push({
        name: t.exposedName,
        description: `[MCP:${t.serverName}] ${t.description}`,
        parameters: t.inputSchema,
      });
    }
    return out;
  }

  /** Set of collision keys we've already warned about, so console isn't
   *  spammed once per turn for every tool call. */
  private _warnedCollisions = new Set<string>();

  findClient(exposedName: string): { client: McpClient; originalName: string } | null {
    for (const c of this.clients) {
      const t = c.listTools().find(x => x.exposedName === exposedName);
      if (t) return { client: c, originalName: t.originalName };
    }
    return null;
  }
}
