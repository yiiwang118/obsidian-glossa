import type { ChatMessage, Endpoint, TokenUsage } from '../types';
import type { ChatChunk, ChatRequest } from './types';
import { cliEffort, cliTranscript } from './cli_protocol';
import { cliRecord } from './cli_catalog';

function protocolText(value: unknown, fallback = ''): string { return typeof value === 'string' ? value : fallback; }

interface TokenCounts { input: number; output: number; cacheRead: number }
function tokenCounts(value: unknown): TokenCounts {
  const row = cliRecord(value);
  return { input: Number(row.inputTokens) || 0, output: Number(row.outputTokens) || 0, cacheRead: Number(row.cachedInputTokens) || 0 };
}
function tokenDelta(a: TokenCounts, b: TokenCounts): TokenCounts {
  return { input: Math.max(0, a.input - b.input), output: Math.max(0, a.output - b.output), cacheRead: Math.max(0, a.cacheRead - b.cacheRead) };
}

export interface CodexSessionBinding {
  threadId: string;
  ownerId: string;
  endpointId: string;
  policyKey: string;
  historyKey: string;
}
export interface NativeSessionRequest {
  ownerId: string;
  historyKey: string;
  /** Plugin version reported to the app-server. */
  clientVersion: string;
  binding?: CodexSessionBinding;
  onBinding: (binding: CodexSessionBinding) => Promise<void>;
}

async function sha256(data: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
  return Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('');
}

/** Hash only transcript identity/content, excluding mutable display and usage metadata. */
export function conversationKey(messages: readonly ChatMessage[]): Promise<string> {
  return sha256(JSON.stringify(messages.map(m => [m.id, m.role, m.content, m.toolEvents?.map(e => [e.id, e.name, (e.args as unknown), e.status, e.result])])));
}

/** A thread keeps the instructions it started with, so changed instructions start a fresh thread. */
export function codexPolicyKey(ep: Endpoint, request: ChatRequest, cwd: string): Promise<string> {
  return sha256(JSON.stringify([ep.id, ep.binaryPath ?? '', cwd, request.execution?.mode ?? 'plan', request.execution?.permission ?? 'read-only', request.systemPrompt ?? '']));
}

/** One app-server connection per turn; persistent thread identity survives process exit. */
export class CodexSessionProtocol {
  private stage: 'initialize' | 'thread' | 'turn' | 'running' = 'initialize';
  private requestId = 1;
  private threadId = '';
  private turnId = '';
  private readonly text = new Map<string, string>();
  private readonly finishedItems = new Set<string>();
  private usage?: TokenUsage;
  private usageStart?: TokenCounts;
  private outputStarted = false;
  completed = false;
  readonly resume: boolean;
  /** `policyKey` comes from `codexPolicyKey` for this same request. */
  constructor(private readonly ep: Endpoint, private readonly request: ChatRequest, private readonly cwd: string,
    readonly policyKey: string, private readonly send: (value: unknown) => void) {
    const native = request.nativeSession;
    const b = native.binding;
    this.resume = !!b && b.ownerId === native.ownerId && b.endpointId === ep.id && b.historyKey === native.historyKey && b.policyKey === policyKey;
  }
  start() {
    this.send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'glossa', version: this.request.nativeSession.clientVersion }, capabilities: {} } });
  }
  interrupt() {
    if (this.threadId && this.turnId && !this.completed) this.send({ id: 99, method: 'turn/interrupt', params: { threadId: this.threadId, turnId: this.turnId } });
  }
  async receive(value: unknown): Promise<ChatChunk[]> {
    const row = cliRecord(value), p = cliRecord(row.params);
    if (this.completed) return [];
    // Do not grant new capabilities to a server, even if it unexpectedly asks.
    if (row.method && row.id !== undefined) {
      const result = row.method === 'item/commandExecution/requestApproval' || row.method === 'item/fileChange/requestApproval'
        ? { result: { decision: 'decline' } } : { error: { code: -32601, message: 'This client does not grant additional capabilities.' } };
      this.send({ id: row.id, ...result });
      return [];
    }
    if (!row.method && row.id === this.requestId) {
      if (row.error) throw new Error(`Codex ${this.stage} failed: ${protocolText(cliRecord(row.error).message, 'Unsupported app-server protocol. Update Codex or disable native sessions.')}`);
      const result = cliRecord(row.result);
      if (this.stage === 'initialize') {
        this.send({ method: 'initialized' });
        this.stage = 'thread';
        // Glossa's instructions are added to Codex's own, once per thread; a resumed thread
        // already has the same ones (see codexPolicyKey).
        this.send({ id: ++this.requestId, method: this.resume ? 'thread/resume' : 'thread/start', params: {
          ...(this.resume ? { threadId: this.request.nativeSession.binding.threadId, excludeTurns: true } : { ephemeral: false, developerInstructions: this.instructions || null }),
          cwd: this.cwd, model: this.request.model || this.ep.model || null,
          approvalPolicy: 'never', sandbox: this.readOnly ? 'read-only' : 'workspace-write',
          config: { mcp_servers: {}, 'sandbox_workspace_write.network_access': false },
        } });
      } else if (this.stage === 'thread') {
        const thread = cliRecord(result.thread);
        if (typeof thread.id !== 'string' || !thread.id) throw new Error('Codex returned no native thread ID.');
        if (cliRecord(thread.status).type === 'active') throw new Error('The native Codex thread is already active. Wait for it to finish or reset this chat’s CLI session.');
        this.threadId = thread.id;
        // Invalidate the old history marker before turn/start, including on crashes.
        await this.request.nativeSession.onBinding({ threadId: thread.id, ownerId: this.request.nativeSession.ownerId,
          endpointId: this.ep.id, policyKey: this.policyKey, historyKey: '' });
        if (this.request.signal?.aborted) return [];
        const effort = cliEffort(this.ep, this.request);
        const latest = [...this.request.messages].reverse().find(m => m.role === 'user');
        this.stage = 'turn';
        this.send({ id: ++this.requestId, method: 'turn/start', params: {
          threadId: this.threadId, input: [{ type: 'text', text: this.resume ? latest?.content ?? '' : cliTranscript(this.request) }],
          cwd: this.cwd, model: this.request.model || this.ep.model || null, approvalPolicy: 'never',
          sandboxPolicy: this.readOnly ? { type: 'readOnly' } : { type: 'workspaceWrite', writableRoots: [this.cwd], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true },
          ...(effort !== 'off' ? { effort } : {}),
        } });
      } else if (this.stage === 'turn') {
        const turn = cliRecord(result.turn);
        if (typeof turn.id !== 'string') throw new Error('Codex returned no native turn ID.');
        this.turnId = turn.id; this.stage = 'running';
      }
      return [];
    }
    if (p.threadId && p.threadId !== this.threadId) return [];
    if (p.turnId && this.turnId && p.turnId !== this.turnId) return [];
    if (!this.threadId || (this.stage !== 'turn' && this.stage !== 'running')) return [];
    if (row.method === 'turn/started') { const turn = cliRecord(p.turn); if (typeof turn.id === 'string') this.turnId = turn.id; }
    if (typeof row.method === 'string' && row.method.startsWith('item/') && cliRecord(p.item).type !== 'userMessage') this.outputStarted = true;
    if (row.method === 'item/agentMessage/delta') {
      const id = protocolText(p.itemId);
      if (this.finishedItems.has(id) || typeof p.delta !== 'string') return [];
      this.text.set(id, (this.text.get(id) ?? '') + p.delta);
      return [{ type: 'text', text: p.delta }];
    }
    if (row.method === 'item/reasoning/summaryTextDelta' && typeof p.delta === 'string') return [{ type: 'reasoning', text: p.delta }];
    if (row.method === 'thread/tokenUsage/updated') {
      const usage = cliRecord(p.tokenUsage), total = tokenCounts(usage.total), last = tokenCounts(usage.last);
      // Thread totals are cumulative, so the turn is their growth. The first report fixes the
      // start: one sent before any output repeats the previous total, a later one includes its call.
      this.usageStart ??= this.outputStarted ? tokenDelta(total, last) : total;
      this.usage = { ...tokenDelta(total, this.usageStart), lastInput: last.input };
    }
    if (row.method === 'item/started' || row.method === 'item/completed') {
      const item = cliRecord(p.item), id = protocolText(item.id);
      if (!id || this.finishedItems.has(id)) return [];
      const done = row.method === 'item/completed';
      if (done) this.finishedItems.add(id);
      if (item.type === 'agentMessage' && done) {
        const final = protocolText(item.text), seen = this.text.get(id) ?? '';
        if (!final.startsWith(seen)) throw new Error('Codex changed a streamed message. Saved partial output was kept; the turn was not replayed.');
        this.text.set(id, final);
        return final.length > seen.length ? [{ type: 'text', text: final.slice(seen.length) }] : [];
      }
      if (item.type === 'commandExecution' || item.type === 'fileChange' || item.type === 'mcpToolCall') {
        const failed = item.status === 'failed' || item.status === 'declined' || (typeof item.exitCode === 'number' && item.exitCode !== 0);
        // The compatibility mode's names: Codex's own tools never borrow a Glossa tool's name and renderer.
        return [{ type: 'tool_event', id, name: item.type === 'fileChange' ? 'cli_file_change' : item.type === 'commandExecution' ? 'cli_command_execution' : 'cli_mcp_tool_call',
          args: item.type === 'fileChange' ? { changes: item.changes } : item.type === 'commandExecution' ? { command: item.command } : { server: item.server, tool: item.tool },
          status: done ? failed ? 'error' : 'success' : 'running', result: protocolText(item.aggregatedOutput, done ? protocolText(item.status) : '') }];
      }
    }
    if (row.method === 'turn/completed') {
      const turn = cliRecord(p.turn);
      if (this.turnId && turn.id !== this.turnId) return [];
      this.completed = true;
      if (turn.status !== 'completed') return [{ type: 'error', error: protocolText(cliRecord(turn.error).message, `Codex turn ${protocolText(turn.status, 'failed')}.`) }];
      return [{ type: 'final', text: [...this.text.values()].join(''), usage: this.usage }];
    }
    return [];
  }
  private get readOnly() { return this.request.execution?.mode !== 'act' || this.request.execution.permission === 'read-only'; }
  /** The cache-split marker only matters to API providers. */
  private get instructions() { return (this.request.systemPrompt ?? '').replace('<<<SYSTEM_PROMPT_DYNAMIC_BOUNDARY>>>', '').trim(); }
}
