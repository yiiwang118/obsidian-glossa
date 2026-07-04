/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- Dynamic plugin, model, and vault payloads are validated at runtime boundaries. */
import { App } from 'obsidian';
import { TOOLS, getTool, listToolSpecs, isConcurrencySafeTool, isReadOnlyTool, normalizeToolResult, type ToolImpl, type ToolRunResult } from './tools';
import { askApproval, type ApprovalResult } from './approval';
import { CheckpointManager, pathsTouchedByTool } from './checkpoint';
import { McpHub } from './mcp';
import type { LLMProvider, MessageInput, ToolSpec } from '../providers/types';
import type { TokenUsage, ToolEvent, PermissionLevel, PermissionRule } from '../types';
import { matchPermissionRule, modelContextWindow } from '../types';
import { uid } from '../utils/dom';
import { buildSkillSystemBlock } from './skill_listing';
import { activateForPath } from './skill_activation';
import { getSkill } from './skills';
import { clearSkillScopedAllowedTools, isAllowedForSkill, pushSkillFrame } from './skill_scoped_allow';
import { persistLargeResult } from './tool_result_store';

/** Pick tools allowed under a given permission level. listToolSpecs() already
 *  excludes deferred tools (those reachable only via tool_search) and bridge
 *  tools whose upstream plugin isn't loaded. We only need the read-only
 *  refinement here. */
function toolsForPermission(level: PermissionLevel): ToolSpec[] {
  const visible = listToolSpecs();
  if (level === 'read-only') return visible.filter(spec => {
    const tool = TOOLS[spec.name];
    return tool ? isReadOnlyTool(tool, {}) : false;
  });
  return visible;
}

/** Stable JSON stringify — recursively sorts object keys so two argument
 *  objects with the same content but different key order produce the same
 *  string. Used for repetition-detection signatures so the model can't bypass
 *  the 3-strike refusal by shuffling keys. */
function stableStringify(v: any): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

export interface AgentLoopOptions {
  app: App;
  provider: LLMProvider;
  systemPrompt: string;
  /** Initial user content (with attached context inlined). */
  userContent: string;
  /** Prior conversation history (excluding the just-submitted user message). */
  /** Full conversation history reconstructed as model-facing messages. Includes
   *  prior tool calls + tool results so the model can reference past tool output. */
  history: MessageInput[];
  enableTools: boolean;
  permissionLevel: PermissionLevel;
  runMode: 'plan' | 'act';
  /** Active endpoint's kind ('custom-api' / 'codex-cli' / 'claude-code-cli').
   *  When codex-cli + fullAgent, we route edits exclusively through codex's
   *  `apply_patch` envelope (the model is trained on it). */
  endpointKind?: 'custom-api' | 'codex-cli' | 'claude-code-cli';
  endpointFullAgent?: boolean;
  maxSteps: number;
  autoApproveTools: string[];
  neverApproveTools: string[];
  /** Persisted "always allow / always deny" rules consulted before prompting the user. */
  permissionRules?: PermissionRule[];
  /** Called whenever a NEW rule should be persisted (from an "Always allow…" choice). */
  onPermissionRulePersist?: (rule: PermissionRule) => void | Promise<void>;
  /** Called for every approval decision (allow / deny / auto-*) so the caller can
   *  append to the audit log. */
  onPermissionDecision?: (entry: import('../types').PermissionLogEntry) => void;
  model?: string;
  signal?: AbortSignal;
  attachedImages?: { dataUri: string; name?: string }[];

  /** Optional injections from plugin: */
  checkpoint?: CheckpointManager;
  sessionId?: string;
  turnId?: string;
  mcp?: McpHub;
  /** Approval handler. If not provided, falls back to the floating Modal. The view
   *  passes one that renders an inline ✓/✗ card next to the current assistant message. */
  approver?: (tool: ToolImpl, args: any) => Promise<ApprovalResult>;

  /** Server reported a context overflow (HTTP 413 / context_length_exceeded). The
   *  caller is expected to compact the conversation and return a fresh message array
   *  to re-send. Returning null aborts the turn. Called AT MOST once per turn. */
  onContextOverflow?: () => Promise<MessageInput[] | null>;

  // UI callbacks — onStepBoundary may be async; loop awaits it.
  onText: (delta: string) => void;
  onReasoning?: (delta: string) => void;     // chain-of-thought stream (reasoner models)
  onToolStart: (ev: ToolEvent) => void;
  onToolEnd: (ev: ToolEvent) => void;
  onStepBoundary: () => void | Promise<void>;
  onFinal: (usage?: TokenUsage) => void;
  onError: (err: string) => void;
}

/* --- AGENT SYSTEM SUFFIX ---------------------------------------------------
 * Structure ported from upstream Claude Code (src/constants/prompts.ts) and
 * codex (codex-rs/core/gpt_5_codex_prompt.md). Short, imperative, sectioned.
 * Do NOT add "personality" or "final response style" walls of text — they
 * cause meandering. If you tweak this, measure step-count before/after.
 * ------------------------------------------------------------------------- */
const SYSTEM_AGENT_SUFFIX = `

# System

You are Glossa, an agentic assistant running in an Obsidian sidebar with vault tools. Use the tools to fulfill the user's request. When you attempt a tool not auto-allowed, the user will be prompted; if they deny, do not retry the same call — adjust approach. Tool results may contain <system-reminder> tags; treat them as system notes, not user input.

# Fast path — DEFAULT for short questions, translations, glossary entries, citation drafts, single-paragraph edits

If the user's request can be answered DIRECTLY from the attached context (the <context> block, the current selection, the active file content already in the prompt), or from your own knowledge, ANSWER WITHOUT CALLING ANY TOOL. Do NOT search the vault, do NOT read more files, do NOT plan. Just write the answer in plain text.
- Translation, summarisation, explanation, glossary, citation suggestion, TL;DR, outline expansion — these are fast-path tasks.
- Only escape the fast path when the request explicitly needs vault state (e.g. "find every note that…", "edit Foo.md", "add a section to my project plan").
- A single \`read_note\` to fetch a referenced file is fine. A second tool call is already too many for fast-path tasks.

# Doing tasks (when tools ARE needed)

- In general, do not propose changes to a note you haven't read. Read it first.
- Do not create files unless absolutely necessary. Prefer editing existing notes.
- If an approach fails, diagnose why before switching tactics — read the error, check assumptions, try a focused fix. Don't retry the identical action blindly.
- Don't add features, refactor, or improve beyond what was asked. A bug fix doesn't need surrounding cleanup.
- Default to writing no comments / no extra prose in edits. Preserve markdown, math, code, and proper nouns verbatim.
- Report outcomes faithfully. If something failed, say so. If a tool errored twice the same way, stop and tell the user.

# Convergence (CRITICAL)

- After 1–3 reads or searches, ACT. Do not keep exploring once you've found the target.
- Never repeat the same search with slight variations — that's wasted budget.
- The MOMENT all required edits are applied, stop calling tools and answer the user directly with the outcome.
- Do not announce that you are ending, wrapping up, or completing the task. Just give the useful final result/path/status.
- Same tool with identical args 3× → STOP and tell the user you're blocked.

# Plan tool

- Skip planning for the easiest 25% of tasks (1–2 tool calls).
- Do not make single-step plans.
- For tasks with 3+ distinct sub-tasks, call \`todo_write\` ONCE up front with all items {content, activeForm, status: 'pending'}. Then keep exactly ONE in_progress at a time and update statuses as you finish each.

# Tools (priority order for edits)

1. \`file_edit({file_path, old_string, new_string, replace_all?})\` — preferred for single-spot edits. Empty old_string + new_string = create new file. old_string must be unique unless \`replace_all:true\`.
2. \`apply_patch({patch})\` — codex envelope, for multi-file or multi-hunk. Supports Add / Delete / Update / Move.
3. \`write_note\` only when rewriting >50% of the file.

**Batching rule (CRITICAL — saves dozens of round-trips)**: When the same kind of change
appears 3+ times in one file (e.g. removing every \`[N]\` citation marker, renaming a symbol
in many places), do NOT call \`file_edit\` once per occurrence. Choose ONE of:
- \`file_edit\` with \`replace_all: true\` if the same old_string repeats verbatim
- \`apply_patch\` envelope with multiple hunks in a single call

**Hard refusal**: After 3 consecutive \`file_edit\` calls on the SAME file in one turn, the
agent runtime will REFUSE further \`file_edit\` on that file and force you to switch to
\`apply_patch\` (multi-hunk envelope) or \`file_edit\` with \`replace_all:true\`. Don't trigger
this — plan the edit as a single envelope from the start.

Reads (auto-approved): \`read_note\`, \`grep_vault\`, \`search_vault\`, \`list_files\`, \`semantic_search\`, \`get_active_file\`, \`query_metadata\`.

# Web workflow

- If the user gives a concrete URL and asks what it says, use \`web_fetch({url, prompt, mode})\`.
- If the URL is unknown or the user asks to find current/public information, prefer \`web_research\` so search, source fetching, and extraction happen in one bounded pipeline.
- Use \`web_search\` directly only when you need a raw list of candidate sources.
- If the user asks to save, download, inspect, or archive a web asset, use \`download_file\` after finding the direct asset URL. Then inspect the saved vault file with \`read_pdf\`, \`view_image\`, or \`read_note\` as appropriate.
- For papers, GitHub repositories/releases, and official documentation, use \`web_research\` first; its auto provider can query specialized sources before generic web search.
- Do not invent download links. Preserve source URLs and mention saved vault paths.
- Avoid broad repeated searches. One good query, optional domain filter, then act.

# Image workflow

- For image questions, call \`view_image\` when the image is a vault file and you need visual evidence.
- Choose \`mode\` by task: \`describe\` for ordinary understanding, \`ocr\` for reading text, \`ui\` for screenshots/layout issues, \`chart\` for plots and paper figures, \`detail\` for small regions, \`color\` for pixel/color checks.
- If precision matters, do not rely on whole-image impression alone. Use \`region:{x,y,width,height}\` to crop small text/UI defects/chart details, or \`sample_points\` for exact colors.
- Keep claims grounded in the image/crop you actually saw. If a crop excludes context, say so or inspect the full image first.
- For generated/edited images, use the image generation/editing surface when available; do not pretend \`view_image\` can modify pixels.

Skills: \`discover_skills()\` + \`run_skill(name)\` for vault-authored playbooks at \`.glossa/skills/<name>/SKILL.md\`.

# Tone and style

- Default: very concise; friendly coding teammate. Mirror the user's language.
- Before a tool batch, ONE short sentence (8–14 words) saying what you're about to do. Skip preamble for a single trivial read.
- After tool results: 0–1 sentence ack, then next action. Don't restate args (tool card already shows them).
- Final answer: plain text. Lead with what changed or the answer. Reference paths inline as \`Path/To/Note.md\`. Skip headers/bullets unless they aid scanning.
- Never dump rewritten file content as chat text — that's what write tools are for.
`;

export async function runAgentLoop(opts: AgentLoopOptions) {
  // Plan mode: keep only read-side tools regardless of permission level
  let tools: ToolSpec[] | undefined = undefined;
  if (opts.enableTools) {
    const base = toolsForPermission(opts.permissionLevel);
    let filtered = opts.runMode === 'plan'
      ? base.filter(s => {
        const tool = TOOLS[s.name];
        return tool ? isReadOnlyTool(tool, {}) : false;
      })
      : base;
    // Codex envelope-only edit mode: when the active endpoint is codex-cli in
    // fullAgent mode, codex itself trains better on `apply_patch` envelopes
    // than on our piecewise `file_edit` / `write_note` tools. Drop the
    // single-spot writers; force codex to emit one envelope per edit batch.
    if (opts.endpointKind === 'codex-cli' && opts.endpointFullAgent) {
      const codexEnvelopeExclude = new Set(['file_edit', 'write_note', 'append_to_note', 'edit_section', 'create_note']);
      filtered = filtered.filter(s => !codexEnvelopeExclude.has(s.name));
    }
    // Append MCP tools (if any) — namespaced by `<server>__<tool>`
    const mcpSpecs = (opts.permissionLevel === 'read-only' || opts.runMode === 'plan')
      ? []
      : (opts.mcp?.asToolSpecs() ?? []);
    tools = [...filtered, ...mcpSpecs];
  }
  // Compose system prompt: base + agent suffix + budget-aware skill listing.
  // Skill block is only included when tools are active and there ARE skills.
  let sysPrompt = opts.systemPrompt;
  if (opts.enableTools && tools && tools.length > 0) {
    sysPrompt = sysPrompt + SYSTEM_AGENT_SUFFIX;
    try {
      const cw = modelContextWindow(opts.model) ?? undefined;
      const skillBlock = await buildSkillSystemBlock(opts.app, cw);
      if (skillBlock) sysPrompt += skillBlock;
    } catch (e) {
      console.warn('[agent-loop] failed to build skill listing', e);
    }
  }

  const messages: MessageInput[] = [
    ...opts.history,
    { role: 'user', content: opts.userContent },
  ];

  // Reset skill-scoped allow frames at turn boundary. Skills invoked in
  // PRIOR turns of the same session don't propagate to fresh user requests —
  // each turn is treated as a clean slate. If the user wants persistent
  // skill-scoped allow, they configure it as a regular PermissionRule.
  clearSkillScopedAllowedTools();

  let totalUsage: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUSD: 0 };
  let compactRetriedThisTurn = false;

  /** Per-turn tool-call signature counts. Used by the repetition guard to
   *  refuse calls that have been issued 3+ times this turn.
   *
   *  Changed from an 8-slot sliding window: the model could bypass the
   *  guard by interleaving N dummy tool calls between repeats, pushing the
   *  duplicate out of the window. A turn-scoped Map can't be tricked that
   *  way, and the memory cost is trivial (one entry per distinct signature). */
  const sigCount = new Map<string, number>();
  /** Whether we've already injected the "you're meandering" nudge this turn. */
  let nudgeInjected = false;
  /** When reactive compaction retries the step, we don't want onStepBoundary to
   *  fire (it'd create a fresh empty assistant bubble). This flag tells the next
   *  loop iteration to skip the boundary and reuse the current bubble. */
  let skipNextBoundary = false;

  // NOTE on `maxSteps`: this is the number of MODEL TURNS (assistant
  // messages), not the number of tool calls. One turn can issue many tools
  // in parallel (a single batch). So a `maxSteps: 20` budget can fan out to
  // 50+ tool calls if the model batches aggressively. We keep the name
  // `maxSteps` for back-compat with settings/persisted sessions, but the
  // setting label in the UI reads "max assistant turns" — see settings.ts.
  let totalToolCalls = 0;
  for (let step = 0; step < opts.maxSteps; step++) {
    if (step > 0 && !skipNextBoundary) await opts.onStepBoundary();
    skipNextBoundary = false;

    // Convergence nudge — inject once when the model is meandering. We do not
    // expose a completion tool; the natural stop condition is a final answer
    // with no further tool calls.
    if (step === 8 && !nudgeInjected) {
      nudgeInjected = true;
      messages.push({
        role: 'user',
        content: '<system-reminder>You have spent 8 assistant turns on this request. STOP exploring. If the task is complete or sufficient, provide the final answer now. Otherwise commit to one concrete next action. No more broad searches.</system-reminder>',
      });
    }

    let assistantText = '';
    let assistantReasoning = '';
    let contextOverflowSeen = false;
    const toolCalls: { id: string; name: string; args: any }[] = [];
    const passthroughCardsById = new Map<string, ToolEvent>();

    let aborted = false;
    try {
      for await (const ch of opts.provider.stream({
        systemPrompt: sysPrompt,
        messages,
        tools,
        model: opts.model,
        signal: opts.signal,
        // attach images only on the FIRST step's user message
        attachedImages: step === 0 ? opts.attachedImages : undefined,
      })) {
        if (ch.type === 'text') {
          assistantText += ch.text;
          opts.onText(ch.text);
        } else if (ch.type === 'reasoning') {
          assistantReasoning += ch.text;
          opts.onReasoning?.(ch.text);
        } else if (ch.type === 'tool_call') {
          toolCalls.push({ id: ch.id, name: ch.name, args: ch.args });
        } else if (ch.type === 'context_overflow') {
          contextOverflowSeen = true;
          break;     // exit the stream; recovery handled after the for-await
        } else if (ch.type === 'tool_event') {
          // Provider (CLI) already ran the tool — just render the card.
          let card = passthroughCardsById.get(ch.id);
          if (!card) {
            card = {
              id: ch.id, name: ch.name || 'tool', args: ch.args,
              status: ch.status, startedAt: Date.now(),
            };
            passthroughCardsById.set(ch.id, card);
            opts.onToolStart(card);
          } else {
            if (ch.name) card.name = ch.name;
            if (ch.args && Object.keys(ch.args).length) card.args = ch.args;
            if (ch.result != null) card.result = ch.result;
            card.status = ch.status;
            if (ch.status === 'success' || ch.status === 'error') card.endedAt = Date.now();
            opts.onToolEnd(card);
          }
        } else if (ch.type === 'final') {
          if (ch.reasoningContent && !assistantReasoning) assistantReasoning = ch.reasoningContent;
          if (ch.usage) {
            totalUsage.input = (totalUsage.input ?? 0) + (ch.usage.input ?? 0);
            totalUsage.output = (totalUsage.output ?? 0) + (ch.usage.output ?? 0);
            totalUsage.cacheRead = (totalUsage.cacheRead ?? 0) + (ch.usage.cacheRead ?? 0);
            totalUsage.cacheWrite = (totalUsage.cacheWrite ?? 0) + (ch.usage.cacheWrite ?? 0);
            totalUsage.costUSD = (totalUsage.costUSD ?? 0) + (ch.usage.costUSD ?? 0);
          }
        } else if (ch.type === 'error') {
          opts.onError(ch.error);
          opts.onFinal(totalUsage);
          return;
        }
      }
    } catch (e: any) {
      if (e.name === 'AbortError') { aborted = true; }
      else { opts.onError(e.message ?? String(e)); opts.onFinal(totalUsage); return; }
    }
    if (aborted) { opts.onFinal(totalUsage); return; }

    // Reactive compaction: the server said the prompt is too long → ask the caller to
    // shrink the conversation, then retry the SAME step with the new message array.
    if (contextOverflowSeen) {
      if (compactRetriedThisTurn || !opts.onContextOverflow) {
        opts.onError('Context window exceeded and reactive compaction is unavailable or already retried this turn.');
        opts.onFinal(totalUsage); return;
      }
      const fresh = await opts.onContextOverflow();
      if (!fresh) {
        opts.onError('Context window exceeded — compaction returned no fresh messages.');
        opts.onFinal(totalUsage); return;
      }
      compactRetriedThisTurn = true;
      messages.length = 0;
      for (const m of fresh) messages.push(m);
      step--;     // redo this step with the new (shorter) message array
      skipNextBoundary = true;     // don't create a new empty bubble on retry
      continue;
    }

    // record assistant reply (with tool_calls flag)
    if (toolCalls.length === 0) {
      // no tools used → done
      opts.onFinal(totalUsage);
      return;
    }
    // Tool-call hard cap: independent safety net so an aggressively-batching
    // model can't burn through hundreds of tool calls under a small maxSteps.
    // Defaults to 10× maxSteps; the model can still get a lot done before
    // tripping this, but a runaway loop terminates cleanly.
    totalToolCalls += toolCalls.length;
    const toolCallHardCap = opts.maxSteps * 10;
    if (totalToolCalls > toolCallHardCap) {
      opts.onError(`Tool-call hard cap (${toolCallHardCap}) exceeded; aborting. ` +
        `The model issued ${totalToolCalls} tool calls across ${step + 1} batches — consider raising maxSteps or check for a loop.`);
      opts.onFinal(totalUsage);
      return;
    }

    // Push assistant text + structured tool_calls (and reasoning_content for reasoner models)
    // so the next API turn can rebuild the canonical assistant message.
    messages.push({
      role: 'assistant',
      content: assistantText,
      toolCalls: toolCalls.map(t => ({ id: t.id, name: t.name, args: t.args })),
      reasoningContent: assistantReasoning || undefined,
    });

    // Detect attempt_completion → stop after running it.
    // Safety: if the model also asked for write/edit tools in the SAME batch, we refuse
    // the whole batch and tell it to retry — declaring completion AND continuing to mutate
    // files in one breath is unsafe.
    const completionCall = toolCalls.find(c => c.name === 'attempt_completion');
    if (completionCall && toolCalls.length > 1) {
      const hasDangerous = toolCalls.some(c => {
        if (c.name === 'attempt_completion') return false;
        const t = getTool(c.name);
        return t ? !isReadOnlyTool(t, c.args) : true;
      });
      if (hasDangerous) {
        for (const c of toolCalls) {
          messages.push({ role: 'tool', toolCallId: c.id,
            content: 'Refused: attempt_completion cannot be batched with write/edit tools. Call writes first, then in a separate turn call attempt_completion alone.' });
        }
        continue;       // skip this batch entirely, model will see the refusal and retry
      }
    }

    /* --- Phase 1: sequential approval + preparation for every tool call.
           Approvals can't run in parallel (they're modal). Approval order matches
           the order the model issued the calls so the user sees a predictable flow. */
    interface Prepared {
      call: { id: string; name: string; args: any };
      ev: ToolEvent;
      tool?: ToolImpl;
      mcpEntry?: { client: any; originalName: string } | null;
      effectiveArgs: any;
      rewriteToWriteNote: boolean;
      /** If set, the call is already resolved (denied, unknown tool, etc.) — skip execution. */
      resolved?: { status: 'error' | 'denied'; result: string };
    }
    const prepared: Prepared[] = [];
    for (const call of toolCalls) {
      const tool = getTool(call.name);
      const mcpEntry = !tool ? opts.mcp?.findClient(call.name) : null;

      // ── backfillObservableInput ────────────────────────────────────────
      // For observers (permission rules, audit log, approval modal, UI card)
      // we work on a COPY of the args with derived/normalized fields filled
      // in. The original `call.args` we hand to `tool.run()` is left intact
      // so the prompt cache stays warm. Mirrors upstream Claude Code's
      // `backfillObservableInput` pattern: e.g. `expandPath()` on file_path
      // so a deny-rule of `path:Notes/foo.md` can't be bypassed by passing
      // `~/Notes/foo.md` or `./Notes/foo.md`.
      let observableArgs: any = call.args;
      if (tool?.backfillObservableInput && call.args && typeof call.args === 'object') {
        try {
          observableArgs = { ...call.args };
          tool.backfillObservableInput(observableArgs);
        } catch (e) {
          console.warn(`[tool] backfillObservableInput threw for ${call.name}`, e);
          observableArgs = call.args;
        }
      }

      const ev: ToolEvent = {
        id: call.id || uid(),
        name: call.name,
        args: observableArgs,
        status: 'pending',
        startedAt: Date.now(),
      };
      opts.onToolStart(ev);

      if (!tool && !mcpEntry) {
        prepared.push({ call, ev, tool, mcpEntry, effectiveArgs: call.args, rewriteToWriteNote: false,
          resolved: { status: 'error', result: `Unknown tool: ${call.name}` } });
        continue;
      }
      // Repetition guard — same tool with the same args 3 times in the
      // turn means the model is spinning. We track per-turn counts in a Map
      // so interleaving dummy calls can't push the duplicate out of view.
      const signature = `${call.name}:${stableStringify(observableArgs ?? {})}`;
      const prevCount = sigCount.get(signature) ?? 0;
      sigCount.set(signature, prevCount + 1);
      if (prevCount >= 2) {
        // 2 prior + this = 3rd attempt at exact same call
        prepared.push({ call, ev, tool, mcpEntry, effectiveArgs: call.args, rewriteToWriteNote: false,
          resolved: { status: 'error', result:
            `Refused: this exact ${call.name} call has been issued ${prevCount + 1} times already in this turn. ` +
            `You are looping. Either call a DIFFERENT tool or provide the final answer with what you have so far.` } });
        continue;
      }
      // Batching guard — 3+ file_edit calls to the SAME file in one turn
      // means the model is doing single-spot edits one at a time. We count
      // distinct file_edit signatures that target this file by scanning the
      // Map (cheap since it's keyed by tool name + args).
      if (call.name === 'file_edit' && typeof call.args?.file_path === 'string') {
        const fpFragment = `"file_path":${JSON.stringify(call.args.file_path)}`;
        let sameFileEdits = 0;
        for (const [sig, c] of sigCount) {
          if (sig.startsWith('file_edit:') && sig.includes(fpFragment)) sameFileEdits += c;
        }
        if (sameFileEdits >= 3) {
          prepared.push({ call, ev, tool, mcpEntry, effectiveArgs: call.args, rewriteToWriteNote: false,
            resolved: { status: 'error', result:
              `Refused: you've already issued ${sameFileEdits} file_edit calls on "${call.args.file_path}" in this turn. ` +
              `Batch the remaining changes: use file_edit with replace_all:true if the same old_string repeats, ` +
              `or one apply_patch envelope with multiple hunks. Do not call file_edit on this file again until you've batched.` } });
          continue;
        }
      }
      let effectiveArgs = call.args;
      let forceApproval = false;
      let toolPermissionAllows = false;
      if (tool?.checkPermissions) {
        try {
          const perm = await tool.checkPermissions(opts.app, effectiveArgs);
          if ('updatedInput' in perm && perm.updatedInput !== undefined) {
            effectiveArgs = perm.updatedInput;
            if (tool.backfillObservableInput && effectiveArgs && typeof effectiveArgs === 'object') {
              try {
                observableArgs = { ...effectiveArgs };
                tool.backfillObservableInput(observableArgs);
              } catch (e) {
                console.warn(`[tool] backfillObservableInput threw for ${call.name}`, e);
                observableArgs = effectiveArgs;
              }
            } else {
              observableArgs = effectiveArgs;
            }
            ev.args = observableArgs;
          }
          if (perm.behavior === 'deny') {
            opts.onPermissionDecision?.({
              at: Date.now(), tool: call.name, args: JSON.stringify(observableArgs ?? {}).slice(0, 200),
              decision: 'denied-by-rule',
              scope: perm.decisionReason ?? 'tool-check',
            });
            prepared.push({ call, ev, tool, mcpEntry, effectiveArgs, rewriteToWriteNote: false,
              resolved: { status: 'denied', result: perm.message } });
            continue;
          }
          forceApproval = perm.behavior === 'ask';
          toolPermissionAllows = perm.behavior === 'allow';
        } catch (e: any) {
          prepared.push({ call, ev, tool, mcpEntry, effectiveArgs, rewriteToWriteNote: false,
            resolved: { status: 'error', result: `Permission check failed for ${call.name}: ${e?.message ?? e}` } });
          continue;
        }
      }

      const readOnly = tool ? isReadOnlyTool(tool, effectiveArgs) : false;
      const dangerous = !readOnly;
      if ((opts.permissionLevel === 'read-only' || opts.runMode === 'plan') && dangerous) {
        prepared.push({ call, ev, tool, mcpEntry, effectiveArgs, rewriteToWriteNote: false,
          resolved: { status: 'denied', result: `Tool "${call.name}" is not allowed in ${opts.runMode === 'plan' ? 'plan' : 'read-only'} mode.` } });
        continue;
      }

      if (opts.neverApproveTools.includes(call.name)) {
        prepared.push({ call, ev, tool, mcpEntry, effectiveArgs, rewriteToWriteNote: false,
          resolved: { status: 'denied', result: `Tool "${call.name}" is in never-approve list.` } });
        continue;
      }
      // Persisted rules: deny short-circuits; allow skips approval; ask still prompts.
      // Matching uses observableArgs so normalized path forms are checked.
      const rules = opts.permissionRules ?? [];
      const matchingRule = rules.find(r => matchPermissionRule(r, call.name, observableArgs, opts.sessionId));
      if (matchingRule?.behavior === 'deny') {
        opts.onPermissionDecision?.({
          at: Date.now(), tool: call.name, args: JSON.stringify(call.args ?? {}).slice(0, 200),
          decision: 'denied-by-rule',
          scope: matchingRule.scope + (matchingRule.value ? ':' + matchingRule.value : ''),
        });
        prepared.push({ call, ev, tool, mcpEntry, effectiveArgs: call.args, rewriteToWriteNote: false,
          resolved: { status: 'denied', result: `Denied by persisted rule (${matchingRule.scope}${matchingRule.value ? ': ' + matchingRule.value : ''}).` } });
        continue;
      }
      const ruleForcesAsk = matchingRule?.behavior === 'ask';
      const ruleAllows = !forceApproval && !ruleForcesAsk && matchingRule?.behavior === 'allow';
      if (ruleAllows) {
        opts.onPermissionDecision?.({
          at: Date.now(), tool: call.name, args: JSON.stringify(call.args ?? {}).slice(0, 200),
          decision: 'allowed-by-rule',
          scope: matchingRule.scope + (matchingRule.value ? ':' + matchingRule.value : ''),
        });
      }

      // Skill-scoped allow: if any active skill frame allowlists this tool,
      // skip approval. Audit it as auto-allow so the user can still see it
      // happened.
      const allowedBySkill = !ruleAllows && isAllowedForSkill(call.name);
      if (allowedBySkill) {
        opts.onPermissionDecision?.({
          at: Date.now(), tool: call.name, args: JSON.stringify(call.args ?? {}).slice(0, 200),
          decision: 'allowed-by-rule',
          scope: 'skill-scoped',
        });
      }

      const needsApproval = forceApproval || ruleForcesAsk || (dangerous && !ruleAllows && !toolPermissionAllows && !allowedBySkill && !opts.autoApproveTools.includes(call.name));
      let rewriteToWriteNote = false;
      if (needsApproval) {
        const previewTool: ToolImpl = tool ?? ({
          dangerous: true, describe: () => call.name,
          spec: { name: call.name, description: 'MCP tool', parameters: {} },
          run: async () => '',
        } as ToolImpl);
        const askFn = opts.approver ?? ((t: ToolImpl, a: any) => askApproval(opts.app, t, a));
        const res = await askFn(previewTool, call.args);
        if (!res.ok) {
          opts.onPermissionDecision?.({
            at: Date.now(), tool: call.name, args: JSON.stringify(call.args ?? {}).slice(0, 200),
            decision: 'deny',
          });
          prepared.push({ call, ev, tool, mcpEntry, effectiveArgs, rewriteToWriteNote,
            resolved: { status: 'denied', result: 'User denied this action.' } });
          continue;
        }
        opts.onPermissionDecision?.({
          at: Date.now(), tool: call.name, args: JSON.stringify(call.args ?? {}).slice(0, 200),
          decision: 'allow',
          scope: res.persistRule ? res.persistRule.scope + (res.persistRule.value ? ':' + res.persistRule.value : '') : undefined,
        });
        if (res.mutatedArgs) {
          effectiveArgs = res.mutatedArgs;
          if ((effectiveArgs).__rewriteAsWrite) {
            rewriteToWriteNote = true;
            delete (effectiveArgs).__rewriteAsWrite;
          }
        }
        // Persist any "Always allow…" choice the user made on this approval
        if (res.persistRule && opts.onPermissionRulePersist) {
          try { await opts.onPermissionRulePersist(res.persistRule); } catch { /* ignore */ }
        }
      }
      prepared.push({ call, ev, tool, mcpEntry, effectiveArgs, rewriteToWriteNote });
    }

    /* --- Phase 2: partition into consecutive batches by concurrency-safety.
           A run of safe tools is executed in parallel via Promise.all; an unsafe tool
           is its own batch (size 1). Preserves issue order across batches so transcript
           reads naturally. Mirrors upstream Claude Code's partitionToolUseBlocks. */
    const batches: Prepared[][] = [];
    for (const p of prepared) {
      const safe = p.resolved ? true   // pre-resolved entries don't actually run
                : (p.tool ? isConcurrencySafeTool(p.tool, p.effectiveArgs)
                          : false);    // MCP tools assumed unsafe (could mutate)
      const last = batches[batches.length - 1];
      if (last && safe && last.every(x => x.resolved
        ? true
        : (x.tool ? isConcurrencySafeTool(x.tool, x.effectiveArgs) : false))) {
        last.push(p);
      } else {
        batches.push([p]);
      }
    }

    /* --- Phase 3: execute. For each prepared entry, run snapshot → tool → record result. */
    const runOne = async (p: Prepared) => {
      const { call, ev, tool, mcpEntry, effectiveArgs, rewriteToWriteNote, resolved } = p;
      if (resolved) {
        ev.status = resolved.status; ev.result = resolved.result; ev.endedAt = Date.now();
        opts.onToolEnd(ev);
        messages.push({ role: 'tool', toolCallId: call.id, content: resolved.result });
        return;
      }
      // Snapshot files before running + activate any conditional skill whose
      // `paths` patterns match the touched path. Activation is fire-and-forget;
      // it changes the in-memory skill listing for the NEXT turn (not this one).
      if (tool) {
        const paths = pathsTouchedByTool(call.name, effectiveArgs);
        if (paths.length) {
          if (opts.checkpoint && opts.sessionId && opts.turnId) {
            try { await opts.checkpoint.snapshot(opts.sessionId, opts.turnId, paths); } catch { /* ignore */ }
          }
          for (const p of paths) {
            activateForPath(opts.app, p).catch(() => {});
          }
        }
      }

      ev.status = 'running'; opts.onToolEnd({ ...ev });
      // Give the renderer one macrotask to paint the running state before a
      // synchronous-heavy tool (large file edit, markdown diff, etc.) starts.
      // Without this, the sidebar can look frozen until the tool returns.
      await new Promise<void>(resolve => window.setTimeout(resolve, 0));

      try {
        // Stale-write guard: if user toggled per-line in approval, we captured a file
        // snapshot. If the file changed between preview and apply, refuse to overwrite.
        const expectedBefore: string | undefined = (effectiveArgs).__expectedBefore;
        const pathField = (effectiveArgs).path ?? (effectiveArgs).file_path;
        if (expectedBefore != null && pathField) {
          const { TFile } = await import('obsidian');
          const f = opts.app.vault.getAbstractFileByPath(pathField);
          if (f instanceof TFile) {
            const now = await opts.app.vault.read(f);
            if (now !== expectedBefore) throw new Error('File changed between preview and apply — please regenerate.');
          }
          delete (effectiveArgs).__expectedBefore;
        }

        let raw: string | ToolRunResult;
        // Pass the agent loop's signal to every tool invocation so net-bound
        // tools (web_fetch, semantic_search embedding query, plugin bridges
        // hitting big indices) can cooperate with the user's Stop button
        // instead of running to completion in the background. Tools that
        // don't read the signal are unchanged.
        const toolCtx = { signal: opts.signal };
        if (rewriteToWriteNote) {
          const writeTool = getTool('write_note');
          if (!writeTool) throw new Error('write_note tool not found');
          raw = await writeTool.run(opts.app, effectiveArgs, toolCtx);
        } else if (tool) {
          // Fork interception: when the `skill` tool is invoked and the
          // resolved skill has `context: fork`, run it via the sub-agent
          // harness instead of injecting body inline. The sub-agent's final
          // text is the tool result the model sees.
          if (call.name === 'skill') {
            const skillName = String((effectiveArgs)?.skill ?? '');
            const skill = skillName ? await getSkill(opts.app, skillName) : null;
            if (skill?.context === 'fork') {
              const { forkSkill } = await import('./sub_agent');
              const argStr = typeof (effectiveArgs)?.args === 'string' ? (effectiveArgs).args : '';
              const fork = await forkSkill({
                app: opts.app,
                provider: opts.provider,
                systemPrompt: opts.systemPrompt,
                skill,
                args: argStr,
                permissionLevel: opts.permissionLevel,
                autoApproveTools: opts.autoApproveTools,
                neverApproveTools: opts.neverApproveTools,
                permissionRules: opts.permissionRules,
                endpointKind: opts.endpointKind,
                endpointFullAgent: opts.endpointFullAgent,
                checkpoint: opts.checkpoint,
                mcp: opts.mcp,
                signal: opts.signal,
              });
              raw = fork.ok
                ? `[forked skill "${skillName}" completed]\n\n${fork.result || '(no text result)'}`
                : `[forked skill "${skillName}" failed]\n\n${fork.error ?? 'unknown error'}\n\n--- partial ---\n${fork.result}`;
            } else {
              raw = await tool.run(opts.app, effectiveArgs, toolCtx);
            }
          } else {
            raw = await tool.run(opts.app, effectiveArgs, toolCtx);
          }
        } else {
          raw = await mcpEntry.client.callTool(mcpEntry.originalName, effectiveArgs);
        }
        const norm = normalizeToolResult(raw);
        // Skill-scoped allow: when the `skill` tool runs successfully, push a
        // frame so the skill's `allowed-tools` auto-approve in subsequent
        // tool calls this turn. The frame stays on the stack until session
        // reset (cleared between fully-new conversations via
        // clearSkillScopedAllowedTools elsewhere).
        // At this point we're inside the try-block past tool.run(), so the
        // tool succeeded — no need to check ev.status.
        if (call.name === 'skill') {
          try {
            const skillName = String((effectiveArgs)?.skill ?? '');
            if (skillName) {
              const skill = await getSkill(opts.app, skillName);
              if (skill?.allowedTools?.length) {
                pushSkillFrame(skillName, skill.allowedTools);
              }
            }
          } catch (e) { console.warn('[loop] failed to push skill frame', e); }
        }
        // Large-result persistence: when the model-bound text exceeds the
        // tool's declared `maxResultSizeChars`, save the full text to
        // `.glossa/tool_outputs/...` and replace the inline payload with a
        // head+tail preview pointing at that path. The UI card still receives
        // the FULL `ev.result` so the user sees the unredacted output —
        // only the model-facing string gets shortened (set below in the
        // messages.push for role='tool'). We stash the redacted form in
        // `ev._modelBoundResult` for the loop to pick up.
        const cap = tool?.maxResultSizeChars ?? Infinity;
        let modelBoundText = norm.text;
        if (Number.isFinite(cap) && norm.text.length > cap) {
          const persisted = await persistLargeResult(opts.app, call.name, call.id, norm.text);
          if (persisted) {
            modelBoundText = persisted.preview;
          } else {
            // Persistence failed — fall back to head-only truncation.
            modelBoundText = norm.text.slice(0, cap) + `\n\n[truncated at ${cap} chars; persistence failed]`;
          }
        }
        ev.status = 'success';
        ev.result = norm.text;                        // UI gets the full text
        (ev as any)._modelBoundResult = modelBoundText; // model gets preview
        ev.contentBlocks = norm.contentBlocks;
      } catch (e: any) {
        ev.status = 'error'; ev.result = e.message ?? String(e);
      }
      ev.endedAt = Date.now();
      opts.onToolEnd(ev);
      // Prefer the redacted (size-capped) text for the model when present;
      // fall back to the full result otherwise.
      const modelBound = (ev as any)._modelBoundResult ?? String(ev.result ?? '');
      messages.push({
        role: 'tool',
        toolCallId: call.id,
        content: modelBound,
        toolContentBlocks: ev.contentBlocks,
        toolIsError: ev.status === 'error',
      });
    };

    for (const batch of batches) {
      if (batch.length === 1) {
        await runOne(batch[0]);
      } else {
        // Parallel batch of concurrency-safe tools (typically reads / searches).
        // Errors are absorbed per-tool inside runOne, so Promise.all won't reject.
        await Promise.all(batch.map(runOne));
      }
    }

    if (completionCall) { opts.onFinal(totalUsage); return; }
    // loop continues — model sees tool results next iteration
  }

  opts.onError(`Max steps (${opts.maxSteps}) reached without final answer.`);
  opts.onFinal(totalUsage);
}
