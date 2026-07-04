/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- Dynamic plugin, model, and vault payloads are validated at runtime boundaries. */
import type { Endpoint } from '../types';
import { effectiveProxy } from '../types';
import type { LLMProvider, ChatRequest, ChatChunk } from './types';
import { CustomApiProvider } from './custom_api';

class CommunityDisabledProvider implements LLMProvider {
  id: string;
  displayName: string;

  constructor(private ep: Endpoint) {
    this.id = ep.id;
    this.displayName = ep.label;
  }

  async isAvailable() { return false; }
  defaultModel() { return this.ep.model ?? ''; }
  async testConnect(): Promise<{ ok: boolean; message: string }> {
    return {
      ok: false,
      message: 'Local CLI providers are not included in the community review build. Use a Custom API endpoint.',
    };
  }
  async *stream(_req: ChatRequest): AsyncGenerator<ChatChunk> {
    void _req;
    yield {
      type: 'error',
      error: 'Local CLI providers are not included in the community review build. Use a Custom API endpoint.',
    };
  }
}

export function buildProvider(ep: Endpoint, globalProxy: string, fallbackCwd?: string): LLMProvider {
  const proxy = effectiveProxy(ep, globalProxy);
  let p: LLMProvider;
  switch (ep.kind) {
    case 'codex-cli':       p = new CommunityDisabledProvider(ep); break;
    case 'claude-code-cli': p = new CommunityDisabledProvider(ep); break;
    case 'custom-api':      p = new CustomApiProvider(ep); break;
  }
  (p as any).__proxy = proxy;
  (p as any).__fallbackCwd = fallbackCwd;
  return p;
}
