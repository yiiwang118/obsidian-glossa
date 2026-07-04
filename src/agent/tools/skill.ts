/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- Dynamic plugin, model, and vault payloads are validated at runtime boundaries. */
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
import { discoverSkills, getSkill, type Skill } from '../skills';
import { activeSkillNames } from '../skill_activation';
import { recordSkillUsage } from '../skill_usage';
import { renderSkillBody } from '../skill_render';
import { buildTool, type ToolImpl, type PermissionResult } from './_shared';

/** Allowlist of "safe" skill fields. A skill with ONLY these populated can run
 *  without per-call approval. As soon as a skill carries `allowedTools`,
 *  `context: fork`, `model`, or other capability-bearing fields, we require
 *  approval. Mirrors upstream Claude Code's SAFE_SKILL_PROPERTIES. */
const SAFE_SKILL_KEYS: ReadonlySet<keyof Skill> = new Set<keyof Skill>([
  'name', 'title', 'description', 'whenToUse', 'triggers',
  'paths', 'argumentHint', 'userInvocable', 'disableModelInvocation',
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

export const skillTool: ToolImpl = buildTool({
  spec: {
    name: 'skill',
    description:
      'Execute a vault skill (a markdown-authored playbook). Skills are listed in ' +
      'the system prompt under "Available Skills". When the user request matches ' +
      'a skill, call this tool with the skill name BEFORE any other action — the ' +
      'skill body provides domain-specific instructions. Pass `args` for skills ' +
      'that accept free-form arguments.',
    parameters: {
      type: 'object',
      properties: {
        skill: { type: 'string', description: 'Skill name (kebab-case, e.g. "obsidian-canvas").' },
        args: { type: 'string', description: 'Optional free-form argument string the skill body can reference via $ARGUMENTS.' },
      },
      required: ['skill'],
    },
  },
  describe: a => `skill: ${a.skill}${a.args ? ` (${String(a.args).slice(0, 40)})` : ''}`,
  searchHint: 'invoke a markdown-authored vault playbook',
  isReadOnly: () => true,   // injects content; doesn't mutate vault
  isConcurrencySafe: () => false, // skill body might prepare follow-up tool calls — keep sequential
  maxResultSizeChars: 400_000,    // skill bodies can be long; bump above the default 100k
  async checkPermissions(_app, args): Promise<PermissionResult> {
    const name = String(args?.skill ?? '');
    if (!name) return { behavior: 'deny', message: 'Missing skill name.' };
    const skill = await getSkill(_app, name);
    if (!skill) return { behavior: 'deny', message: `Unknown skill "${name}".` };
    if (skill.disableModelInvocation) {
      return { behavior: 'deny', message: `Skill "${name}" is user-invocable only.` };
    }
    // Auto-allow when the skill only uses safe fields. Anything else (allowedTools,
    // fork context, model override) requires explicit approval each time.
    if (skillHasOnlySafeProperties(skill)) return { behavior: 'allow' };
    return { behavior: 'ask', message: `Run skill: ${name}` };
  },
  run: async (app, args) => {
    const name = String(args?.skill ?? '');
    if (!name) return 'Error: skill name is required.';
    const skill = await getSkill(app, name);
    if (!skill) {
      const all = await discoverSkills(app);
      const known = all.map(s => s.name).slice(0, 12).join(', ') || '(none installed)';
      return `Error: no skill named "${name}". Available: ${known}.`;
    }
    if (skill.disableModelInvocation) {
      return `Error: skill "${name}" is user-invocable only and cannot be called by the model.`;
    }
    // Forked execution path is implemented separately (P3-14). When a
    // forked-skill runtime is wired into the loop, this branch is intercepted
    // upstream before run() is called. If we reach here for a fork skill, it
    // means the runtime hasn't been hooked up — fall back to inline.
    recordSkillUsage(app, name);
    const body = await renderSkillBody(app, skill, typeof args?.args === 'string' ? args.args : '');
    const head = `# Skill: ${skill.title}\n\n_${skill.description}_\n`;
    const meta: string[] = [];
    if (skill.whenToUse) meta.push(`**When to use**: ${skill.whenToUse}`);
    if (args?.args) meta.push(`**Args**: ${String(args.args)}`);
    if (skill.allowedTools?.length) meta.push(`**Tools allowed for this skill**: ${skill.allowedTools.join(', ')}`);
    const metaBlock = meta.length ? `\n${meta.join('\n')}\n` : '';
    return `${head}${metaBlock}\n---\n\n${body}`;
  },
});
