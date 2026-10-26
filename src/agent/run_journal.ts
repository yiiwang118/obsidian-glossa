import type { ChatSession } from '../types';

export type RunPhase = 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export type RunEventKind = 'started' | 'waiting' | 'resumed' | 'step' | 'tool-started' | 'tool-finished' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export interface RunProjection { seq: number; phase: RunPhase }
/** Metadata only. Message and tool contents remain in the existing chat format. */
export interface RunEvent { seq: number; kind: RunEventKind; at: number; key?: string }
export interface RunJournal {
  id: string;
  startedAt: number;
  checkpoint: RunProjection;
  events: RunEvent[];
  state: RunProjection;
}

export function isRunOpen(state: RunProjection): boolean {
  return state.phase === 'running' || state.phase === 'waiting';
}

/** Ordered replay is strict about gaps, idempotent about repeated delivery. */
export function foldRun(state: RunProjection, event: RunEvent): RunProjection {
  if (event.seq <= state.seq) return state;
  if (event.seq !== state.seq + 1) throw new Error('Run event sequence has a gap.');
  if (!isRunOpen(state)) return state;
  const phases: Partial<Record<RunEventKind, RunPhase>> = {
    started: 'running', waiting: 'waiting', resumed: 'running',
    completed: 'completed', failed: 'failed', cancelled: 'cancelled', interrupted: 'interrupted',
  };
  return { seq: event.seq, phase: phases[event.kind] ?? state.phase };
}

export function replayRun(run: RunJournal): RunProjection {
  const phases = ['running', 'waiting', 'completed', 'failed', 'cancelled', 'interrupted'];
  const kinds = [...phases, 'started', 'resumed', 'step', 'tool-started', 'tool-finished'];
  if (!run || typeof run.id !== 'string' || !run.checkpoint || !Number.isSafeInteger(run.checkpoint.seq)
    || run.checkpoint.seq < 0 || !phases.includes(run.checkpoint.phase) || !Array.isArray(run.events)
    || run.events.length > 512 || run.events.some(event => !event || !Number.isSafeInteger(event.seq) || event.seq < 1
      || !kinds.includes(event.kind) || !Number.isFinite(event.at) || (event.key !== undefined && typeof event.key !== 'string'))) {
    throw new Error('Invalid run journal.');
  }
  return run.events.reduce(foldRun, run.checkpoint);
}

export function beginRun(session: ChatSession, id: string, at = Date.now()): RunJournal {
  const previous = session.runs?.[session.runs.length - 1];
  if (previous && isRunOpen(previous.state)) throw new Error('This chat already has an unfinished run.');
  const run: RunJournal = { id, startedAt: at, checkpoint: { seq: 0, phase: 'running' }, events: [], state: { seq: 0, phase: 'running' } };
  session.runs = [...(session.runs ?? []).slice(-19), run];
  appendRunEvent(run, 'started', undefined, at);
  return run;
}

export function appendRunEvent(run: RunJournal, kind: RunEventKind, key?: string, at = Date.now()): boolean {
  if (!isRunOpen(run.state)) return false;
  if (key && run.events.some(e => e.kind === kind && e.key === key)) return false;
  const event: RunEvent = { seq: run.state.seq + 1, kind, at, ...(key ? { key } : {}) };
  run.state = foldRun(run.state, event);
  run.events.push(event);
  // A folded checkpoint bounds disk use without changing replay semantics.
  if (run.events.length > 512) run.checkpoint = foldRun(run.checkpoint, run.events.shift());
  // Only an unfinished run needs its events; a finished one keeps just its outcome.
  if (!isRunOpen(run.state)) { run.checkpoint = run.state; run.events = []; }
  return true;
}

/** Disk recovery never re-executes tools or claims a partially written operation failed. */
export function recoverRuns(session: ChatSession, at = Date.now()): boolean {
  let changed = false;
  if (Array.isArray(session.runs)) {
    session.runs = session.runs.slice(-20).map((saved, index) => {
      let run = saved;
      try { run.state = replayRun(run); }
      catch {
        const state: RunProjection = { seq: 0, phase: 'interrupted' };
        run = { id: typeof saved?.id === 'string' ? saved.id : `recovered-${index}`, startedAt: at, checkpoint: state, state, events: [] };
        changed = true;
      }
      if (isRunOpen(run.state)) { appendRunEvent(run, 'interrupted', undefined, at); changed = true; }
      return run;
    });
  } else if (session.runs !== undefined) {
    delete session.runs; changed = true;
  }
  // Like runs, damaged progress records must not keep the chat from opening.
  if (session.subtasks !== undefined && !Array.isArray(session.subtasks)) { delete session.subtasks; changed = true; }
  else if (session.subtasks?.some(task => !task || typeof task !== 'object')) {
    session.subtasks = session.subtasks.filter(task => task && typeof task === 'object'); changed = true;
  }
  for (const task of session.subtasks ?? []) {
    if (task.phase === 'running' || task.phase === 'stopping') {
      task.phase = 'interrupted'; task.endedAt = at; task.queued = 0; task.tool = undefined; changed = true;
    }
  }
  for (const message of session.messages ?? []) {
    for (const tool of message.toolEvents ?? []) {
      if (tool.status !== 'running' && tool.status !== 'pending') continue;
      tool.status = 'cancelled';
      tool.errorCode = 'RUN_INTERRUPTED';
      tool.result = 'Execution was interrupted. Its effects are unknown; inspect the affected files before retrying.';
      tool.endedAt = at;
      changed = true;
    }
  }
  return changed;
}
