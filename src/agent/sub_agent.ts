import type { ToolRunResult } from './tools';
import type { ToolArguments } from './tool_arguments';
import { errorMessage } from '../utils/unknown_data';
/** Isolated skill execution with inherited permissions and per-task controls. */
import type { App } from 'obsidian';
import type { LLMProvider, ToolSpec } from '../providers/types';
import type { PermissionLevel, PermissionRule, TokenUsage } from '../types';
import type { CheckpointManager } from './checkpoint';
import type { Skill } from './skills';
import { renderSkillBody } from './skill_render';
import type { AgentLoopOptions } from './loop';
import { SubtaskRegistry } from './subtasks';

const MAX_FORK_DEPTH = 5;


interface McpHubLike {
  asToolSpecs(): ToolSpec[];
  findClient(name: string): { client: { callTool(name: string, args: ToolArguments): Promise<string | ToolRunResult> }; originalName: string } | null;
}

export interface ForkOptions extends Pick<AgentLoopOptions, 'workspaceFolders' | 'approver' | 'onPermissionRulePersist' | 'onPermissionDecision' | 'sessionId' | 'turnId' | 'model' | 'runMode' | 'runtimeTools' | 'contextBudget'> {
  forkDepth?: number;
  subtasks?: SubtaskRegistry;
  parentSubtaskId?: string;
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
  endpointKind?: 'custom-api' | 'codex-cli' | 'claude-code-cli' | 'grok-cli';
  endpointFullAgent?: boolean;
  checkpoint?: CheckpointManager;
  mcp?: McpHubLike;
  /** Maximum model steps for this child (default: 12). */
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
  if ((opts.forkDepth ?? 0) >= MAX_FORK_DEPTH) {
    return { ok: false, result: '', error: `Fork depth limit (${MAX_FORK_DEPTH}) reached. Refusing to fork further.` };
  }
  const registry = opts.subtasks ?? new SubtaskRegistry([]);
  const task = registry.start(opts.skill.name, opts.signal, opts.parentSubtaskId);
  let collectedText = '';
  let collectedUsage: TokenUsage | undefined;
  let collectedError: string | undefined;

  try {
    if (task.signal.aborted) throw new Error('Subtask cancelled.');
    const userContent = await renderSkillBody(opts.app, opts.skill, opts.args);
    const { runAgentLoop } = await import('./loop');
    await runAgentLoop({
      app: opts.app,
      provider: opts.provider,
      systemPrompt: opts.systemPrompt,
      userContent,
      history: [],                       // fresh context — that's the point
      enableTools: true,
      permissionLevel: opts.permissionLevel,
      runMode: opts.runMode,
      endpointKind: opts.endpointKind,
      endpointFullAgent: opts.endpointFullAgent,
      maxSteps: opts.maxSteps ?? 12,     // forks should resolve quickly
      autoApproveTools: opts.autoApproveTools,
      neverApproveTools: opts.neverApproveTools,
      permissionRules: opts.permissionRules,
      checkpoint: opts.checkpoint,
      mcp: opts.mcp,
      signal: task.signal,
      forkDepth: (opts.forkDepth ?? 0) + 1,
      subtasks: registry,
      parentSubtaskId: task.record.id,
      workspaceFolders: opts.workspaceFolders,
      approver: opts.approver,
      onPermissionRulePersist: opts.onPermissionRulePersist,
      onPermissionDecision: opts.onPermissionDecision,
      sessionId: opts.sessionId,
      turnId: opts.turnId,
      model: opts.model,
      runtimeTools: opts.runtimeTools,
      contextBudget: opts.contextBudget,
      takeSteering: async () => registry.takeSteering(task.record.id),
      // Child progress lives in its own card; the parent receives one result.
      onText: (delta) => { if (!task.signal.aborted) { collectedText += delta; registry.update(task.record, { output: collectedText }, false); } },
      onToolStart: ev => registry.update(task.record, { tool: ev.name }),
      onToolEnd: ev => registry.update(task.record, { tool: ev.status === 'running' || ev.status === 'pending' ? ev.name : undefined }),
      onStepBoundary: () => registry.update(task.record, { steps: task.record.steps + 1 }),
      onFinal: (usage) => { collectedUsage = usage; },
      onError: (err) => { collectedError = err; },
    });
  } catch (e: unknown) {
    collectedError = errorMessage(e);
  } finally {
    if (task.signal.aborted) collectedError = 'Subtask cancelled. Completed file changes are kept; check them before retrying.';
    registry.finish(task.record, collectedError);
  }

  if (collectedError) {
    return { ok: false, result: collectedText, error: collectedError, usage: collectedUsage };
  }
  return { ok: true, result: collectedText, usage: collectedUsage };
}
