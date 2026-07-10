/* eslint-disable @typescript-eslint/no-unsafe-member-access -- Dynamic plugin and host-app boundaries validate these values at runtime. */
/**
 * Unified `skill` tool — replaces the legacy `discover_skills` + `run_skill`
 * pair. The model now sees a single tool with one input (`skill: string`,
 * optional `args: string`). The available skill list is injected into the
 * system prompt as a budget-aware listing (see formatSkillListing in
 * ../skills_listing.ts). When the model calls this tool, the skill's body is
 * loaded and prepended with metadata so it becomes part of the task context.
 *
 * Mirrors upstream Claude Code's SkillTool. Conditional skills (with `paths`
 * frontmatter) are only listed/invocable AFTER they've been activated by a
 * touched file matching their paths.
 *
 * The legacy tools (`discover_skills`, `run_skill`) remain registered for
 * backwards compatibility but are marked deprecated in their descriptions.
 */
import type { App } from 'obsidian';
import { discoverSkills, type Skill } from '../skills';
import { activeSkillNames } from '../skill_activation';
import { recordSkillUsage } from '../skill_usage';
import { renderSkillBody } from '../skill_render';
import { buildTool, type ToolImpl, type PermissionResult, type ToolRunResult } from './_shared';

/** Allowlist of "safe" skill fields. A skill with ONLY these populated can run
 *  without per-call approval. As soon as a skill carries `allowedTools`,
 *  `context: fork`, `model`, or other capability-bearing fields, we require
 *  approval. Mirrors upstream Claude Code's SAFE_SKILL_PROPERTIES. */
const SAFE_SKILL_KEYS: ReadonlySet<keyof Skill> = new Set<keyof Skill>([
  'name', 'title', 'description', 'whenToUse', 'triggers',
  'paths', 'requiredTools', 'argumentHint', 'userInvocable', 'disableModelInvocation',
  'path', 'source', 'body',
]);

/** Skill is "safe" iff every non-empty key is in SAFE_SKILL_KEYS. */
function skillHasOnlySafeProperties(s: Skill): boolean {
  for (const key of Object.keys(s) as (keyof Skill)[]) {
    if (SAFE_SKILL_KEYS.has(key)) continue;
    const v = s[key];
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) continue;
    return false;
  }
  return true;
}

/** Visible skills — bundled / safe-property skills auto-listed; conditional
 *  (paths-gated) ones only appear after activation. */
export async function listAvailableSkills(app: App): Promise<Skill[]> {
  const all = await discoverSkills(app);
  const active = activeSkillNames();
  return all.filter(s => {
    if (s.disableModelInvocation) return false;
    // Conditional skills (paths set) are hidden until activated this session.
    if (s.paths && s.paths.length > 0 && !active.has(s.name)) return false;
    return true;
  });
}

async function resolveAvailableSkill(app: App, requested: string): Promise<Skill | null> {
  const available = await listAvailableSkills(app);
  const exact = available.find(skill => skill.name === requested);
  if (exact) return exact;
  const normalized = requested.trim().toLowerCase();
  if (!normalized) return null;
  const relaxed = available.filter(skill =>
    skill.name.toLowerCase() === normalized || skill.title.toLowerCase() === normalized);
  return relaxed.length === 1 ? relaxed[0] : null;
}

export const skillTool: ToolImpl = buildTool({
  spec: {
    name: 'skill',
    description:
      'Load one specialized playbook from "Available Skills". Invoke it once when its workflow materially matches the request, before task-specific tool calls. Skip it for direct answers and routine edits. The result supplies instructions and automatically loads any specialized tools declared by that skill.',
    parameters: {
      type: 'object',
      properties: {
        skill: { type: 'string', minLength: 1, maxLength: 120, description: 'Exact skill name from "Available Skills".' },
        args: { type: 'string', maxLength: 4000, description: 'Optional task-specific arguments referenced by the playbook as $ARGUMENTS.' },
      },
      required: ['skill'],
      additionalProperties: false,
    },
  },
  describe: a => `skill: ${a.skill}${a.args ? ` (${String(a.args).slice(0, 40)})` : ''}`,
  searchHint: 'invoke a markdown-authored vault playbook',
  searchTags: ['workflow', 'domain instructions', '技能', '工作流'],
  isReadOnly: () => true,   // injects content; doesn't mutate vault
  isConcurrencySafe: () => false, // skill body might prepare follow-up tool calls — keep sequential
  maxResultSizeChars: 80_000,
  async checkPermissions(_app, args): Promise<PermissionResult> {
    const name = String(args?.skill ?? '');
    if (!name) return { behavior: 'deny', message: 'Missing skill name.' };
    const skill = await resolveAvailableSkill(_app, name);
    if (!skill) return { behavior: 'deny', message: `Skill "${name}" is not available in the current context.` };
    if (skill.disableModelInvocation) {
      return { behavior: 'deny', message: `Skill "${name}" is user-invocable only.` };
    }
    // Auto-allow when the skill only uses safe fields. Anything else (allowedTools,
    // fork context, model override) requires explicit approval each time.
    if (skillHasOnlySafeProperties(skill)) return { behavior: 'allow' };
    return { behavior: 'ask', message: `Run skill: ${name}` };
  },
  run: async (app, args): Promise<ToolRunResult | string> => {
    const name = String(args?.skill ?? '');
    if (!name) return 'Error: skill name is required.';
    const skill = await resolveAvailableSkill(app, name);
    if (!skill) {
      const available = await listAvailableSkills(app);
      const known = available.map(item => item.name).slice(0, 12).join(', ') || '(none available)';
      return `Error: skill "${name}" is not available in the current context. Available: ${known}.`;
    }
    if (skill.disableModelInvocation) {
      return `Error: skill "${name}" is user-invocable only and cannot be called by the model.`;
    }
    // Forked execution path is implemented separately (P3-14). When a
    // forked-skill runtime is wired into the loop, this branch is intercepted
    // upstream before run() is called. If we reach here for a fork skill, it
    // means the runtime hasn't been hooked up — fall back to inline.
    const argCandidate = args?.args as unknown;
    const argText = typeof argCandidate === 'string' ? argCandidate.slice(0, 4000) : '';
    const body = await renderSkillBody(app, skill, argText);
    recordSkillUsage(app, skill.name);
    const head = `# Skill: ${skill.title}\n\n_${skill.description}_\n`;
    const meta: string[] = [];
    if (skill.whenToUse) meta.push(`**When to use**: ${skill.whenToUse}`);
    if (argText) meta.push(`**Args**: ${argText}`);
    if (skill.requiredTools?.length) meta.push(`**Tools loaded for this workflow**: ${skill.requiredTools.join(', ')}`);
    if (skill.allowedTools?.length) meta.push(`**Tools allowed for this skill**: ${skill.allowedTools.join(', ')}`);
    const metaBlock = meta.length ? `\n${meta.join('\n')}\n` : '';
    return {
      text: `${head}${metaBlock}\n---\n\n${body}`,
      loadedToolNames: skill.requiredTools,
    };
  },
});
/* eslint-enable @typescript-eslint/no-unsafe-member-access -- Re-enable review lint rules after dynamic boundary module. */
