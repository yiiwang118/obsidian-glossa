/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- Dynamic plugin and host-app boundaries validate these values at runtime. */
/**
 * Minimal sub-agent harness for forked skill execution.
 *
 * A forked skill (frontmatter `context: fork`) runs in an isolated agent
 * loop: its own message buffer, its own token budget tracking, its own
 * tool-result store. The parent loop awaits the fork's final assistant
 * text and surfaces it as the tool result.
 *
 * This is a deliberately small implementation:
 *   - No coordinator / queue: forks run sequentially in the same JS turn as
 *     the parent's tool call.
 *   - No nested fork limit beyond a depth counter (5) to prevent infinite
 *     recursion if a forked skill body re-invokes itself.
 *   - Tool registry is INHERITED from the parent (same `provider`, `app`,
 *     `mcp`, `checkpoint`). Permission rules carry over too.
 *   - UI callbacks are stubbed so the fork doesn't pollute the parent's
 *     tool stream — the user sees only one "Skill: <name> (forked)" card.
 *
 * Mirrors upstream Claude Code's `executeForkedSkill` shape, scaled down.
 */
import type { App } from 'obsidian';
import type { LLMProvider, ToolSpec } from '../providers/types';
import type { PermissionLevel, PermissionRule, TokenUsage } from '../types';
import type { CheckpointManager } from './checkpoint';
import type { Skill } from './skills';
import { renderSkillBody } from './skill_render';

const MAX_FORK_DEPTH = 5;
let activeForkDepth = 0;

interface McpHubLike {
  asToolSpecs(): ToolSpec[];
  findClient(name: string): { client: { callTool(name: string, args: AnyValue): Promise<AnyValue> }; originalName: string } | null;
}

export interface ForkOptions {
  app: App;
  provider: LLMProvider;
  /** Parent's system prompt (forked agent inherits it; skill body is the
   *  user message). */
  systemPrompt: string;
  skill: Skill;
  args: string;
  /** Parent permission settings — fork uses the same rules. */
  permissionLevel: PermissionLevel;
  autoApproveTools: string[];
  neverApproveTools: string[];
  permissionRules?: PermissionRule[];
  /** Optional context bag passed through. */
  endpointKind?: 'custom-api' | 'codex-cli' | 'claude-code-cli';
  endpointFullAgent?: boolean;
  checkpoint?: CheckpointManager;
  mcp?: McpHubLike;
  /** Skill-specific token budget (default: 4096). */
  maxSteps?: number;
  signal?: AbortSignal;
}

export interface ForkResult {
  ok: boolean;
  /** Final assistant text from the forked agent. */
  result: string;
  usage?: TokenUsage;
  error?: string;
}

/** Run a skill as a sub-agent and return its final text. The implementation
 *  re-enters `runAgentLoop` with an isolated message buffer.
 *
 *  Re-entry uses a dynamic import to break the circular dependency between
 *  this module and loop.ts (loop.ts imports `forkSkill` from here). */
export async function forkSkill(opts: ForkOptions): Promise<ForkResult> {
  if (activeForkDepth >= MAX_FORK_DEPTH) {
    return { ok: false, result: '', error: `Fork depth limit (${MAX_FORK_DEPTH}) reached. Refusing to fork further.` };
  }
  activeForkDepth += 1;

  // Render the skill body with substitutions. The body becomes the fork's
  // INITIAL USER MESSAGE — same as if the user had typed the body verbatim.
  // The fork's job is to execute the body's instructions and produce a final
  // text answer.
  const body = await renderSkillBody(opts.app, opts.skill, opts.args);
  const userContent = body;

  // Collect output from the fork — we want the FINAL assistant text, which
  // is whatever the fork emits before completing (with or without
  // attempt_completion).
  let collectedText = '';
  let collectedUsage: TokenUsage | undefined;
  let collectedError: string | undefined;

  // Use dynamic import to break circular dep with loop.ts.
  const { runAgentLoop } = await import('./loop');
  // Snapshot the parent's skill-scoped allow stack BEFORE the fork's loop
  // runs; the fork's clearSkillScopedAllowedTools() at top-of-turn would
  // otherwise wipe the parent's protection. Restored in finally.
  const { snapshotFrames, restoreFrames } = await import('./skill_scoped_allow');
  const savedFrames = snapshotFrames();

  try {
    await runAgentLoop({
      app: opts.app,
      provider: opts.provider,
      systemPrompt: opts.systemPrompt,
      userContent,
      history: [],                       // fresh context — that's the point
      enableTools: true,
      permissionLevel: opts.permissionLevel,
      runMode: 'act',                    // forks act; planning would defeat the purpose
      endpointKind: opts.endpointKind,
      endpointFullAgent: opts.endpointFullAgent,
      maxSteps: opts.maxSteps ?? 12,     // forks should resolve quickly
      autoApproveTools: opts.autoApproveTools,
      neverApproveTools: opts.neverApproveTools,
      permissionRules: opts.permissionRules,
      checkpoint: opts.checkpoint,
      mcp: opts.mcp,
      signal: opts.signal,
      // UI callbacks — stub them so the fork doesn't render its own bubbles.
      // The parent's loop will render ONE tool card for the entire fork.
      onText: (delta) => { collectedText += delta; },
      onToolStart: () => {},
      onToolEnd: () => {},
      onStepBoundary: () => {},
      onFinal: (usage) => { collectedUsage = usage; },
      onError: (err) => { collectedError = err; },
    });
  } catch (e) {
    collectedError = e?.message ?? String(e);
  } finally {
    activeForkDepth -= 1;
    restoreFrames(savedFrames);
  }

  if (collectedError) {
    return { ok: false, result: collectedText, error: collectedError, usage: collectedUsage };
  }
  return { ok: true, result: collectedText, usage: collectedUsage };
}
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- Re-enable review lint rules after dynamic boundary module. */
