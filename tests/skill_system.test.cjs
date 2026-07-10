const path = require('path');

function fakeSkill(name, source = 'project') {
  return {
    name,
    title: name,
    description: `Detailed workflow for ${name} with a deliberately long explanation of when it is useful.`,
    whenToUse: `Use when ${name} is the explicit task target.`,
    path: `.glossa/skills/${name}/SKILL.md`,
    source,
    body: '# Workflow',
  };
}

exports.run = async function(t, loadModule) {
  const bundled = await loadModule(path.resolve(__dirname, '../src/agent/bundled_skills.ts'));
  bundled.initBundledSkills();
  const skills = bundled.getBundledSkills();
  t.eq(skills.map(skill => skill.name), [
    'obsidian-markdown', 'obsidian-canvas', 'obsidian-bases', 'pdf-analysis', 'image-analysis', 'skill-creator',
  ], 'six focused built-in skills are registered deterministically');
  t.eq(new Set(skills.map(skill => skill.name)).size, skills.length, 'built-in skill names are unique');
  t.ok(skills.every(skill => skill.description.length >= 60 && skill.whenToUse), 'every built-in skill has a useful discovery contract');
  t.ok(skills.every(skill => skill.body.includes('# Goal') && skill.body.includes('# Workflow') && skill.body.includes('# Done when')), 'every built-in skill defines goal, workflow, and completion criteria');

  const canvas = skills.find(skill => skill.name === 'obsidian-canvas');
  t.eq(canvas.requiredTools, ['read_canvas', 'patch_canvas'], 'Canvas skill auto-loads its dedicated tools');
  t.ok(canvas.body.includes('read_canvas') && canvas.body.includes('patch_canvas'), 'Canvas workflow uses dedicated tools');
  t.ok(!canvas.body.includes('write_note'), 'Canvas workflow no longer recommends generic full-file writes');

  const pdf = skills.find(skill => skill.name === 'pdf-analysis');
  t.eq(pdf.requiredTools, ['read_pdf'], 'PDF skill declares its task-aware reader');
  t.ok(pdf.body.includes('page numbers') && pdf.body.includes('visual'), 'PDF workflow preserves page evidence and visual fallback');

  const image = skills.find(skill => skill.name === 'image-analysis');
  t.eq(image.requiredTools, ['view_image'], 'image skill declares visual inspection tool');
  t.ok(image.body.includes('sample_points') && image.body.includes('region'), 'image workflow covers crops and exact pixel evidence');

  const creator = skills.find(skill => skill.name === 'skill-creator');
  t.eq(creator.requiredTools, ['validate_skill', 'create_note'], 'Skill Creator loads validation and safe new-file creation tools');
  t.ok(creator.body.includes('negative example') && creator.body.includes('freedom level'), 'Skill Creator defines trigger testing and appropriate constraint strength');

  const validation = await loadModule(path.resolve(__dirname, '../src/agent/skill_validation.ts'));
  t.eq(skills.flatMap(skill => validation.validateSkillDefinition(skill)), [], 'all bundled skills pass the shared quality validator without warnings');
  const bad = {
    ...fakeSkill('Bad Name'),
    description: 'Too short',
    whenToUse: undefined,
    body: 'Loose advice only',
    requiredTools: ['missing_tool'],
    paths: ['../outside/**'],
  };
  const badIssues = validation.validateSkillDefinition(bad, new Set(['read_note']));
  t.ok(badIssues.some(issue => issue.severity === 'error' && issue.field === 'name'), 'validator rejects non-kebab skill names');
  t.ok(badIssues.some(issue => issue.field === 'tools') && badIssues.some(issue => issue.field === 'paths'), 'validator catches unknown tools and unsafe path patterns');

  const listing = await loadModule(path.resolve(__dirname, '../src/agent/skill_listing.ts'));
  const many = Array.from({ length: 80 }, (_, index) => fakeSkill(`skill-${String(index).padStart(2, '0')}`, index < 5 ? 'bundled' : 'project'));
  const compact = listing.formatSkillListing(many, 100);
  t.ok(compact.length <= 512, 'skill listing obeys its hard minimum-context budget');
  t.ok(compact.includes('more'), 'over-budget listing reports omitted skills');
  const normal = listing.formatSkillListing(skills, 200000);
  t.ok(normal.includes('pdf-analysis:') && normal.includes('image-analysis:'), 'normal budget keeps built-in descriptions');

  const skillCore = await loadModule(path.resolve(__dirname, '../src/agent/skills.ts'));
  const parsed = skillCore.parseSkillFrontmatter({
    title: '  PDF helper  ',
    description: '  Read   a PDF carefully.  ',
    'required-tools': ['read_pdf', 'read_pdf', 'view_image'],
    paths: ['*.pdf', '*.pdf'],
  }, 'fallback');
  t.eq(parsed.title, 'PDF helper', 'skill title is normalized');
  t.eq(parsed.description, 'Read a PDF carefully.', 'skill description whitespace is normalized');
  t.eq(parsed.requiredTools, ['read_pdf', 'view_image'], 'required tool declarations are deduplicated');
  t.eq(parsed.paths, ['*.pdf'], 'path triggers are deduplicated');

  const render = await loadModule(path.resolve(__dirname, '../src/agent/skill_render.ts'));
  const writes = [];
  const dirs = new Set();
  const app = {
    vault: {
      adapter: {
        exists: async target => dirs.has(target) || writes.some(entry => entry.path === target),
        mkdir: async target => { dirs.add(target); },
        write: async (target, content) => { writes.push({ path: target, content }); },
      },
    },
  };
  const originalWarn = console.warn;
  console.warn = () => {};
  let rendered;
  try {
    rendered = await render.renderSkillBody(app, {
      name: 'render-test',
      title: 'Render test',
      description: 'Render test skill',
      path: '(bundled)/render-test/SKILL.md',
      source: 'bundled',
      body: 'Read ${SKILL_DIR}/nested/reference.md for $ARGUMENTS.',
      files: {
        '../escape.txt': 'blocked',
        'nested/reference.md': 'safe',
      },
    }, 'the target');
  } finally {
    console.warn = originalWarn;
  }
  t.ok(rendered.includes('.glossa/bundled-skills/render-test/nested/reference.md'), 'skill directory placeholder resolves deterministically');
  t.ok(rendered.includes('the target'), 'skill arguments are substituted');
  t.eq(writes, [{ path: '.glossa/bundled-skills/render-test/nested/reference.md', content: 'safe' }], 'bundled files reject traversal and create safe nested references');
};
