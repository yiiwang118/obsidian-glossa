import { getSkill } from '../skills';
import { validateSkillDefinition } from '../skill_validation';
import { buildTool, type ToolImpl } from './_shared';

function skillName(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const candidate = (value as Record<string, unknown>).skill;
  return typeof candidate === 'string' ? candidate.trim() : '';
}

export const validateSkill: ToolImpl = buildTool({
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  isDestructive: () => false,
  shouldDefer: true,
  searchHint: 'validate skill metadata triggers tools and workflow',
  searchTags: ['skill quality', 'SKILL.md lint', '技能校验', '检查技能'],
  describe: args => `validate skill ${skillName(args)}`,
  spec: {
    name: 'validate_skill',
    description: 'Validate one discovered Skill for naming, discovery cues, workflow structure, path safety, and referenced tools. Use after creating or editing .glossa/skills/<name>/SKILL.md.',
    parameters: {
      type: 'object',
      properties: {
        skill: { type: 'string', minLength: 1, description: 'Exact discovered skill name in lowercase kebab-case.' },
      },
      required: ['skill'],
      additionalProperties: false,
    },
  },
  run: async (app, args) => {
    const name = skillName(args);
    if (!name) return 'Error: skill is required.';
    const skill = await getSkill(app, name);
    if (!skill) return `Error: skill not found: ${name}`;
    const registry = await import('../tools');
    const available = new Set(registry.listToolSpecs({ includeDeferred: true }).map(spec => spec.name));
    const issues = validateSkillDefinition(skill, available);
    const errors = issues.filter(issue => issue.severity === 'error');
    const warnings = issues.filter(issue => issue.severity === 'warning');
    return JSON.stringify({
      skill: name,
      valid: errors.length === 0,
      errors,
      warnings,
      summary: `${errors.length} error(s), ${warnings.length} warning(s)`,
    }, null, 2);
  },
});
