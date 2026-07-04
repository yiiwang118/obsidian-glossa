/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-duplicate-type-constituents, @typescript-eslint/only-throw-error, @typescript-eslint/no-unused-vars -- Dynamic plugin and host-app boundaries validate these values at runtime. */
import type { TokenUsage } from '../types';

export type ChatChunk =
  | { type: 'text'; text: string }
  /** Streamed reasoning content (DeepSeek-reasoner / o-series). Visible separately;
   *  must be sent back next turn. */
  | { type: 'reasoning'; text: string }
  /** LLM is requesting that we execute this tool. Plugin's agent loop does it. */
  | { type: 'tool_call'; id: string; name: string; args: any }
  /** Tool was executed by the provider itself (e.g. CLI in full-agent mode). For display only. */
  | { type: 'tool_event'; id: string; name: string; args: any; status: 'running' | 'success' | 'error' | 'denied'; result?: string }
  | { type: 'final'; text: string; usage?: TokenUsage; reasoningContent?: string }
  /** Server rejected the prompt because it exceeded the model's context window.
   *  The agent loop should react by compacting the conversation and retrying. */
  | { type: 'context_overflow'; message: string }
  | { type: 'error'; error: string };

/** Anthropic-style content block. Mirrors @anthropic-ai/sdk's ContentBlockParam.
 *  Tools may emit any of these as their `contentBlocks` to send rich data (images,
 *  resources) back to the model. */
export type ToolContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

export interface MessageInput {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** For role='tool' — optional rich content blocks (images, etc.) sent in addition
   *  to (or in place of) the text content. When set, providers serialize as the
   *  Anthropic tool_result content array. OpenAI providers ignore non-text blocks. */
  toolContentBlocks?: ToolContentBlock[];
  /** For role='tool' — links result back to the assistant's tool_call. */
  toolCallId?: string;
  toolName?: string;
  /** For role='tool' — true when the tool errored (Anthropic: tool_result.is_error). */
  toolIsError?: boolean;
  /** For role='assistant' — preserves the structured tool_use blocks so the
   * provider can re-emit them in the API's required format (OpenAI tool_calls /
   * Anthropic content blocks). Required for multi-step agent loops. */
  toolCalls?: { id: string; name: string; args: any }[];
  /** For role='assistant' — DeepSeek-reasoner / Anthropic-thinking style models
   * require their chain-of-thought blob to be sent back as `reasoning_content`
   * on the next request. Without this the API rejects the call. */
  reasoningContent?: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: any;     // JSON schema
}

export interface ChatRequest {
  systemPrompt?: string;
  messages: MessageInput[];
  tools?: ToolSpec[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  /** Data-URI images attached to the latest user message (multimodal). */
  attachedImages?: { dataUri: string; name?: string }[];
}

export interface LLMProvider {
  id: string;
  displayName: string;
  isAvailable(): Promise<boolean>;
  defaultModel(): string;
  stream(req: ChatRequest): AsyncGenerator<ChatChunk>;
}
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-duplicate-type-constituents, @typescript-eslint/only-throw-error, @typescript-eslint/no-unused-vars */
