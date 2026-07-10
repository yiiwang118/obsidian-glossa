/* eslint-disable @typescript-eslint/no-unsafe-member-access -- Dynamic plugin and host-app boundaries validate these values at runtime. */
import { getSkill } from '../skills';
import { renderSkillBody } from '../skill_render';
import { recordSkillUsage } from '../skill_usage';
import { buildTool, type ToolImpl } from './_shared';

/** [deprecated] Hidden from discovery but retained for saved tool calls. */
export const runSkill: ToolImpl = buildTool({
  spec: {
    name: 'run_skill',
    description:
      '[deprecated: use `skill` tool] Load a vault skill\'s instruction body. ' +
      'The unified `skill` tool replaces this with a single call: `skill({skill: "name", args: "..."})`.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Skill folder name (kebab-case).' },
        args: { type: 'string', description: 'Optional free-form arg the skill body can reference.' },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  isReadOnly: () => true,
  shouldDefer: true,
  searchHint: 'load vault skill body (deprecated, use skill tool)',
  describe: a => `run skill: ${a.name}`,
  run: async (app, { name, args }) => {
    if (typeof name !== 'string' || !name) return 'Error: name is required.';
    const skill = await getSkill(app, name);
    if (!skill) return `Error: no skill named "${name}". Use the \`skill\` tool to invoke.`;
    if (skill.disableModelInvocation) {
      return `Error: skill "${name}" is user-invocable only.`;
    }
    recordSkillUsage(app, name);
    const body = await renderSkillBody(app, skill, typeof args === 'string' ? args : '');
    const header = `# Skill: ${skill.title}\n\n_${skill.description}_\n\n${args ? `**Args**: ${args}\n\n` : ''}---\n\n`;
    return header + body;
  },
});
/* eslint-enable @typescript-eslint/no-unsafe-member-access -- Re-enable review lint rules after dynamic boundary module. */
