
/**
 * Auto-compaction — long conversations get summarised into a single assistant turn
 * before token budget runs out. Mirrors upstream Claude Code's reactive compact flow.
 *
 * Strategy:
 *  1. Estimate session tokens (sum of message + reasoning + tool result text).
 *  2. When usage > settings.autoCompactThresholdPct × maxContextTokens, request a
 *     summary from the model.
 *  3. Replace messages[0..N-1] (everything BEFORE the latest unfinished user turn)
 *     with a single assistant message that has compactSummary=true.
 *  4. The agent loop sends the summary like a regular assistant turn — the model
 *     reads it as a recap and continues from there.
 *
 * Token estimation is approximate (chars-based heuristic, same as utils/tokens.ts).
 * Good enough to drive a threshold; not a tiktoken substitute.
 */

import type { ChatMessage, ChatSession } from '../types';
import { estimateTokens } from '../utils/tokens';
import type { LLMProvider, MessageInput } from '../providers/types';
import { uid } from '../utils/dom';

/** Rough token count of a single message — text + reasoning + each tool event's args+result. */
export function estimateMessageTokens(m: ChatMessage): number {
  let n = estimateTokens(m.content);
  if (m.reasoningContent) n += estimateTokens(m.reasoningContent);
  if (m.selectionEcho?.text) n += estimateTokens(m.selectionEcho.text);
  for (const ev of m.toolEvents ?? []) {
    n += estimateTokens(JSON.stringify(ev.args ?? {}));
    n += estimateTokens(ev.result ?? '');
  }
  return n;
}

/** Sum tokens across a whole session. */
export function estimateSessionTokens(session: ChatSession): number {
  let n = 0;
  for (const m of session.messages) n += estimateMessageTokens(m);
  return n;
}

const SUMMARY_SYSTEM_PROMPT = `You are summarising an in-progress chat session for context compression. Produce a dense, factual restart record so another assistant can resume without guessing.

The transcript may contain blocks marked [PRIOR SUMMARY — …]. Those are summaries from a previous compaction round; treat their content as fully authoritative for everything they cover, and CARRY THEIR INFORMATION FORWARD into your new summary without loss. Merge it with the newer turns.

MUST preserve:
- The latest explicit user goal and the exact target being discussed
- Every user correction, preference, constraint, language request, and change of intent
- Every file path, URL, DOI, title, version, ID, and output destination needed to continue
- Tool attempts and their concrete outcomes; retain exact error text for failed approaches
- Decisions and why they were made
- Completed work, open questions, blockers, pending actions, and the single best next step
- All information from [PRIOR SUMMARY] blocks

MUST drop:
- Verbose model reasoning / chain-of-thought (keep only conclusions)
- Full file contents (replace with paths + brief description)
- Repeated apologies, hedging, or filler

Output exactly these markdown sections:
### Active task and target
### User corrections and response preferences
### Key entities and evidence
### Attempts, failures, and decisions
### Completed and pending
### Recent user messages (verbatim)
### Next action

Write in the language requested by the latest user message. If no language was requested, use the dominant language of recent user messages, not the language of attached source material. Aim for 700–1,400 tokens, with no preamble or commentary about summarisation.`;

interface BuildTranscriptOptions {
  /** Keep the most recent N messages OUT of the summary (they stay in the live history). */
  keepRecent: number;
  /** Max chars per individual message body in the transcript. */
  perMsgCap: number;
  /** Total transcript cap; keeps the compaction request below the model window. */
  maxTranscriptChars: number;
}

export function buildCompactionTranscript(messages: ChatMessage[], opts: BuildTranscriptOptions): { transcript: string; summarisedCount: number; tokensSaved: number } {
  const cutoff = Math.max(0, messages.length - opts.keepRecent);
  const toSummarise = messages.slice(0, cutoff);
  if (toSummarise.length === 0) return { transcript: '', summarisedCount: 0, tokensSaved: 0 };

  const blocks: Array<{ index: number; text: string; mandatory: boolean }> = [];
  let tokensSaved = 0;
  for (let index = 0; index < toSummarise.length; index++) {
    const m = toSummarise[index];
    tokensSaved += estimateMessageTokens(m);
    if (m.role === 'tool') {
      // Tool results are referenced via the parent assistant's toolEvents — skip the bare role:tool dump
      continue;
    }
    // Earlier compactSummary messages are surfaced explicitly so the new summary
    // doesn't drop their content — they're the load-bearing recap of even-older turns.
    if (m.compactSummary) {
      blocks.push({
        index,
        text: `[PRIOR SUMMARY — already represents ${m.summaryOfCount ?? '?'} earlier msgs, depth ${m.summaryDepth ?? 1}]\n${(m.content ?? '').trim()}`,
        mandatory: true,
      });
      continue;
    }
    const label = m.role === 'user' ? 'USER' : 'ASSISTANT';
    let body = (m.role === 'user' ? (m.displayContent ?? m.content) : m.content ?? '').trim();
    if (body.length > opts.perMsgCap) body = body.slice(0, opts.perMsgCap) + ` …[${body.length - opts.perMsgCap} chars truncated]`;
    const parts = [`[${label}]\n${body}`];
    if (m.role === 'user' && m.selectionEcho?.text) {
      const selection = m.selectionEcho.text.slice(0, 700);
      parts.push(`[SELECTION CONTEXT: ${m.selectionEcho.source}${m.selectionEcho.file ? ` · ${m.selectionEcho.file}` : ''}]\n${selection}${m.selectionEcho.text.length > selection.length ? '\n[selection truncated]' : ''}`);
    }
    if (m.toolEvents?.length) {
      const tools = m.toolEvents
        .map(ev => {
          const argSummary = JSON.stringify(ev.args ?? {}).slice(0, 500);
          const resultLimit = ev.status === 'error' || ev.status === 'denied' ? 900 : 500;
          const resSummary = (ev.result ?? '').slice(0, resultLimit);
          return `  · ${ev.name}(${argSummary}) → ${ev.status}: ${resSummary}`;
        })
        .join('\n');
      parts.push(`[TOOLS]\n${tools}`);
    }
    blocks.push({ index, text: parts.join('\n\n'), mandatory: index < 4 });
  }
  return {
    transcript: fitTranscriptBlocks(blocks, opts.maxTranscriptChars),
    summarisedCount: toSummarise.length,
    tokensSaved,
  };
}

export interface CompactOptions {
  provider: LLMProvider;
  model?: string;
  /** Keep the most recent N messages live (default 2 — last user + last assistant). */
  keepRecent?: number;
  /** Per-message char cap when building the transcript (default 4000). */
  perMsgCap?: number;
  /** Total transcript char cap (default 240000). */
  maxTranscriptChars?: number;
  signal?: AbortSignal;
}

export interface CompactResult {
  /** The summary message to splice in. Caller is responsible for replacing the
   *  session's messages array (typically: `[summaryMsg, ...messages.slice(cutoff)]`). */
  summaryMsg: ChatMessage;
  summarisedCount: number;
  tokensSaved: number;
}

/** Run the summarisation request and produce a single compactSummary assistant message.
 *  Throws on provider error so callers can decide whether to abort the turn. */
export async function compactSession(session: ChatSession, opts: CompactOptions): Promise<CompactResult | null> {
  const keepRecent = opts.keepRecent ?? 2;
  const perMsgCap = opts.perMsgCap ?? 4000;
  const maxTranscriptChars = opts.maxTranscriptChars ?? 240_000;

  // Don't compact if there's nothing meaningful to compact
  if (session.messages.length <= keepRecent + 1) return null;

  const { transcript, summarisedCount, tokensSaved } = buildCompactionTranscript(session.messages, {
    keepRecent,
    perMsgCap,
    maxTranscriptChars,
  });
  if (summarisedCount === 0 || !transcript) return null;

  const messages: MessageInput[] = [
    { role: 'user', content: `Summarise the following chat session so far.\n\n---\n\n${transcript}` },
  ];

  let summaryText = '';
  for await (const ch of opts.provider.stream({
    systemPrompt: SUMMARY_SYSTEM_PROMPT,
    messages,
    model: opts.model,
    maxTokens: 3000,
    signal: opts.signal,
  })) {
    if (ch.type === 'text') summaryText += ch.text;
    else if (ch.type === 'error') throw new Error(`Compact failed: ${ch.error}`);
    else if (ch.type === 'final') { if (!summaryText && ch.text) summaryText = ch.text; }
  }
  summaryText = summaryText.trim();
  if (!summaryText) throw new Error('Compact failed: model returned empty summary');

  // Track recursive depth: if the messages we're absorbing already contain a summary,
  // the new summary's depth is one greater than the deepest one we're folding in.
  let inheritedDepth = 0;
  for (const m of session.messages.slice(0, session.messages.length - keepRecent)) {
    if (m.compactSummary) inheritedDepth = Math.max(inheritedDepth, m.summaryDepth ?? 1);
  }

  const summaryMsg: ChatMessage = {
    id: uid(),
    role: 'assistant',
    content: summaryText,
    timestamp: Date.now(),
    compactSummary: true,
    summaryOfCount: summarisedCount,
    summaryTokensSaved: tokensSaved,
    summaryDepth: inheritedDepth + 1,
  };
  return { summaryMsg, summarisedCount, tokensSaved };
}

function fitTranscriptBlocks(
  blocks: readonly { index: number; text: string; mandatory: boolean }[],
  maxChars: number,
): string {
  const full = blocks.map(block => block.text).join('\n\n');
  if (full.length <= maxChars) return full;

  const selected = new Map<number, string>();
  let used = 0;
  for (const block of blocks) {
    if (!block.mandatory) continue;
    if (used + block.text.length > Math.floor(maxChars * 0.45)) break;
    selected.set(block.index, block.text);
    used += block.text.length + 2;
  }
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (selected.has(block.index)) continue;
    if (used + block.text.length + 80 > maxChars) continue;
    selected.set(block.index, block.text);
    used += block.text.length + 2;
  }
  const ordered = [...selected.entries()].sort((a, b) => a[0] - b[0]);
  const out: string[] = [];
  let previousIndex = -1;
  for (const [index, text] of ordered) {
    if (previousIndex >= 0 && index > previousIndex + 1) {
      out.push(`[...${index - previousIndex - 1} middle transcript block(s) omitted by compaction input cap...]`);
    }
    out.push(text);
    previousIndex = index;
  }
  return out.join('\n\n').slice(0, maxChars);
}

/** Apply a CompactResult to a session in-place: replace the summarised prefix with
 *  the summary message, keep the tail. Records a CompactSnapshot in compactHistory
 *  (capped to the most-recent 3) so the user can undo. */
export function applyCompact(session: ChatSession, result: CompactResult, keepRecent: number) {
  const cutoff = Math.max(0, session.messages.length - keepRecent);
  const replaced = session.messages.slice(0, cutoff);
  // Snapshot for undo
  const snap = {
    summaryId: result.summaryMsg.id,
    takenAt: Date.now(),
    messages: replaced,
  };
  const history = (session.compactHistory ?? []).slice(-2);   // keep at most 2 + new = 3 total
  history.push(snap);
  session.compactHistory = history;
  session.messages = [result.summaryMsg, ...session.messages.slice(cutoff)];
  session.updatedAt = Date.now();
}

/** Reverse an applyCompact: replace the summary message with its saved snapshot. */
export function undoCompact(session: ChatSession, summaryId: string): boolean {
  const snap = (session.compactHistory ?? []).find(s => s.summaryId === summaryId);
  if (!snap) return false;
  const idx = session.messages.findIndex(m => m.id === summaryId);
  if (idx < 0) return false;
  session.messages = [...snap.messages, ...session.messages.slice(idx + 1)];
  session.compactHistory = (session.compactHistory ?? []).filter(s => s.summaryId !== summaryId);
  session.updatedAt = Date.now();
  return true;
}
