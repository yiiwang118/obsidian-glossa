import { uid } from '../utils/dom';

export interface SubtaskRecord {
  id: string;
  parentId?: string;
  title: string;
  phase: 'running' | 'stopping' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  startedAt: number;
  endedAt?: number;
  steps: number;
  tool?: string;
  output: string;
  error?: string;
  queued: number;
}

/** Controllers are transient; only bounded progress is saved with the chat. */
export class SubtaskRegistry {
  private readonly active = new Map<string, { controller: AbortController; queue: string[]; detach: () => void }>();
  constructor(readonly records: SubtaskRecord[], private readonly changed: () => void = () => {}) {}

  start(title: string, parentSignal?: AbortSignal, parentId?: string) {
    const record: SubtaskRecord = { id: uid(), parentId, title: title.slice(0, 160), phase: 'running', startedAt: Date.now(), steps: 0, output: '', queued: 0 };
    const controller = new AbortController();
    const abort = () => { if (record.phase === 'running') { record.phase = 'stopping'; controller.abort(); this.changed(); } };
    parentSignal?.addEventListener('abort', abort, { once: true });
    this.active.set(record.id, { controller, queue: [], detach: () => parentSignal?.removeEventListener('abort', abort) });
    this.records.push(record);
    while (this.records.length > 20) {
      const index = this.records.findIndex(item => !this.active.has(item.id));
      if (index < 0) break;
      this.records.splice(index, 1);
    }
    if (parentSignal?.aborted) abort();
    this.changed();
    return { record, signal: controller.signal };
  }

  stop(id: string): boolean {
    const entry = this.active.get(id), record = this.records.find(item => item.id === id);
    if (!entry || !record || record.phase !== 'running') return false;
    record.phase = 'stopping'; entry.queue.length = 0; record.queued = 0;
    entry.controller.abort(); this.changed(); return true;
  }

  steer(id: string, text: string): boolean {
    const entry = this.active.get(id), record = this.records.find(item => item.id === id);
    if (!entry || !record || record.phase !== 'running' || !text.trim() || text.length > 4000 || entry.queue.length >= 5) return false;
    entry.queue.push(text.trim()); record.queued = entry.queue.length; this.changed(); return true;
  }

  takeSteering(id: string): string[] {
    const entry = this.active.get(id), record = this.records.find(item => item.id === id);
    if (!entry || entry.controller.signal.aborted) return [];
    const result = entry.queue.splice(0);
    if (record) record.queued = 0;
    if (result.length) this.changed();
    return result;
  }

  update(record: SubtaskRecord, update: Partial<Pick<SubtaskRecord, 'steps' | 'tool' | 'output'>>, notify = true) {
    if (record.phase !== 'running') return;
    Object.assign(record, update);
    record.output = record.output.slice(-6000);
    if (notify) this.changed();
  }

  finish(record: SubtaskRecord, error?: string) {
    const entry = this.active.get(record.id);
    if (!entry) return;
    record.phase = entry.controller.signal.aborted ? 'cancelled' : error ? 'failed' : 'completed';
    record.endedAt = Date.now(); record.error = error?.slice(0, 2000); record.tool = undefined; record.queued = 0;
    entry.detach(); this.active.delete(record.id); this.changed();
  }
}
