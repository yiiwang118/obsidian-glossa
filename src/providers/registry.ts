/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- Dynamic plugin, model, and vault payloads are validated at runtime boundaries. */
import type { Endpoint } from '../types';
import { effectiveProxy } from '../types';
import type { LLMProvider } from './types';
import { CustomApiProvider } from './custom_api';
import { CodexCliProvider } from './codex_cli';
import { ClaudeCodeCliProvider } from './claude_code_cli';

export function buildProvider(ep: Endpoint, globalProxy: string, fallbackCwd?: string): LLMProvider {
  const proxy = effectiveProxy(ep, globalProxy);
  let p: LLMProvider;
  switch (ep.kind) {
    case 'codex-cli':       p = new CodexCliProvider(ep); break;
    case 'claude-code-cli': p = new ClaudeCodeCliProvider(ep); break;
    case 'custom-api':      p = new CustomApiProvider(ep); break;
  }
  (p as any).__proxy = proxy;
  (p as any).__fallbackCwd = fallbackCwd;
  return p;
}
