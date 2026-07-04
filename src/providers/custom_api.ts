/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-duplicate-type-constituents, @typescript-eslint/only-throw-error, @typescript-eslint/no-unused-vars -- Dynamic plugin and host-app boundaries validate these values at runtime. */
import { requestUrl } from 'obsidian';
import { isDeepSeekEndpoint, mapOpenAIReasoningEffort, type Endpoint } from '../types';
import { nativeStreamingHttpRequest } from '../utils/native_http';
import type { LLMProvider, ChatRequest, ChatChunk } from './types';

/** Strip the SYSTEM_PROMPT_DYNAMIC_BOUNDARY marker used by buildSystemPrompt() for the
 *  Anthropic two-zone cache split. Non-cacheable endpoints get a clean single string. */
function stripBoundary(s: string): string {
  return s.replace('<<<SYSTEM_PROMPT_DYNAMIC_BOUNDARY>>>', '').trim();
}

/** Heuristic: did the server reject this request because the prompt exceeded the
 *  model's context window? Different providers phrase it differently — match common
 *  forms so the agent loop can react with reactive compaction. */
function isContextOverflowError(status: number, body: string): boolean {
  if (status === 413) return true;
  if (status !== 400 && status !== 422) return false;
  return /context[_ -]?length[_ -]?exceeded|prompt is too long|maximum context|context window|tokens (?:exceed|exceeds)|too many input tokens|exceeds the maximum|input length and `max_tokens`|input is too long|exceeds [0-9]+ tokens/i.test(body);
}

/** Strip anything that looks like a bearer token / API key out of an error
 *  body before we surface it in the UI or the chat transcript. Some proxies
 *  echo the request's Authorization header back in 401/403 responses; we
 *  don't want that to land in chats.json or a screenshot. */
function redactErrorBody(s: string): string {
  return s
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/sk-[A-Za-z0-9]{20,}/g, 'sk-[REDACTED]')
    .replace(/(x-api-key["'\s:=]+)[A-Za-z0-9._-]+/gi, '$1[REDACTED]');
}

function withReasoningEffortHint(ep: Endpoint, message: string): string {
  if (ep.reasoningEffort !== 'xhigh') return message;
  return `${message}\nReasoning xhigh was sent without fallback. If this endpoint rejects it, switch Reasoning to high or lower.`;
}

/** OpenAI-compatible + Anthropic-style endpoints. */
export class CustomApiProvider implements LLMProvider {
  id: string;
  displayName: string;

  constructor(public ep: Endpoint) {
    this.id = ep.id;
    this.displayName = ep.label;
  }

  async isAvailable() {
    if (!this.ep.baseUrl || !this.ep.apiKey) return false;
    // Defence in depth: even if settings somehow stored a non-http(s) baseUrl
    // (legacy data file, manual edit), reject before issuing any request.
    try {
      const u = new URL(this.ep.baseUrl);
      if (!/^https?:$/.test(u.protocol)) return false;
    } catch { return false; }
    return true;
  }
  defaultModel() { return this.ep.model ?? ''; }

  private applyOpenAIReasoning(body: AnyValue): void {
    const effort = this.ep.reasoningEffort;
    if (isDeepSeekEndpoint(this.ep)) {
      if (effort === 'off') {
        body.thinking = { type: 'disabled' };
        return;
      }
      if (effort) body.thinking = { type: 'enabled' };
    }
    const mapped = mapOpenAIReasoningEffort(this.ep, effort);
    if (mapped) body.reasoning_effort = mapped;
  }

  private applyAnthropicThinking(body: AnyValue): void {
    if (!this.ep.reasoningEffort || this.ep.reasoningEffort === 'off') return;
    const budgets: Record<string, number> = { low: 4_000, medium: 16_000, high: 32_000, xhigh: 64_000 };
    const budget = budgets[this.ep.reasoningEffort] ?? 0;
    if (budget > 0) {
      body.thinking = { type: 'enabled', budget_tokens: budget };
      if (body.max_tokens <= budget) body.max_tokens = budget + 4096;
    }
  }

  /** Lightweight connectivity probe — HEAD /models for OpenAI-style, or POST /messages
   *  with max_tokens:1 for Anthropic-only endpoints that don't expose /models. */
  async testConnect(): Promise<{ ok: boolean; message: string }> {
    if (!this.ep.baseUrl) return { ok: false, message: 'Base URL missing.' };
    if (!this.ep.apiKey)  return { ok: false, message: 'API key missing.' };
    try {
      const style = this.ep.apiStyle ?? 'openai';
      const base = this.ep.baseUrl.replace(/\/$/, '');
      const url = style === 'anthropic' ? `${base}/messages` : `${base}/models`;
      const headers: AnyValue = { 'Content-Type': 'application/json', ...(this.ep.headers ?? {}) };
      if (style === 'anthropic') {
        headers['x-api-key'] = this.ep.apiKey;
        headers['anthropic-version'] = '2023-06-01';
        const r = await requestUrl({ url, method: 'POST', headers, throw: false,
          body: JSON.stringify({ model: this.ep.model ?? 'claude-sonnet-4-6', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }) });
        if (r.status < 400) return { ok: true, message: `HTTP 200 · ${this.ep.model ?? 'default model'}` };
        return { ok: false, message: `HTTP ${r.status}: ${redactErrorBody(r.text).slice(0, 160)}` };
      } else {
        headers['Authorization'] = `Bearer ${this.ep.apiKey}`;
        const r = await requestUrl({ url, method: 'GET', headers, throw: false });
        if (r.status < 400) {
          const j: AnyValue = r.json;
          const n = Array.isArray(j?.data) ? j.data.length : 0;
          return { ok: true, message: `HTTP 200 · ${n} models available` };
        }
        return { ok: false, message: `HTTP ${r.status}: ${redactErrorBody(r.text).slice(0, 160)}` };
      }
    } catch (e) {
      return { ok: false, message: e.message ?? String(e) };
    }
  }

  async *stream(req: ChatRequest): AsyncGenerator<ChatChunk> {
    const style = this.ep.apiStyle ?? 'openai';
    // Obsidian requestUrl path: system-proxy aware, single-shot (no streaming).
    if (this.ep.useObsidianFetch) {
      yield* this.requestNonStreaming(req, style);
      return;
    }
    if (style === 'anthropic') yield* this.streamAnthropic(req);
    else yield* this.streamOpenAI(req);
  }

  /** Non-streaming path via Obsidian's requestUrl — honors system proxy.
   *  Returns the whole text + final usage in one shot. No tool_call streaming. */
  private async *requestNonStreaming(req: ChatRequest, style: 'openai' | 'anthropic'): AsyncGenerator<ChatChunk> {
    if (style === 'anthropic') {
      const url = `${this.ep.baseUrl.replace(/\/$/, '')}/messages`;
      const headers: AnyValue = {
        'Content-Type': 'application/json',
        'x-api-key': this.ep.apiKey,
        'anthropic-version': '2023-06-01',
        ...(this.ep.headers ?? {}),
      };
      const messages: AnyValue[] = [];
      for (const m of req.messages) {
        if (m.role === 'tool') {
          let resultContent: AnyValue = m.content;
          if (m.toolContentBlocks?.length) {
            const blocks: AnyValue[] = [];
            if (m.content) blocks.push({ type: 'text', text: m.content });
            for (const b of m.toolContentBlocks) blocks.push(b);
            resultContent = blocks;
          }
          const trBlock: AnyValue = { type: 'tool_result', tool_use_id: m.toolCallId, content: resultContent };
          if (m.toolIsError) trBlock.is_error = true;
          messages.push({ role: 'user', content: [trBlock] });
        } else if (m.role === 'assistant' && m.toolCalls?.length) {
          const blocks: AnyValue[] = [];
          if (m.content) blocks.push({ type: 'text', text: m.content });
          for (const tc of m.toolCalls) blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.args ?? {} });
          messages.push({ role: 'assistant', content: blocks });
        } else if (m.role !== 'system') messages.push({ role: m.role, content: m.content });
      }
      const body: AnyValue = { model: req.model ?? this.ep.model, max_tokens: req.maxTokens ?? 4096, messages, stream: false };
      this.applyAnthropicThinking(body);
      if (req.systemPrompt) body.system = stripBoundary(req.systemPrompt);
      try {
        const r = await requestUrl({ url, method: 'POST', headers, body: JSON.stringify(body), throw: false });
        if (r.status >= 400) {
          yield { type: 'error', error: withReasoningEffortHint(this.ep, `HTTP ${r.status}: ${redactErrorBody(r.text).slice(0, 300)}`) };
          return;
        }
        const j = r.json;
        const blocks: AnyValue[] = j.content ?? [];
        const text = blocks.filter((b: AnyValue) => b.type === 'text').map((b: AnyValue) => b.text).join('');
        if (text) yield { type: 'text', text };
        // Emit any tool_use blocks as tool_call chunks. Without this, agent
        // mode under `useObsidianFetch` silently hangs: the model asked to
        // use a tool, we shrugged and only yielded the text. The next loop
        // iteration sees no tool_calls and exits as "done".
        for (const b of blocks) {
          if (b.type === 'tool_use') {
            yield { type: 'tool_call', id: String(b.id ?? Date.now().toString(36)), name: String(b.name), args: b.input ?? {} };
          }
        }
        yield { type: 'final', text, usage: { input: j.usage?.input_tokens, output: j.usage?.output_tokens } };
      } catch (e) { yield { type: 'error', error: e.message }; }
      return;
    }

    const url = `${this.ep.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const headers: AnyValue = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.ep.apiKey}`,
      ...(this.ep.headers ?? {}),
    };
    const messages: AnyValue[] = [];
    if (req.systemPrompt) messages.push({ role: 'system', content: stripBoundary(req.systemPrompt) });
    for (const m of req.messages) {
      if (m.role === 'tool') messages.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
      else if (m.role === 'assistant' && m.toolCalls?.length) {
        const out: AnyValue = {
          role: 'assistant',
          content: m.content || null,
          tool_calls: m.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.args ?? {}) },
          })),
        };
        if (m.reasoningContent) out.reasoning_content = m.reasoningContent;
        messages.push(out);
      } else if (m.role === 'assistant' && m.reasoningContent) {
        messages.push({ role: 'assistant', content: m.content, reasoning_content: m.reasoningContent });
      }
      else messages.push({ role: m.role, content: m.content });
    }
    const body: AnyValue = { model: req.model ?? this.ep.model, messages, stream: false, temperature: req.temperature ?? 0.7 };
    this.applyOpenAIReasoning(body);
    try {
      const r = await requestUrl({ url, method: 'POST', headers, body: JSON.stringify(body), throw: false });
      if (r.status >= 400) {
        yield { type: 'error', error: withReasoningEffortHint(this.ep, `HTTP ${r.status}: ${redactErrorBody(r.text).slice(0, 300)}`) };
        return;
      }
      const j = r.json;
      const msg = j.choices?.[0]?.message ?? {};
      const text = msg.content ?? '';
      if (text) yield { type: 'text', text };
      // Emit tool_calls if the model asked for them. Parallel to the
      // Anthropic non-stream path above — without this, useObsidianFetch +
      // agent mode silently exits after the first turn even when the model
      // wanted to invoke a tool.
      const toolCalls: AnyValue[] = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
      for (const tc of toolCalls) {
        const fn = tc.function ?? {};
        let args: AnyValue = {};
        if (typeof fn.arguments === 'string' && fn.arguments) {
          try { args = JSON.parse(fn.arguments); }
          catch (e) {
            // Non-empty but unparsable args — surface as error chunk rather
            // than silently dispatching with {}. See issue 1.12.
            yield { type: 'error', error: `Tool call "${fn.name}" had unparsable arguments: ${e}` };
            continue;
          }
        }
        yield { type: 'tool_call', id: String(tc.id ?? Date.now().toString(36)), name: String(fn.name ?? 'unknown'), args };
      }
      yield { type: 'final', text, usage: j.usage ? { input: j.usage.prompt_tokens, output: j.usage.completion_tokens } : undefined };
    } catch (e) { yield { type: 'error', error: e.message }; }
  }

  /** Hit /v1/models to discover available models. Returns [] on failure.
   *  Honors useObsidianFetch so users behind system proxy can still detect. */
  async listModels(): Promise<string[]> {
    if (!this.ep.baseUrl || !this.ep.apiKey) return [];
    const style = this.ep.apiStyle ?? 'openai';
    const url = `${this.ep.baseUrl.replace(/\/$/, '')}/models`;
    const headers: AnyValue = style === 'anthropic'
      ? { 'x-api-key': this.ep.apiKey, 'anthropic-version': '2023-06-01', ...(this.ep.headers ?? {}) }
      : { 'Authorization': `Bearer ${this.ep.apiKey}`, ...(this.ep.headers ?? {}) };
    try {
      const r = await requestUrl({ url, method: 'GET', headers, throw: false });
      const body = (r.text ?? '').trim();
      const looksHtml = /^<!doctype html/i.test(body) || /^<html[\s>]/i.test(body);
      if (r.status >= 400) {
        if (style === 'anthropic') return ANTHROPIC_KNOWN_MODELS;
        throw new Error(`GET /models returned HTTP ${r.status}${body ? `: ${body.slice(0, 160)}` : ''}`);
      }
      if (looksHtml) {
        throw new Error('GET /models returned HTML, not JSON. Check that Base URL points to the API root, e.g. https://host/v1.');
      }
      let j: AnyValue;
      try {
        j = r.json;
      } catch {
        throw new Error(`GET /models returned non-JSON${body ? `: ${body.slice(0, 160)}` : '.'}`);
      }
      const ids = (j.data ?? []).map((m: AnyValue) => m.id ?? m.name).filter(Boolean);
      const sorted = [...new Set<string>(ids)].sort();
      if (sorted.length) return sorted;
      return style === 'anthropic' ? ANTHROPIC_KNOWN_MODELS : [];
    } catch (e) {
      console.warn('[plugin] listModels failed', e);
      if (style === 'anthropic') return ANTHROPIC_KNOWN_MODELS;
      throw e instanceof Error ? e : new Error(String(e));
    }
  }

  /* ---------------- OpenAI-compatible ---------------- */
  private async *streamOpenAI(req: ChatRequest): AsyncGenerator<ChatChunk> {
    const url = `${this.ep.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const headers: AnyValue = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.ep.apiKey}`,
      ...(this.ep.headers ?? {}),
    };
    const messages: AnyValue[] = [];
    if (req.systemPrompt) messages.push({ role: 'system', content: stripBoundary(req.systemPrompt) });
    // Identify the index of the last user message so we can attach images there.
    const lastUserIdx = (() => {
      for (let i = req.messages.length - 1; i >= 0; i--) if (req.messages[i].role === 'user') return i;
      return -1;
    })();
    for (let i = 0; i < req.messages.length; i++) {
      const m = req.messages[i];
      if (m.role === 'tool') { messages.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content }); continue; }
      if (m.role === 'assistant' && m.toolCalls?.length) {
        // OpenAI canonical: assistant message with tool_calls array
        const out: AnyValue = {
          role: 'assistant',
          content: m.content || null,
          tool_calls: m.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.args ?? {}) },
          })),
        };
        // DeepSeek-reasoner requires reasoning_content echoed back. Pass-through.
        if (m.reasoningContent) out.reasoning_content = m.reasoningContent;
        messages.push(out);
        continue;
      }
      // Even without tool_calls, pass reasoning_content if present (some providers want it)
      if (m.role === 'assistant' && m.reasoningContent) {
        messages.push({ role: 'assistant', content: m.content, reasoning_content: m.reasoningContent });
        continue;
      }
      if (i === lastUserIdx && req.attachedImages?.length) {
        const parts: AnyValue[] = [{ type: 'text', text: m.content }];
        for (const img of req.attachedImages) parts.push({ type: 'image_url', image_url: { url: img.dataUri } });
        messages.push({ role: m.role, content: parts });
      } else {
        messages.push({ role: m.role, content: m.content });
      }
    }
    const body: AnyValue = {
      model: req.model ?? this.ep.model,
      messages,
      stream: true,
      temperature: req.temperature ?? 0.7,
      stream_options: { include_usage: true },   // OpenAI usage in stream
    };
    if (req.maxTokens) body.max_tokens = req.maxTokens;
    if (req.tools?.length) body.tools = req.tools.map(t => ({
      type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
    this.applyOpenAIReasoning(body);

    let resp: Response;
    try {
      resp = await nativeStreamingHttpRequest(url, { method: 'POST', headers, body: JSON.stringify(body), signal: req.signal });
    } catch (e) {
      yield { type: 'error', error: `network: ${e.message}` };
      return;
    }
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      if (isContextOverflowError(resp.status, txt)) {
        yield { type: 'context_overflow', message: `HTTP ${resp.status}: ${redactErrorBody(txt).slice(0, 200)}` };
        return;
      }
      yield { type: 'error', error: withReasoningEffortHint(this.ep, `HTTP ${resp.status}: ${redactErrorBody(txt).slice(0, 400)}`) };
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let bufText = '';
    let bufReasoning = '';      // DeepSeek-reasoner style
    let usage: AnyValue;
    const toolCalls = new Map<number, { id: string; name: string; argsStr: string }>();

    // Idle watchdog — if no chunk in 90s, cancel the reader so the agent loop doesn't
    // sit there forever waiting on a silently-dropped TCP connection.
    let lastChunkAt = Date.now();
    let timedOut = false;
    const watchdog = window.setInterval(() => {
      if (Date.now() - lastChunkAt > 90_000) {
        timedOut = true;
        try { void reader.cancel('idle timeout (90s)'); } catch { /* ignore */ }
        window.clearInterval(watchdog);
      }
    }, 5000);

    try {
    // searchStart tracks where we last scanned for '\n'. Each chunk only
    // searches the NEW bytes for newlines rather than re-splitting the
    // entire accumulated buf — which would degrade to O(N²) if a single
    // tool-call's JSON args spans many chunks without an embedded newline
    // (rare but possible on misbehaving proxies that don't honor SSE
    // line-chunking).
    let searchStart = 0;
    while (true) {
      const { value, done } = await reader.read();
      lastChunkAt = Date.now();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // Find every newline in the new region only.
      let nlIdx = buf.indexOf('\n', searchStart);
      while (nlIdx !== -1) {
        const raw = buf.slice(0, nlIdx);
        buf = buf.slice(nlIdx + 1);
        searchStart = 0;
        const line = raw.trim();
        if (line.startsWith('data:')) {
          const data = line.slice(5).trim();
          if (data !== '[DONE]') {
            let ev: AnyValue;
            try { ev = JSON.parse(data); }
            catch { ev = null; }
            if (ev) {
              const delta = ev.choices?.[0]?.delta;
              if (delta?.content) { yield { type: 'text', text: delta.content }; bufText += delta.content; }
              // DeepSeek-reasoner: reasoning stream before content.
              if (delta?.reasoning_content) {
                yield { type: 'reasoning', text: delta.reasoning_content };
                bufReasoning += delta.reasoning_content;
              }
              if (delta?.tool_calls) for (const tc of delta.tool_calls) {
                const slot = toolCalls.get(tc.index ?? 0) ?? { id: '', name: '', argsStr: '' };
                if (tc.id) slot.id = tc.id;
                if (tc.function?.name) slot.name = tc.function.name;
                if (tc.function?.arguments) slot.argsStr += tc.function.arguments;
                toolCalls.set(tc.index ?? 0, slot);
              }
              if (ev.usage) usage = ev.usage;
            }
          }
        }
        nlIdx = buf.indexOf('\n');
      }
      // No more newlines in current buf — next chunk only scans from current length.
      searchStart = buf.length;
    }
    } finally {
      window.clearInterval(watchdog);
    }
    if (timedOut) {
      yield { type: 'error', error: 'No data from server for 90s — connection timed out. The model or proxy may have dropped the stream.' };
      return;
    }
    for (const slot of toolCalls.values()) {
      // Empty argsStr → tool takes no arguments → {} is correct.
      // Non-empty but unparsable → stream was truncated mid-JSON; surface
      // as an error chunk instead of silently dispatching with {}. Without
      // this the model thinks the tool ran with no args and proceeds to
      // build on garbage results.
      if (slot.argsStr === '' || slot.argsStr == null) {
        yield { type: 'tool_call', id: slot.id, name: slot.name, args: {} };
        continue;
      }
      try {
        const args = JSON.parse(slot.argsStr);
        yield { type: 'tool_call', id: slot.id, name: slot.name, args };
      } catch (e) {
        yield { type: 'error', error: `Tool call "${slot.name}" had truncated/unparsable JSON args from stream — likely the proxy dropped the connection mid-message.` };
      }
    }
    yield {
      type: 'final', text: bufText,
      reasoningContent: bufReasoning || undefined,
      usage: usage ? {
        input: usage.prompt_tokens, output: usage.completion_tokens,
        cacheRead: usage.prompt_tokens_details?.cached_tokens,
      } : undefined,
    };
  }

  /* ---------------- Anthropic-compatible ---------------- */
  private async *streamAnthropic(req: ChatRequest): AsyncGenerator<ChatChunk> {
    const url = `${this.ep.baseUrl.replace(/\/$/, '')}/messages`;
    const headers: AnyValue = {
      'Content-Type': 'application/json',
      'x-api-key': this.ep.apiKey,
      'anthropic-version': '2023-06-01',
      ...(this.ep.headers ?? {}),
    };
    const messages: AnyValue[] = [];
    const lastUserIdx = (() => {
      for (let i = req.messages.length - 1; i >= 0; i--) if (req.messages[i].role === 'user') return i;
      return -1;
    })();
    for (let i = 0; i < req.messages.length; i++) {
      const m = req.messages[i];
      if (m.role === 'tool') {
        // Rich content: prefer toolContentBlocks (images/etc) over plain text.
        // Anthropic tool_result content can be either a string OR an array of content blocks.
        let resultContent: AnyValue;
        if (m.toolContentBlocks?.length) {
          // Send blocks PLUS the text as a leading text block for context
          const blocks: AnyValue[] = [];
          if (m.content) blocks.push({ type: 'text', text: m.content });
          for (const b of m.toolContentBlocks) blocks.push(b);
          resultContent = blocks;
        } else {
          resultContent = m.content;
        }
        const trBlock: AnyValue = { type: 'tool_result', tool_use_id: m.toolCallId, content: resultContent };
        if (m.toolIsError) trBlock.is_error = true;
        messages.push({ role: 'user', content: [trBlock] });
        continue;
      }
      if (m.role === 'system') continue;
      if (m.role === 'assistant' && m.toolCalls?.length) {
        // Anthropic canonical: assistant content is an array of text + tool_use blocks
        const blocks: AnyValue[] = [];
        if (m.content) blocks.push({ type: 'text', text: m.content });
        for (const tc of m.toolCalls) blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.args ?? {} });
        messages.push({ role: 'assistant', content: blocks });
        continue;
      }
      if (i === lastUserIdx && req.attachedImages?.length) {
        const blocks: AnyValue[] = [{ type: 'text', text: m.content }];
        for (const img of req.attachedImages) {
          const match = img.dataUri.match(/^data:([^;]+);base64,(.+)$/);
          if (match) blocks.push({ type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } });
        }
        messages.push({ role: m.role, content: blocks });
      } else {
        messages.push({ role: m.role, content: m.content });
      }
    }
    const body: AnyValue = {
      model: req.model ?? this.ep.model,
      max_tokens: req.maxTokens ?? 4096,
      messages,
      stream: true,
    };
    this.applyAnthropicThinking(body);
    // Anthropic prompt caching (ephemeral). Claude models: cache the system prompt,
    // the tool definitions, AND the last user message — mirrors upstream Claude Code,
    // which places one message-level marker per request on the last user msg.
    const modelName = (req.model ?? this.ep.model ?? '').toLowerCase();
    const cacheable = modelName.includes('claude');
    if (req.systemPrompt) {
      // Honour the SYSTEM_PROMPT_DYNAMIC_BOUNDARY split if present: send the prompt as
      // TWO blocks with cache_control only on the static head. This way the per-turn
      // volatile tail (date, mode toggle, project ctx) doesn't invalidate the cache.
      const BOUNDARY = '<<<SYSTEM_PROMPT_DYNAMIC_BOUNDARY>>>';
      const parts = req.systemPrompt.split(BOUNDARY);
      if (cacheable && parts.length === 2) {
        body.system = [
          { type: 'text', text: parts[0].trimEnd(), cache_control: { type: 'ephemeral' } },
          { type: 'text', text: parts[1].trimStart() },
        ];
      } else if (cacheable) {
        body.system = [{ type: 'text', text: req.systemPrompt.replace(BOUNDARY, '').trim(), cache_control: { type: 'ephemeral' } }];
      } else {
        body.system = req.systemPrompt.replace(BOUNDARY, '').trim();
      }
    }
    if (cacheable && messages.length > 0) {
      // Find the last user message in the FINAL request (after tool→user remapping) and
      // attach cache_control to its last content block. If the content is a plain string,
      // promote to a single text block first.
      for (let k = messages.length - 1; k >= 0; k--) {
        if (messages[k].role !== 'user') continue;
        if (typeof messages[k].content === 'string') {
          messages[k] = { role: 'user', content: [{ type: 'text', text: messages[k].content }] };
        }
        const arr = messages[k].content as AnyValue[];
        if (arr.length) {
          arr[arr.length - 1] = { ...arr[arr.length - 1], cache_control: { type: 'ephemeral' } };
        }
        break;
      }
    }
    if (req.tools?.length) {
      body.tools = req.tools.map((t, i, arr) => ({
        name: t.name, description: t.description, input_schema: t.parameters,
        ...(cacheable && i === arr.length - 1 ? { cache_control: { type: 'ephemeral' } } : {}),
      }));
    }

    const resp = await nativeStreamingHttpRequest(url, { method: 'POST', headers, body: JSON.stringify(body), signal: req.signal });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      if (isContextOverflowError(resp.status, txt)) {
        yield { type: 'context_overflow', message: `HTTP ${resp.status}: ${redactErrorBody(txt).slice(0, 200)}` };
        return;
      }
      yield { type: 'error', error: withReasoningEffortHint(this.ep, `HTTP ${resp.status}: ${redactErrorBody(txt).slice(0, 400)}`) };
      return;
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = ''; let bufText = '';
    const toolBuffers = new Map<number, { id: string; name: string; argsStr: string }>();
    let usage: AnyValue;

    let lastChunkAt = Date.now();
    let timedOut = false;
    const watchdog = window.setInterval(() => {
      if (Date.now() - lastChunkAt > 90_000) {
        timedOut = true;
        try { void reader.cancel('idle timeout (90s)'); } catch { /* ignore */ }
        window.clearInterval(watchdog);
      }
    }, 5000);

    try {
    // searchStart-style newline scan — see OpenAI streaming path above for
    // rationale. Avoids re-splitting the entire buf on every chunk arrival
    // when a tool-call's JSON args runs long without an embedded newline.
    let searchStart = 0;
    while (true) {
      const { value, done } = await reader.read();
      lastChunkAt = Date.now();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nlIdx = buf.indexOf('\n', searchStart);
      while (nlIdx !== -1) {
        const raw = buf.slice(0, nlIdx);
        buf = buf.slice(nlIdx + 1);
        searchStart = 0;
        const line = raw.trim();
        if (line.startsWith('data:')) {
          const data = line.slice(5).trim();
          if (data) {
            let ev: AnyValue; try { ev = JSON.parse(data); } catch { ev = null; }
            if (ev) {
              if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
                toolBuffers.set(ev.index, { id: ev.content_block.id, name: ev.content_block.name, argsStr: '' });
              } else if (ev.type === 'content_block_delta') {
                if (ev.delta?.type === 'text_delta') { yield { type: 'text', text: ev.delta.text }; bufText += ev.delta.text; }
                else if (ev.delta?.type === 'input_json_delta') {
                  const slot = toolBuffers.get(ev.index); if (slot) slot.argsStr += ev.delta.partial_json ?? '';
                }
              } else if (ev.type === 'message_delta' && ev.usage) usage = ev.usage;
            }
          }
        }
        nlIdx = buf.indexOf('\n');
      }
      searchStart = buf.length;
    }
    } finally {
      window.clearInterval(watchdog);
    }
    if (timedOut) {
      yield { type: 'error', error: 'No data from server for 90s — connection timed out. The model or proxy may have dropped the stream.' };
      return;
    }
    for (const slot of toolBuffers.values()) {
      // Same partial-JSON guard as the OpenAI path: empty → {}; non-empty
      // but unparsable → error chunk so we don't dispatch with garbage.
      if (slot.argsStr === '' || slot.argsStr == null) {
        yield { type: 'tool_call', id: slot.id, name: slot.name, args: {} };
        continue;
      }
      try {
        const args = JSON.parse(slot.argsStr);
        yield { type: 'tool_call', id: slot.id, name: slot.name, args };
      } catch (e) {
        yield { type: 'error', error: `Tool call "${slot.name}" had truncated/unparsable JSON args from stream — likely the proxy dropped the connection mid-message.` };
      }
    }
    yield { type: 'final', text: bufText, usage: usage ? {
      input: usage.input_tokens, output: usage.output_tokens,
      cacheRead: usage.cache_read_input_tokens, cacheWrite: usage.cache_creation_input_tokens,
    } : undefined };
  }
}

const ANTHROPIC_KNOWN_MODELS = [
  'claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5',
  'claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest',
];
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-duplicate-type-constituents, @typescript-eslint/only-throw-error, @typescript-eslint/no-unused-vars -- Re-enable review lint rules after dynamic boundary module. */
