
/**
 * Budget-aware skill listing for system-prompt injection.
 *
 * Mirrors upstream Claude Code's `formatCommandsWithinBudget`. Allocates 0.5% of
 * the context window (in characters) to skill listing. When the full listing
 * fits, we emit it verbatim. When it doesn't:
 *   1. Keep every skill name when possible.
 *   2. Allocate description space fairly, with bundled skills first.
 *   3. Enforce the hard budget even with hundreds of skills.
 *
 * Skill order priority within the budget:
 *   - frequency (most-used first) when usage data available
 *   - then alphabetical (stable fallback)
 */
import type { App } from 'obsidian';
import type { Skill } from './skills';
import { listAvailableSkills } from './tools/skill';
import { getSkillUsage, sortByFrequency } from './skill_usage';

const CHARS_PER_TOKEN = 4;
const SKILL_BUDGET_PCT = 0.005;
const DEFAULT_BUDGET_CHARS = 4_000;
const MIN_BUDGET_CHARS = 512;
const MAX_BUDGET_CHARS = 6_000;
const PER_ENTRY_DESC_CAP = 250;            // hard per-entry cap
const MIN_DESC_LEN = 20;                   // minimum useful description length

function getCharBudget(contextWindowTokens?: number): number {
  if (contextWindowTokens && contextWindowTokens > 0) {
    return Math.max(MIN_BUDGET_CHARS, Math.min(
      MAX_BUDGET_CHARS,
      Math.floor(contextWindowTokens * CHARS_PER_TOKEN * SKILL_BUDGET_PCT),
    ));
  }
  return DEFAULT_BUDGET_CHARS;
}

function getEntryDescription(s: Skill): string {
  const desc = s.whenToUse
    ? `${s.description} — ${s.whenToUse}`
    : s.description;
  if (desc.length > PER_ENTRY_DESC_CAP) return desc.slice(0, PER_ENTRY_DESC_CAP - 1) + '…';
  return desc;
}

function formatFull(s: Skill): string {
  return `- ${s.name}: ${getEntryDescription(s)}`;
}

/** Render the skill list into a single markdown block ready to splice into
 *  the system prompt. Returns the empty string when there are no skills. */
export function formatSkillListing(skills: Skill[], contextWindowTokens?: number): string {
  if (skills.length === 0) return '';
  const budget = getCharBudget(contextWindowTokens);

  // 1. Try full descriptions.
  const fullEntries = skills.map(s => ({ s, line: formatFull(s) }));
  const fullTotal = fullEntries.reduce((sum, e) => sum + e.line.length + 1, -1);  // -1 for trailing \n adjustment
  if (fullTotal <= budget) {
    return fullEntries.map(e => e.line).join('\n');
  }

  // 2. Reserve names first so a long description cannot hide later skills.
  const nameLines = skills.map(skill => `- ${skill.name}`);
  const namesTotal = nameLines.reduce((sum, line) => sum + line.length + 1, -1);
  if (namesTotal > budget) return fitNamesWithinBudget(nameLines, budget);

  // 3. Give each entry a useful minimum description, then distribute the
  // remaining budget in small round-robin chunks. Bundled entries go first,
  // but cannot consume the entire budget in one pass.
  const descriptions = skills.map(getEntryDescription);
  const allocations = skills.map(() => 0);
  const priority = skills
    .map((skill, index) => ({ skill, index }))
    .sort((a, b) => Number(b.skill.source === 'bundled') - Number(a.skill.source === 'bundled'))
    .map(entry => entry.index);
  let remaining = budget - namesTotal;
  for (const index of priority) {
    const initial = Math.min(MIN_DESC_LEN, descriptions[index].length);
    if (initial === 0 || remaining < initial + 2) continue;
    allocations[index] = initial;
    remaining -= initial + 2;
  }
  while (remaining > 0) {
    let progressed = false;
    for (const index of priority) {
      if (allocations[index] === 0) continue;
      const available = descriptions[index].length - allocations[index];
      if (available <= 0) continue;
      const chunk = Math.min(16, available, remaining);
      allocations[index] += chunk;
      remaining -= chunk;
      progressed = true;
      if (remaining === 0) break;
    }
    if (!progressed) break;
  }

  return nameLines.map((line, index) => {
    const length = allocations[index];
    if (length === 0) return line;
    const description = descriptions[index];
    const rendered = length < description.length && length > 1
      ? description.slice(0, length - 1) + '…'
      : description.slice(0, length);
    return `${line}: ${rendered}`;
  }).join('\n');
}

function fitNamesWithinBudget(lines: readonly string[], budget: number): string {
  const out: string[] = [];
  for (const line of lines) {
    const candidate = [...out, line].join('\n');
    if (candidate.length > budget) break;
    out.push(line);
  }
  const hidden = lines.length - out.length;
  if (hidden > 0) {
    const marker = `- … ${hidden} more`;
    while (out.length > 0 && [...out, marker].join('\n').length > budget) out.pop();
    if (marker.length <= budget) out.push(marker);
  }
  return out.join('\n');
}

/** Produce the full "Available Skills" block (with header) for the system
 *  prompt. Returns the empty string if there are no visible skills. */
export async function buildSkillSystemBlock(
  app: App,
  contextWindowTokens?: number,
): Promise<string> {
  const visible = await listAvailableSkills(app);
  if (visible.length === 0) return '';
  const usage = await getSkillUsage(app);
  const ordered = sortByFrequency(visible, usage);
  const body = formatSkillListing(ordered, contextWindowTokens);
  if (!body) return '';
  return [
    '',
    '## Available Skills',
    '',
    'Use `skill` only when one playbook materially improves the task. Invoke the single best match once before task-specific tools; skip skills for direct answers and routine edits.',
    '',
    body,
    '',
  ].join('\n');
}
