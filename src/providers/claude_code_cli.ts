import { spawn } from 'child_process';
import * as fs from 'fs';
import { makeChildEnv } from '../utils/env';
import type { Endpoint } from '../types';
import type { LLMProvider, ChatRequest, ChatChunk } from './types';

/**
 * `claude -p` integration.
 *
 * Two modes:
 * 1. Single-shot LLM (default): --max-turns 1 --bare, plain LLM reply
 * 2. Full agent (cliFullAgent=true): allowed tools enabled, max-turns >1; stream-json events
 *    parsed and forwarded as tool_event chunks for UI display.
 */
export class ClaudeCodeCliProvider implements LLMProvider {
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
  defaultModel() { return this.ep.model ?? 'sonnet'; }

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

  async *stream(req: ChatRequest): AsyncGenerator<ChatChunk> {
    if (!await this.isAvailable()) {
      yield { type: 'error', error: 'claude binary not found; set its absolute path in settings.' };
      return;
    }

    const args: string[] = [
      '-p',
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--no-session-persistence',
      '--model', req.model ?? this.defaultModel(),
    ];

    const fullAgent = !!this.ep.cliFullAgent;
    args.push('--max-turns', String(fullAgent ? (this.ep.maxTurns ?? 30) : 1));

    if (this.ep.bareMode ?? !fullAgent) args.push('--bare');
    if (req.systemPrompt) args.push('--append-system-prompt', req.systemPrompt);

    // Tools control
    if (fullAgent) {
      if (this.ep.claudeAllowedTools?.trim()) args.push('--allowedTools', this.ep.claudeAllowedTools.trim());
      if (this.ep.claudeDisallowedTools?.trim()) args.push('--disallowedTools', this.ep.claudeDisallowedTools.trim());
    } else {
      args.push('--disallowedTools', 'Read Edit Write Bash');   // belt-and-suspenders
    }

    // Add dirs
    for (const dir of (this.ep.claudeAddDirs ?? '').split('\n')) {
      const t = dir.trim();
      if (t) args.push('--add-dir', t);
    }

    if (this.ep.claudeMcpConfig?.trim()) args.push('--mcp-config', this.ep.claudeMcpConfig.trim());
    if (this.ep.claudeMaxBudgetUSD && this.ep.claudeMaxBudgetUSD > 0) args.push('--max-budget-usd', String(this.ep.claudeMaxBudgetUSD));
    if (this.ep.claudeFallbackModel?.trim()) args.push('--fallback-model', this.ep.claudeFallbackModel.trim());

    // Unified reasoning-effort knob → claude --thinking <value> (low/medium/high).
    // Claude CLI doesn't accept 'xhigh' — fold to 'high'.
    if (this.ep.reasoningEffort && this.ep.reasoningEffort !== 'off') {
      const level = this.ep.reasoningEffort === 'xhigh' ? 'high' : this.ep.reasoningEffort;
      args.push('--thinking', level);
    }

    for (const a of (this.ep.cliExtraArgs ?? [])) args.push(a);

    args.push(serializeMessages(req));

    const proc = spawn(this.ep.binaryPath!, args, {
      cwd: this.ep.cwd || (this as any).__fallbackCwd || process.env.HOME,
      env: makeChildEnv((this as any).__proxy),
    });
    const onAbort = () => { try { proc.kill('SIGTERM'); } catch {} };
    req.signal?.addEventListener('abort', onAbort);

    let buf = '';
    let bufText = '';
    let stderrBuf = '';
    let usage: any;
    proc.stderr.on('data', (d) => stderrBuf += d.toString());

    for await (const chunk of proc.stdout as any) {
      buf += chunk.toString('utf-8');
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const s = line.trim();
        if (!s) continue;
        let ev: any; try { ev = JSON.parse(s); } catch { continue; }

        if (ev.type === 'stream_event') {
          const e = ev.event;
          if (e?.type === 'content_block_delta' && e.delta?.type === 'text_delta' && e.delta.text) {
            yield { type: 'text', text: e.delta.text };
            bufText += e.delta.text;
          } else if (e?.type === 'content_block_start' && e.content_block?.type === 'tool_use') {
            yield { type: 'tool_event', id: e.content_block.id, name: e.content_block.name, args: e.content_block.input ?? {}, status: 'running' };
          }
        } else if (ev.type === 'assistant' && Array.isArray(ev.message?.content)) {
          if (!bufText) for (const b of ev.message.content) {
            if (b.type === 'text' && b.text) { yield { type: 'text', text: b.text }; bufText += b.text; }
          }
          // Tool use blocks in assistant message
          for (const b of ev.message.content) {
            if (b.type === 'tool_use') {
              yield { type: 'tool_event', id: b.id, name: b.name, args: b.input ?? {}, status: 'running' };
            }
          }
        } else if (ev.type === 'user' && Array.isArray(ev.message?.content)) {
          // tool_result blocks → mark previous tool_event as done
          for (const b of ev.message.content) {
            if (b.type === 'tool_result') {
              const content = typeof b.content === 'string' ? b.content
                : Array.isArray(b.content) ? b.content.map((c: any) => c.text ?? '').join('') : '';
              const status: 'success' | 'error' = b.is_error ? 'error' : 'success';
              yield { type: 'tool_event', id: b.tool_use_id, name: '', args: {}, status, result: String(content).slice(0, 4000) };
            }
          }
        } else if (ev.type === 'result') {
          usage = {
            costUSD: ev.total_cost_usd,
            input: ev.usage?.input_tokens,
            output: ev.usage?.output_tokens,
            cacheRead: ev.usage?.cache_read_input_tokens,
            cacheWrite: ev.usage?.cache_creation_input_tokens,
          };
          if (!bufText && typeof ev.result === 'string') { yield { type: 'text', text: ev.result }; bufText += ev.result; }
        }
      }
    }
    const code = await new Promise<number>(res => proc.on('close', c => res(c ?? -1)));
    req.signal?.removeEventListener('abort', onAbort);
    proc.stdout?.removeAllListeners();
    proc.stderr?.removeAllListeners();
    if (code !== 0 && !bufText) {
      yield { type: 'error', error: `claude exit ${code}: ${stderrBuf.slice(0, 400)}` };
      return;
    }
    yield { type: 'final', text: bufText, usage };
  }
}

function serializeMessages(req: ChatRequest): string {
  const parts: string[] = [];
  for (const m of req.messages) {
    const role = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : 'Tool';
    parts.push(`[${role}]\n${m.content}\n`);
  }
  return parts.join('\n');
}
