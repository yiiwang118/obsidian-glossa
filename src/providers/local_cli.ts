import { Platform } from 'obsidian';
import type { CliModelInfo, Endpoint } from '../types';
import type { ChatChunk, ChatRequest, LLMProvider } from './types';
import { CliDecoder, cliArguments, cliPrompt } from './cli_protocol';
import { cliRecord, parseCliModels } from './cli_catalog';

/** Audited desktop boundary. No shell, installation, auth-file reads or arbitrary arguments. */
async function desktopRuntime() {
  if (!Platform.isDesktopApp) throw new Error('Local CLI requires Obsidian desktop.');
  // Obsidian exposes CommonJS require to desktop plugins. Dynamic import()
  // instead goes through Chromium's URL loader and cannot resolve Node modules.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Guarded desktop-only host boundary.
  const childProcess = require('child_process') as typeof import('node:child_process');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Guarded desktop-only host boundary.
  const os = require('os') as typeof import('node:os');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Private, short-lived Grok prompt file only; never read vault or credential files.
  const fs = require('fs') as typeof import('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Guarded desktop-only host boundary.
  const processApi = require('process') as typeof import('node:process');
  const home = os.homedir();
  const env = { ...processApi.env, PATH: [processApi.env.PATH, `${home}/.local/bin`, `${home}/.grok/bin`, '/opt/homebrew/bin', '/usr/local/bin'].filter(Boolean).join(Platform.isWin ? ';' : ':') };
  return { childProcess, home, processApi, env, fs, os };
}

export async function findLocalCli(kind: Endpoint['kind'], binaryPath?: string, signal?: AbortSignal): Promise<string | null> {
  const { childProcess, home, env } = await desktopRuntime();
  const name = kind === 'codex-cli' ? 'codex' : kind === 'grok-cli' ? 'grok' : 'claude';
  const candidates = binaryPath?.trim() ? [binaryPath.trim()] : [name, `${home}/.local/bin/${name}`, ...(kind === 'grok-cli' ? [`${home}/.grok/bin/grok`] : []), '/opt/homebrew/bin/' + name, '/usr/local/bin/' + name, `${home}/.npm-global/bin/${name}`];
  for (const candidate of candidates) {
    if (signal?.aborted) throw new Error('CLI discovery cancelled.');
    if (/\0|\r|\n/.test(candidate)) continue;
    const ok = await new Promise<boolean>(resolve => {
      const child = childProcess.spawn(candidate, kind === 'grok-cli' ? ['--no-auto-update', '--version'] : ['--version'], { shell: false, env, windowsHide: true, stdio: 'ignore' });
      const timer = window.setTimeout(() => { child.kill(); resolve(false); }, 4000);
      const abort = () => { child.kill(); resolve(false); };
      signal?.addEventListener('abort', abort, { once: true });
      child.once('close', () => signal?.removeEventListener('abort', abort));
      child.once('error', () => { window.clearTimeout(timer); resolve(false); });
      child.once('close', code => { window.clearTimeout(timer); resolve(code === 0); });
    });
    if (ok) return candidate;
  }
  return null;
}

function applyProxy(env: Record<string, string | undefined>, proxy?: string) {
  if (!proxy) return;
  if (!['http:', 'https:', 'socks5:', 'socks5h:'].includes(new URL(proxy).protocol)) throw new Error('Unsupported CLI proxy protocol.');
  Object.assign(env, { HTTP_PROXY: proxy, HTTPS_PROXY: proxy, ALL_PROXY: proxy });
}

/** Read only CLI capability metadata. No user messages, threads or model turns. */
export async function discoverLocalCliModels(ep: Endpoint, cwd: string, proxy?: string, signal?: AbortSignal): Promise<CliModelInfo[]> {
  if (ep.kind === 'custom-api') throw new Error('Expected a local CLI endpoint.');
  const binary = await findLocalCli(ep.kind, ep.binaryPath, signal);
  if (!binary) throw new Error('CLI not found. Install and sign in, or configure its executable path.');
  if (signal?.aborted) throw new Error('CLI discovery cancelled.');
  const { childProcess, env, processApi } = await desktopRuntime();
  applyProxy(env, proxy);
  const codex = ep.kind === 'codex-cli';
  const grok = ep.kind === 'grok-cli';
  const args = grok ? ['--no-auto-update', 'agent', 'stdio'] : codex ? ['-c', 'mcp_servers={}', 'app-server'] : ['--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--restricted', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--permission-prompts', 'none', '--tools', ''];
  const child = childProcess.spawn(binary, args, { cwd, env, shell: false, detached: !Platform.isWin, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  return new Promise<CliModelInfo[]>((resolve, reject) => {
    let settled = false, buffer = '', size = 0, requestId = 1, pages = 0;
    const models = new Map<string, CliModelInfo>();
    const cursors = new Set<string>();
    let killTimer: number | undefined;
    const kill = (hard = false) => {
      try {
        if (!Platform.isWin && child.pid) processApi.kill(-child.pid, hard ? 'SIGKILL' : 'SIGTERM');
        else child.kill(hard ? 'SIGKILL' : 'SIGTERM');
      } catch { /* Only this metadata process is owned by the request. */ }
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      child.stdin.end();
      kill();
      if (child.exitCode === null && child.signalCode === null) killTimer = window.setTimeout(() => kill(true), 1000);
      if (error) reject(error);
      else if (!models.size) reject(new Error('CLI returned no model capabilities. Update the CLI or check its login.'));
      else resolve([...models.values()]);
    };
    const abort = () => finish(new Error('CLI discovery cancelled.'));
    const timer = window.setTimeout(() => finish(new Error('CLI model discovery timed out. Check the CLI login and proxy, then retry.')), 15_000);
    signal?.addEventListener('abort', abort, { once: true });
    const send = (message: unknown) => { if (!settled) child.stdin.write(JSON.stringify(message) + '\n'); };
    const list = (cursor?: string) => { requestId++; send({ id: requestId, method: 'model/list', params: { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) } }); };
    child.once('error', error => finish(error));
    child.once('close', () => { if (killTimer) window.clearTimeout(killTimer); finish(new Error('CLI closed before returning model capabilities.')); });
    child.stdin.on('error', error => finish(error));
    child.stderr.resume(); // Login diagnostics may contain local details; never persist them.
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (settled) return;
      size += chunk.length; buffer += chunk;
      if (size > 2_000_000) { finish(new Error('CLI model metadata exceeded the size limit.')); return; }
      let newline: number;
      while (!settled && (newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let row: Record<string, unknown>;
        try { row = cliRecord(JSON.parse(line) as unknown); } catch { finish(new Error('CLI returned invalid model metadata.')); return; }
        if (grok) {
          if (row.method && row.id !== undefined) {
            send({ jsonrpc: '2.0', id: row.id, error: { code: -32601, message: 'Metadata discovery does not permit client actions.' } });
            continue;
          }
          if (row.id !== requestId) continue;
          if (row.error) { finish(new Error('Grok rejected model discovery. Update Grok and retry.')); return; }
          if (requestId === 1) { requestId++; send({ jsonrpc: '2.0', id: requestId, method: '_x.ai/models/list', params: {} }); continue; }
          const envelope = cliRecord(row.result);
          if (envelope.error) { finish(new Error('Grok could not read its model catalog. Check Grok login.')); return; }
          const result = cliRecord(envelope.result);
          for (const model of parseCliModels(ep.kind, result.availableModels)) models.set(model.id, { ...model, isDefault: model.id === result.currentModelId });
          finish();
        } else if (codex) {
          if (row.id !== requestId) continue;
          if (row.error) { finish(new Error('Codex rejected model discovery. Update the CLI and retry.')); return; }
          if (requestId === 1) { send({ method: 'initialized' }); list(); continue; }
          const result = cliRecord(row.result);
          for (const model of parseCliModels(ep.kind, result.data)) models.set(model.id, model);
          const cursor = result.nextCursor;
          if (typeof cursor === 'string' && cursor && ++pages < 10 && !cursors.has(cursor)) { cursors.add(cursor); list(cursor); }
          else finish();
        } else if (row.type === 'control_response') {
          const response = cliRecord(row.response);
          if (response.request_id !== 'glossa-models') continue;
          if (response.subtype !== 'success') { finish(new Error('Claude Code rejected model discovery. Update the CLI and retry.')); return; }
          for (const model of parseCliModels(ep.kind, cliRecord(response.response).models)) models.set(model.id, model);
          finish();
        } else if (row.type === 'control_request') {
          send({ type: 'control_response', response: { subtype: 'error', request_id: row.request_id, error: 'Model discovery does not permit tool execution.' } });
        }
      }
    });
    send(grok ? { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } } } : codex ? { id: 1, method: 'initialize', params: { clientInfo: { name: 'glossa', version: '1.0.0' }, capabilities: {} } } : { type: 'control_request', request_id: 'glossa-models', request: { subtype: 'initialize' } });
    if (signal?.aborted) abort();
  });
}

export class LocalCliProvider implements LLMProvider {
  id: string;
  displayName: string;
  constructor(private ep: Endpoint, private vaultRoot?: string, private proxy?: string) { this.id = ep.id; this.displayName = ep.label; }
  defaultModel() { return this.ep.model ?? ''; }
  async isAvailable() { return !!(await findLocalCli(this.ep.kind, this.ep.binaryPath)); }
  async testConnect() { const ok = await this.isAvailable(); return { ok, message: ok ? 'CLI found. Uses its existing local login.' : 'CLI not found. Install and sign in in your terminal, or set the executable path.' }; }

  async *stream(request: ChatRequest): AsyncGenerator<ChatChunk> {
    if (request.signal?.aborted) return;
    if (request.attachedImages?.length) throw new Error('Local CLI chat currently accepts text and vault file references. Use an API endpoint for image attachments.');
    const cwd = this.vaultRoot;
    if (!cwd) throw new Error('Local CLI requires a filesystem vault.');
    const binary = await findLocalCli(this.ep.kind, this.ep.binaryPath);
    if (!binary) throw new Error('Local CLI not found. Set its executable path in Glossa settings after installing and signing in.');
    if (request.signal?.aborted) return;
    const { childProcess, processApi, env, fs, os } = await desktopRuntime();
    applyProxy(env, this.proxy);
    const args = cliArguments(this.ep, request, cwd);
    // Grok accepts a prompt file, not stdin. Keep conversation text out of argv;
    // only this process's private temporary directory is written and removed.
    let promptDir: string | undefined;
    let child: ReturnType<typeof childProcess.spawn>;
    try {
      if (this.ep.kind === 'grok-cli') {
        promptDir = fs.mkdtempSync(`${os.tmpdir()}/glossa-grok-`);
        const promptPath = `${promptDir}/prompt.txt`;
        fs.writeFileSync(promptPath, cliPrompt(request), { mode: 0o600 });
        args.push('--prompt-file', promptPath);
      }
      child = childProcess.spawn(binary, args, { cwd, env, shell: false, detached: !Platform.isWin, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      if (promptDir) fs.rmSync(promptDir, { recursive: true, force: true });
      throw error;
    }
    // Every launch above explicitly uses pipes.
    const stdin = child.stdin, stdout = child.stdout, stderrStream = child.stderr;
    const decoder = new CliDecoder(this.ep.kind);
    let stderr = '', buffer = '', failure: Error | undefined;
    const finished = new Promise<number | null>(resolve => {
      child.once('error', error => { failure = error; resolve(null); });
      child.once('close', code => resolve(code));
    });
    // Stop only this owned process. SIGKILL is a bounded fallback for unresponsive CLIs.
    let killTimer: number | undefined;
    const kill = (signal: 'SIGTERM' | 'SIGKILL') => {
      if (!child.pid) return;
      try {
        if (!Platform.isWin) processApi.kill(-child.pid, signal);
        else childProcess.spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill(signal));
      } catch { /* The owned process group already exited. */ }
    };
    const stop = () => { kill('SIGTERM'); killTimer ??= window.setTimeout(() => kill('SIGKILL'), 1500); };
    const timeout = window.setTimeout(() => { failure = new Error('Local CLI exceeded the 30-minute run limit.'); stop(); }, 30 * 60_000);
    request.signal?.addEventListener('abort', stop, { once: true });
    if (request.signal?.aborted) stop();
    stderrStream.setEncoding('utf8');
    stderrStream.on('data', (data: string) => { stderr = (stderr + data).slice(-8000); });
    stdin.on('error', error => { if (!request.signal?.aborted) failure = error; });
    stdin.end(this.ep.kind === 'grok-cli' ? undefined : cliPrompt(request));
    stdout.setEncoding('utf8');
    try {
      for await (const chunk of stdout) {
        if (request.signal?.aborted) break;
        buffer += String(chunk);
        if (buffer.length > 8_000_000) throw new Error('CLI event exceeded the output limit.');
        let newline: number;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
          if (!line) continue;
          let event: unknown;
          try { event = JSON.parse(line) as unknown; } catch { throw new Error('CLI returned invalid JSON. Update the CLI or verify its executable path.'); }
          for (const value of decoder.decode(event)) yield value;
        }
      }
      if (buffer.trim() && !request.signal?.aborted) for (const value of decoder.decode(JSON.parse(buffer) as unknown)) yield value;
      const code = await finished;
      if (request.signal?.aborted) return;
      if (failure) throw failure;
      if (code !== 0 || !decoder.completed) throw new Error(`CLI exited ${code ?? 'unexpectedly'}. ${stderr.slice(-1500) || 'No final response received; check the CLI login in your terminal.'}`);
    } finally {
      window.clearTimeout(timeout);
      request.signal?.removeEventListener('abort', stop);
      if (child.exitCode === null && child.signalCode === null) stop();
      // Keep the escalation timer until process exit, including generator cancellation.
      void finished.finally(() => { if (killTimer) window.clearTimeout(killTimer); });
      if (promptDir) {
        await finished;
        fs.rmSync(promptDir, { recursive: true, force: true });
      }
    }
  }
}
