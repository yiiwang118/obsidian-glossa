import { uid } from '../utils/dom';
import type { ChatSession, PendingMessage, RunDiagnostic, SessionGoal } from '../types';
import { buildTool, toolSuccess, toolFailure, type ToolImpl } from './tools/_shared';

export const MAX_INBOX = 20;
export function enqueueMessage(session: ChatSession, text: string, kind: PendingMessage['kind']): PendingMessage | null {
  const clean = text.trim();
  if (!clean || (session.inbox?.length ?? 0) >= MAX_INBOX) return null;
  const item = { id: uid(), text: clean, kind, createdAt: Date.now() };
  (session.inbox ??= []).push(item);
  return item;
}

export function takeSteering(session: ChatSession): PendingMessage[] {
  const items = (session.inbox ?? []).filter(m => m.kind === 'steer');
  session.inbox = (session.inbox ?? []).filter(m => m.kind !== 'steer');
  return items;
}

export function newGoal(objective: string, maxRounds: number): SessionGoal {
  return { objective: objective.trim().slice(0, 4000), phase: 'paused', progress: '', rounds: 0,
    maxRounds: Math.max(1, Math.min(20, Math.floor(maxRounds) || 3)), updatedAt: Date.now() };
}

/** A restored goal requires an explicit resume; never persist the armed flag. */
export function disarmGoal(session: ChatSession) {
  if (session.goal?.phase === 'active') session.goal.phase = 'paused';
}

export function canContinueGoal(goal: SessionGoal | undefined, armed: boolean): boolean {
  return !!goal && armed && goal.phase === 'active' && goal.rounds < goal.maxRounds;
}

export function goalPrompt(goal: SessionGoal): string {
  return `Continue the user-authorized task: ${goal.objective}\nProgress: ${goal.progress || '(first round)'}\n${goal.blocker ? `Previous blocker: ${goal.blocker}\n` : ''}Round ${goal.rounds + 1}/${goal.maxRounds}. Re-read any file before changing it. Preserve completed work; do not repeat successful writes. Use task_status to record progress and explicitly mark complete or blocked before your final response. Complete means the objective is achieved and verified; blocked means you need user input or an external change.`;
}

export function goalStatusTool(goal: SessionGoal, changed: () => Promise<void>): ToolImpl {
  return buildTool({
    isReadOnly: () => true, isConcurrencySafe: () => false,
    describe: () => 'Update task progress',
    spec: { name: 'task_status', description: 'Persist progress for the current user-created task. Report complete only after verification, or blocked with the specific missing input. Does not create tasks or increase the round budget.', parameters: {
      type: 'object', properties: { phase: { type: 'string', enum: ['active', 'blocked', 'complete'] }, progress: { type: 'string' }, blocker: { type: 'string' } }, required: ['phase', 'progress'], additionalProperties: false,
    } },
    run: async (_app, args: { phase: string; progress: string; blocker?: string }) => {
      if (!['active', 'blocked', 'complete'].includes(args.phase) || typeof args.progress !== 'string') return toolFailure('INVALID_STATUS', 'Invalid task status');
      if (args.phase === 'blocked' && !args.blocker?.trim()) return toolFailure('MISSING_BLOCKER', 'Describe the missing input or external change.');
      if (goal.phase !== 'active') return toolFailure('TASK_PAUSED', 'The task is no longer running.');
      goal.phase = args.phase as SessionGoal['phase'];
      goal.progress = args.progress.slice(0, 4000);
      goal.blocker = args.phase === 'blocked' ? args.blocker?.slice(0, 2000) : undefined;
      goal.updatedAt = Date.now();
      await changed();
      return toolSuccess(`Task ${goal.phase}: ${goal.progress}`);
    },
  });
}

/** Allowlist metadata only: never copy prompts, arguments, paths, headers or errors. */
export function recordDiagnostic(session: ChatSession, event: RunDiagnostic) {
  const safeTag = (value?: string) => value?.replace(/[^\w./:-]/g, '_').slice(0, 120);
  const safeCode = event.code && /^[A-Z][A-Z0-9_]{0,60}$/.test(event.code) ? event.code : undefined;
  const entry: RunDiagnostic = { at: event.at, kind: event.kind, runtime: event.runtime,
    model: safeTag(event.model), tool: safeTag(event.tool), status: safeTag(event.status), code: safeCode,
    durationMs: event.durationMs, count: event.count, skillVersion: safeTag(event.skillVersion) };
  session.diagnostics = [...(session.diagnostics ?? []), entry].slice(-500);
}

export function exportDiagnostics(session: ChatSession, pluginVersion: string): string {
  const clean: ChatSession = { ...session, diagnostics: [] };
  for (const event of session.diagnostics ?? []) recordDiagnostic(clean, event);
  return JSON.stringify({ format: 'glossa-diagnostics-v1', pluginVersion, exportedAt: new Date().toISOString(),
    privacy: 'Metadata only. No messages, note contents, tool arguments, paths, endpoint URLs or credentials.',
    events: clean.diagnostics }, null, 2);
}
