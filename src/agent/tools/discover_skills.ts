import { discoverSkills } from '../skills';
import { listAvailableSkills } from './skill';
import { buildTool, type ToolImpl } from './_shared';

/** [deprecated] Skill listing is now injected directly into the system prompt
 *  via the budget-aware "Available Skills" block. The unified `skill` tool
 *  knows every skill by name without needing a discovery call. Kept registered
 *  (deferred) so older models / docs still work. */
export const discoverSkillsTool: ToolImpl = buildTool({
  spec: {
    name: 'discover_skills',
    description:
      '[deprecated: available skills are listed in the system prompt under ' +
      '"Available Skills"; call the `skill` tool directly] List vault skills.',
    parameters: { type: 'object', properties: {} },
  },
  isReadOnly: () => true,
  shouldDefer: true,
  searchHint: 'list available vault skills (deprecated)',
  describe: () => 'list skills',
  run: async (app) => {
    const visible = await listAvailableSkills(app);
    const all = await discoverSkills(app);
    const hidden = all.length - visible.length;
    if (visible.length === 0) {
      return all.length === 0
        ? 'No skills installed. Create `.glossa/skills/<name>/SKILL.md` with frontmatter (title, description) and a markdown body.'
        : `No skills currently activated. ${hidden} conditional skill${hidden === 1 ? '' : 's'} await${hidden === 1 ? 's' : ''} matching file activity.`;
    }
    const lines = visible.map(s => {
      const tail = [s.whenToUse && `when: ${s.whenToUse}`, s.triggers?.length && `triggers: ${s.triggers.join(', ')}`]
        .filter(Boolean).join('; ');
      return `- **${s.name}** — ${s.description}${tail ? `  (${tail})` : ''}`;
    });
    const footer = hidden > 0 ? `\n\n_(${hidden} conditional skill${hidden === 1 ? '' : 's'} hidden until matching files are touched.)_` : '';
    return `${visible.length} skill${visible.length === 1 ? '' : 's'} available:\n\n${lines.join('\n')}\n\nInvoke via skill({ skill: '<name>' }).${footer}`;
  },
});
