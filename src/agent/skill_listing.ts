/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-duplicate-type-constituents, @typescript-eslint/only-throw-error, @typescript-eslint/no-unused-vars -- Dynamic plugin and host-app boundaries validate these values at runtime. */
/**
 * Budget-aware skill listing for system-prompt injection.
 *
 * Mirrors upstream Claude Code's `formatCommandsWithinBudget`. Allocates 1% of
 * the context window (in characters) to skill listing. When the full listing
 * fits, we emit it verbatim. When it doesn't:
 *   1. Bundled skills always keep full descriptions (we ship them, we trust them).
 *   2. Other skills get description truncated to fit.
 *   3. If even names+truncated wouldn't fit, fall back to names-only for
 *      non-bundled, full descriptions for bundled.
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
const SKILL_BUDGET_PCT = 0.01;
const DEFAULT_BUDGET_CHARS = 8_000;       // 1% of 200k × 4 = 8000
const PER_ENTRY_DESC_CAP = 250;            // hard per-entry cap
const MIN_DESC_LEN = 20;                   // minimum useful description length

function getCharBudget(contextWindowTokens?: number): number {
  if (contextWindowTokens && contextWindowTokens > 0) {
    return Math.floor(contextWindowTokens * CHARS_PER_TOKEN * SKILL_BUDGET_PCT);
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

/** Truncate `s` to fit in `maxLen` chars (including ellipsis). */
function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  if (maxLen <= 1) return '…';
  return s.slice(0, maxLen - 1) + '…';
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

  // 2. Partition bundled vs rest. Bundled keeps full description always.
  const bundledLines: string[] = [];
  const restSkills: Skill[] = [];
  let bundledChars = 0;
  for (const e of fullEntries) {
    if (e.s.source === 'bundled') {
      bundledLines.push(e.line);
      bundledChars += e.line.length + 1;
    } else {
      restSkills.push(e.s);
    }
  }
  const remaining = budget - bundledChars;
  if (restSkills.length === 0) return bundledLines.join('\n');

  // 3. Compute per-rest-skill name overhead and divvy the remainder.
  const restNameOverhead = restSkills.reduce((sum, s) => sum + `- ${s.name}: `.length, 0) + (restSkills.length - 1);
  const availableForDescs = remaining - restNameOverhead;
  const maxDescLen = Math.floor(availableForDescs / restSkills.length);

  if (maxDescLen < MIN_DESC_LEN) {
    // 4. Names-only fallback for non-bundled.
    const restNames = restSkills.map(s => `- ${s.name}`);
    return [...bundledLines, ...restNames].join('\n');
  }

  // 5. Truncate non-bundled descriptions.
  const restLines = restSkills.map(s => `- ${s.name}: ${truncate(getEntryDescription(s), maxDescLen)}`);
  return [...bundledLines, ...restLines].join('\n');
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
    'You can invoke any of the following skills via the `skill` tool (pass the name as `skill`). Each provides specialized guidance. When the user request matches a skill, invoke it BEFORE other actions.',
    '',
    body,
    '',
  ].join('\n');
}
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-duplicate-type-constituents, @typescript-eslint/only-throw-error, @typescript-eslint/no-unused-vars */
