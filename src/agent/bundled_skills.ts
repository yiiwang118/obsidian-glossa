/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-duplicate-type-constituents, @typescript-eslint/only-throw-error, @typescript-eslint/no-unused-vars -- Dynamic plugin and host-app boundaries validate these values at runtime. */
/**
 * Bundled skills — ship with the plugin, registered at startup.
 *
 * To add a new bundled skill, define its body as a string + frontmatter
 * fields below, then call `registerBundledSkill()` in `initBundledSkills()`.
 *
 * Bundled skills always appear in the listing with full descriptions (the
 * budget-aware truncator preserves them); the body is only injected when
 * the model invokes `skill({skill: '<name>'})`.
 *
 * Skills with `paths` frontmatter are CONDITIONAL — they don't appear until
 * a matching file is touched in the session. This keeps the system prompt
 * lean (a Canvas-specific skill doesn't bloat token budget unless the user
 * actually opens a `.canvas` file).
 */
import { clearBundledSkills, registerBundledSkill } from './skills';

/** obsidian-markdown — taught format. Always available (no paths gate). */
const SKILL_OBSIDIAN_MARKDOWN = `
You are editing files in an Obsidian vault. Use Obsidian-flavored Markdown
syntax. Key conventions:

**Wikilinks** — internal references use double brackets:
- \`[[Note Name]]\` links to "Note Name.md" by basename anywhere in the vault.
- \`[[Note#Heading]]\` jumps to a specific heading.
- \`[[Note^block-id]]\` jumps to a block reference.
- \`[[Note|Alias]]\` shows "Alias" as the visible text.

**Embeds** — same syntax with a leading bang renders the target inline:
- \`![[Note Name]]\` — embed full note.
- \`![[Image.png]]\` — embed image (also videos / PDFs).
- \`![[Note#Heading]]\` — embed only that section.

**Callouts** — blockquote with a type marker:
\`\`\`
> [!note] Optional title
> This is a callout.
\`\`\`
Common types: note, info, tip, warning, danger, example, question, quote.
Use \`> [!note]-\` (trailing dash) for collapsed-by-default.

**Properties / frontmatter** — YAML at the top of the file between \`---\`:
\`\`\`
---
tags: [research, drafts]
date: 2026-05-18
status: in-progress
---
\`\`\`

**Block references** — append \`^id\` at the end of a paragraph to create a
linkable block. Then \`[[Note^id]]\` from anywhere.

**Math** — inline \`$E = mc^2$\`, display \`$$...$$\`. KaTeX rules.

**Comments** — \`%%hidden%%\` — invisible in reading mode.

**Tags** — \`#tag\` inline, or \`tags: [a, b]\` in frontmatter.

When writing or editing notes, preserve existing frontmatter / properties.
Don't dump rewritten file content as chat text — use the write tools.
`.trim();

/** obsidian-canvas — only activates when a .canvas file is touched. */
const SKILL_OBSIDIAN_CANVAS = `
You are editing an Obsidian \`.canvas\` file (JSON Canvas 1.0 format).

A canvas is a JSON document with two top-level arrays:
\`\`\`json
{
  "nodes": [...],
  "edges": [...]
}
\`\`\`

**Nodes**: each has an id, type, x/y/width/height. Type-specific extras:
- \`type: "text"\` — \`text: "..."\` content
- \`type: "file"\` — \`file: "path/to/note.md"\`
- \`type: "link"\` — \`url: "https://..."\`
- \`type: "group"\` — \`label: "..."\`, contains other nodes spatially

**Edges**: \`{id, fromNode, fromSide, toNode, toSide}\` where side ∈ top/right/bottom/left.

Y axis grows DOWNWARD. Coordinates are pixel units; typical node sizes are
200–400 wide. Use \`width: 250, height: 60\` for a default text node.

When editing, treat the canvas like JSON: read full, modify the node/edge
list, write back. Never mix \`patch_note\` calls — JSON requires whole-file
overwrites. Use \`apply_patch\` or \`write_note\` for .canvas changes.

**Reference**: see \`\${SKILL_DIR}/example.canvas\` for a minimal valid canvas
with two text nodes joined by one edge. Read it before authoring a new canvas.
`.trim();

/** A minimal example canvas extracted to disk on first skill use so the model
 *  has a reachable reference. JSON Canvas 1.0 syntax. */
const EXAMPLE_CANVAS = `{
  "nodes": [
    {
      "id": "n1",
      "type": "text",
      "x": -240,
      "y": -60,
      "width": 240,
      "height": 60,
      "text": "Source node\\n\\nClick to edit."
    },
    {
      "id": "n2",
      "type": "text",
      "x": 80,
      "y": -60,
      "width": 240,
      "height": 60,
      "text": "Target node"
    }
  ],
  "edges": [
    {
      "id": "e1",
      "fromNode": "n1",
      "fromSide": "right",
      "toNode": "n2",
      "toSide": "left",
      "label": "leads to"
    }
  ]
}
`;

/** obsidian-bases — only activates for .base files (Obsidian Bases). */
const SKILL_OBSIDIAN_BASES = `
You are editing an Obsidian \`.base\` file. Bases are vault-native databases
(YAML configuration over the notes graph).

Top-level keys:
- \`filters\`: which notes are included (DSL: \`file.tags.contains("x")\`, \`file.has("status")\`)
- \`properties\`: which note properties are shown as columns
- \`formulas\`: computed columns (\`{name: total, formula: "price * qty"}\`)
- \`views\`: table / card / gallery views with per-view sort, group, filter
- \`summarize\`: aggregate functions per group

Example:
\`\`\`yaml
filters:
  and:
    - file.hasTag("project")
    - status != "done"
properties:
  - file.name
  - status
  - dueDate
formulas:
  - name: daysLeft
    formula: "if(dueDate, dueDate.daysFromNow(), null)"
views:
  - type: table
    name: Active
    sort: [dueDate]
\`\`\`

Filters use a JS-like expression dialect. String comparisons are
case-sensitive. \`file.*\` accessors include \`name\`, \`path\`, \`mtime\`,
\`ctime\`, \`tags\`, \`folder\`, \`size\`.

Bases files are YAML — edit via \`apply_patch\` envelope, not piecewise
\`patch_note\` (which is line-based and easily breaks YAML structure).
`.trim();

/** Skill init — called once at plugin layout-ready. */
export function initBundledSkills(): void {
  // Re-entry guard: a hot reload re-runs onLayoutReady. Clear first so we
  // don't accumulate duplicates.
  clearBundledSkills();

  registerBundledSkill({
    name: 'obsidian-markdown',
    title: 'Obsidian Markdown',
    description: 'Obsidian-flavored Markdown reference: wikilinks, embeds, callouts, properties, math.',
    whenToUse: 'Whenever editing .md files in the vault — provides syntax rules the model must follow.',
    body: SKILL_OBSIDIAN_MARKDOWN,
  });

  registerBundledSkill({
    name: 'obsidian-canvas',
    title: 'Obsidian Canvas',
    description: 'JSON Canvas 1.0 spec: nodes, edges, groups. For visual mind-maps and flowcharts.',
    whenToUse: 'When editing a .canvas file. Auto-activates on canvas file open.',
    paths: ['*.canvas', '**/*.canvas'],
    body: SKILL_OBSIDIAN_CANVAS,
    // Extracted to .glossa/bundled-skills/obsidian-canvas/ on first invocation.
    // The skill body's ${SKILL_DIR}/example.canvas reference resolves here.
    files: {
      'example.canvas': EXAMPLE_CANVAS,
    },
  });

  registerBundledSkill({
    name: 'obsidian-bases',
    title: 'Obsidian Bases',
    description: 'Bases YAML format: views, filters, formulas, summaries. Vault-native database files.',
    whenToUse: 'When editing a .base file. Auto-activates on .base file open.',
    paths: ['*.base', '**/*.base'],
    body: SKILL_OBSIDIAN_BASES,
  });
}
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-duplicate-type-constituents, @typescript-eslint/only-throw-error, @typescript-eslint/no-unused-vars -- Re-enable review lint rules after dynamic boundary module. */
