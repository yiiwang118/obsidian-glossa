import type { Endpoint } from '../types';
import { effectiveProxy } from '../types';
import type { LLMProvider } from './types';
import { CustomApiProvider } from './custom_api';
import { LocalCliProvider } from './local_cli';

export function buildProvider(ep: Endpoint, globalProxy: string, fallbackCwd?: string): LLMProvider {
  const proxy = effectiveProxy(ep, globalProxy);
  let p: LLMProvider;
  switch (ep.kind) {
    case 'codex-cli':       p = new LocalCliProvider(ep, fallbackCwd, proxy); break;
    case 'claude-code-cli': p = new LocalCliProvider(ep, fallbackCwd, proxy); break;
    case 'grok-cli':        p = new LocalCliProvider(ep, fallbackCwd, proxy); break;
    case 'custom-api':      p = new CustomApiProvider(ep); break;
  }
  (p as AnyValue).__proxy = proxy;
  (p as AnyValue).__fallbackCwd = fallbackCwd;
  return p;
}

/** Conservative capability gate for the document-block path. */
export function supportsNativePdfInput(ep: Endpoint): boolean {
  if (ep.kind !== 'custom-api') return false;
  const model = (ep.model ?? '').toLowerCase();
  if (ep.apiStyle === 'anthropic') return model.includes('claude');
  return model.includes('claude') || model.includes('gemini');
}
