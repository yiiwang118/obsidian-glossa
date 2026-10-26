import type { ChatRequest, MessageInput } from '../providers/types';
import type { Endpoint, TokenUsage } from '../types';

/** Keep the last request's system, tools and message prefix for a possible cache hit.
 * Image attachments target the latest user message, so those requests are excluded. */
export function cacheablePrefix(request: ChatRequest, answer: MessageInput): ChatRequest | undefined {
  if (request.attachedImages?.length || request.nativeSession) return;
  const value = JSON.stringify({ systemPrompt: request.systemPrompt, tools: request.tools, model: request.model,
    temperature: request.temperature, messages: [...request.messages, answer] });
  if (value.length > 2_000_000) return;
  return JSON.parse(value) as ChatRequest;
}

/** Prompt size of one request. Anthropic counts cached tokens apart from `input_tokens`;
 *  OpenAI-compatible `prompt_tokens` already include them. */
export function requestPromptTokens(usage: TokenUsage | undefined, apiStyle: Endpoint['apiStyle']): number {
  if (!usage) return 0;
  const input = usage.input ?? 0;
  return apiStyle === 'anthropic' ? input + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0) : input;
}

/** The cache lifetime is supplied by the user for the endpoint; it is never inferred from a model name. */
export function idleCompactDelay(options: { enabled: boolean; api: boolean; cacheSeconds?: number; inputTokens: number; finishedAt: number; now: number }): number | null {
  const { enabled, api, cacheSeconds, inputTokens, finishedAt, now } = options;
  if (!enabled || !api || !Number.isFinite(cacheSeconds) || cacheSeconds < 60 || cacheSeconds > 86400 || !Number.isFinite(inputTokens) || inputTokens < 100000) return null;
  const ttl = cacheSeconds * 1000;
  if (now >= finishedAt + ttl) return null;
  return Math.max(0, finishedAt + ttl - Math.min(ttl * 0.2, 120000) - now);
}

interface TimerClock { set(callback: () => void, delay: number): number; clear(timer: number): void }

/** One opportunity per completed turn. Activity cancels it rather than delaying a paid request indefinitely. */
export class IdleCompactor {
  private readonly pending = new Map<string, { controller: AbortController; timer?: number }>();
  constructor(private readonly clock: TimerClock = { set: (fn, ms) => window.setTimeout(fn, ms), clear: id => window.clearTimeout(id) }) {}
  schedule(id: string, delay: number, ready: () => boolean, run: (signal: AbortSignal) => Promise<void>, failed: (error: unknown) => void) {
    this.cancel(id);
    const entry = { controller: new AbortController(), timer: undefined as number | undefined };
    this.pending.set(id, entry);
    entry.timer = this.clock.set(() => {
      entry.timer = undefined;
      void (async () => {
        try { if (!entry.controller.signal.aborted && ready()) await run(entry.controller.signal); }
        catch (error) { if (!entry.controller.signal.aborted) failed(error); }
        finally { if (this.pending.get(id) === entry) this.pending.delete(id); }
      })();
    }, delay);
  }
  cancel(id: string) {
    const entry = this.pending.get(id);
    if (!entry) return;
    if (entry.timer !== undefined) this.clock.clear(entry.timer);
    entry.controller.abort(); this.pending.delete(id);
  }
  stop() { for (const id of [...this.pending.keys()]) this.cancel(id); }
}
