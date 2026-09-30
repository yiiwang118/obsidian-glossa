import type { DataAdapter } from 'obsidian';
import { safeWriteJson } from '../utils/safe_write';
import { objectValue, parseLearningContent, parseLearningEvaluation, parseLearningSource, canActivate, learningSkill, type LearningVersion } from './learning_contract';

export const LEARNING_PATH = '.glossa/learning.json';
export interface LearnedSkillRecord {
  name: string;
  activeId: string | null;
  versions: LearningVersion[];
}
export interface LearningLedger {
  schema: 1;
  revision: number;
  skills: LearnedSkillRecord[];
}

const queues = new WeakMap<DataAdapter, Promise<unknown>>();

function parseLedger(raw: string): LearningLedger {
  if (raw.length > 8_000_000) throw new Error('Learning history is too large.');
  const data = objectValue(JSON.parse(raw) as unknown);
  if (data.schema !== 1 || !Number.isSafeInteger(data.revision) || Number(data.revision) < 0 || !Array.isArray(data.skills) || data.skills.length > 60) {
    throw new Error('Unsupported learning history. Existing data was kept.');
  }
  const skills = data.skills.map((rawRecord: unknown): LearnedSkillRecord => {
    const record = objectValue(rawRecord);
    if (typeof record.name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(record.name)
      || (record.activeId !== null && typeof record.activeId !== 'string')
      || !Array.isArray(record.versions) || record.versions.length > 12 || !record.versions.length) throw new Error('Invalid skill history.');
    const versions = record.versions.map((rawVersion: unknown): LearningVersion => {
      const value = objectValue(rawVersion);
      const content = parseLearningContent(value);
      if (content.name !== record.name || typeof value.id !== 'string' || !value.id || !Number.isFinite(value.createdAt)
        || typeof value.correction !== 'string' || value.correction.length > 6000) throw new Error('Invalid skill version.');
      // Version metadata is local audit data, never interpreted as instructions.
      return { ...content, id: value.id, createdAt: Number(value.createdAt), correction: value.correction,
        source: value.source === undefined ? undefined : parseLearningSource(value.source),
        evaluation: value.evaluation === undefined ? undefined : parseLearningEvaluation(value.evaluation) };
    });
    if (new Set(versions.map(version => version.id)).size !== versions.length
      || (record.activeId !== null && !versions.some(version => version.id === record.activeId))) throw new Error('Invalid active skill version.');
    const active = versions.find(version => version.id === record.activeId);
    if (active && !canActivate(active, active.evaluation, active.evaluation?.baselineId ?? null)) throw new Error('Active skill content does not match its verification.');
    return { name: record.name, activeId: record.activeId as string | null, versions };
  });
  if (new Set(skills.map(record => record.name)).size !== skills.length) throw new Error('Duplicate skill history.');
  return { schema: 1, revision: Number(data.revision), skills };
}

export async function readLearningLedger(adapter: DataAdapter): Promise<LearningLedger> {
  await queues.get(adapter);
  return readCurrent(adapter);
}

async function readCurrent(adapter: DataAdapter): Promise<LearningLedger> {
  if (!await adapter.exists(LEARNING_PATH)) {
    // A backup without its main file can indicate an interrupted promotion.
    // Do not silently create an empty history over a recoverable ledger.
    if (await adapter.exists(`${LEARNING_PATH}.bak`)) throw new Error('Learning history needs recovery from learning.json.bak.');
    return { schema: 1, revision: 0, skills: [] };
  }
  return parseLedger(await adapter.read(LEARNING_PATH));
}

async function updateLedger(adapter: DataAdapter, revision: number, update: (ledger: LearningLedger) => void): Promise<LearningLedger> {
  const prior = queues.get(adapter) ?? Promise.resolve();
  const next = prior.then(async () => {
    const ledger = await readCurrent(adapter);
    if (ledger.revision !== revision) throw new Error('Learning history changed in another window. Reopen this dialog before saving.');
    update(ledger);
    ledger.revision++;
    // Check bounds and validity before touching the saved file.
    parseLedger(JSON.stringify(ledger, null, 2));
    if (!await adapter.exists('.glossa')) await adapter.mkdir('.glossa');
    await safeWriteJson(adapter, LEARNING_PATH, ledger, { pretty: true });
    return ledger;
  });
  queues.set(adapter, next.catch(() => undefined));
  return next;
}

export function saveLearningVersion(adapter: DataAdapter, revision: number, version: LearningVersion, activate: boolean, baselineId: string | null): Promise<LearningLedger> {
  return updateLedger(adapter, revision, ledger => {
    let record = ledger.skills.find(item => item.name === version.name);
    if ((record?.activeId ?? null) !== baselineId) throw new Error('The active skill changed. Run the examples again.');
    if (activate && !canActivate(version, version.evaluation, baselineId)) throw new Error('Run and pass every example on the current draft before enabling it.');
    if (!record) {
      record = { name: version.name, activeId: null, versions: [] };
      ledger.skills.push(record);
    }
    const saved = record.versions.find(item => item.id === version.id);
    if (saved && JSON.stringify(saved) !== JSON.stringify(version)) throw new Error('Saved versions are immutable. Save a new version.');
    if (!saved) record.versions.push(version);
    if (activate) record.activeId = version.id;
    while (record.versions.length > 12) {
      const remove = record.versions.findIndex(item => item.id !== record.activeId);
      record.versions.splice(remove, 1);
    }
  });
}

/** Restore only previously tested versions; drafts cannot bypass the gate. */
export function setLearningActive(adapter: DataAdapter, revision: number, name: string, id: string | null): Promise<LearningLedger> {
  return updateLedger(adapter, revision, ledger => {
    const record = ledger.skills.find(item => item.name === name);
    if (!record) throw new Error('Skill no longer exists.');
    if (id !== null) {
      const version = record.versions.find(item => item.id === id);
      if (!version || !canActivate(version, version.evaluation, version.evaluation?.baselineId ?? null)) throw new Error('This version has no passing example results.');
    }
    record.activeId = id;
  });
}

export async function loadLearnedSkills(adapter: DataAdapter) {
  const ledger = await readLearningLedger(adapter);
  return ledger.skills.flatMap(record => {
    const version = record.versions.find(item => item.id === record.activeId);
    return version ? [{ ...learningSkill(version), learningVersion: version.id }] : [];
  });
}
