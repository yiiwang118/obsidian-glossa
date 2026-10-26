import type { ToolArguments } from '../agent/tool_arguments';

/** JSON protocol fields used by the OpenAI/Anthropic compatible adapters.
 * Unknown vendor extensions are retained but never given an implicit any type. */
export interface WireBlock {
  [key: string]: unknown;
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: ToolArguments;
  thinking?: string;
  signature?: string;
  content?: string | WireBlock[];
  is_error?: boolean;
  cache_control?: { type: string; ttl?: string };
}
export interface WireFunctionCall {
  index?: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}
export interface WireMessage {
  role: string;
  content: string | WireBlock[];
  tool_call_id?: string;
  tool_calls?: WireFunctionCall[];
  reasoning_content?: string;
}
export interface WireUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
}
interface WireDelta {
  type?: string;
  text?: string;
  thinking?: string;
  signature?: string;
  partial_json?: string;
  stop_reason?: string;
}
interface WireReplyMessage {
  content?: string;
  reasoning?: string;
  reasoning_content?: string;
  tool_calls?: WireFunctionCall[];
}
export interface WireReply {
  choices?: Array<{ message?: WireReplyMessage; delta?: WireReplyMessage }>;
  content?: WireBlock[];
  usage?: WireUsage;
  stop_reason?: string;
  data?: Array<{ id?: string; name?: string }>;
  type?: string;
  index?: number;
  delta?: WireDelta;
  content_block?: WireBlock;
}
export interface WireRequestBody extends Record<string, unknown> {
  model?: string;
  messages?: WireMessage[];
  max_tokens?: number;
  system?: string | WireBlock[];
  output_config?: Record<string, unknown>;
}
