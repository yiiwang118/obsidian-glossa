/** Built-in, task-focused playbooks registered when the plugin starts. */
import { clearBundledSkills, registerBundledSkill } from './skills';
export { getBundledSkills } from './skills';

const SKILL_OBSIDIAN_MARKDOWN = `
# Goal

Create or edit Markdown that remains valid, readable, and native to the vault.

# Workflow

1. Inspect the existing note before changing structure or properties.
2. Preserve its heading depth, list style, frontmatter conventions, link style, and language.
3. Use the narrowest edit tool: \`patch_note\` for a section/property, \`file_edit\` for one exact replacement, and \`apply_patch\` for multiple hunks.
4. Re-read the affected region when an edit changes links, YAML, code fences, or math.

# Syntax

- Internal link: \`[[Note]]\`, \`[[Note#Heading]]\`, \`[[Note^block-id]]\`, \`[[Note|Alias]]\`.
- Embed: \`![[Note]]\`, \`![[Image.png]]\`, or \`![[Document.pdf#page=4]]\`.
- Callout: \`> [!note] Title\`; append \`-\` after the type for collapsed-by-default.
- Properties: YAML only at the top of the file between \`---\` delimiters. Preserve existing key types.
- Math: \`$...$\` inline and \`$$...$$\` on separate lines for display math. Do not use \`\\(...\\)\` or \`\\[...\\]\`.
- Tags: \`#tag\` inline or a \`tags\` property. Do not add both forms unless the note already uses both.
- Hidden comment: \`%%...%%\`. Block references use a terminal \`^id\`.

# Guardrails

- Do not rewrite a whole note for a local change.
- Do not alter frontmatter, formulas, code, citations, or link targets outside the requested scope.
- Do not paste replacement note content into chat when a write tool is available.

# Done when

The requested change is present, surrounding Markdown is still balanced, and the final response names the affected vault path.
`.trim();

const SKILL_OBSIDIAN_CANVAS = `
# Goal

Read or modify a JSON Canvas 1.0 file without breaking node identity, edges, or layout.

# Workflow

1. Call \`read_canvas\` first. Build an inventory of node IDs, node types, edge endpoints, and the current coordinate range.
2. Make the smallest operation with \`patch_canvas\`. Keep existing IDs stable; generate a new unique ID only for a new node or edge.
3. Place new nodes relative to nearby content. Keep useful spacing and avoid exact overlap. The y-axis increases downward.
4. Re-read the canvas and verify counts, IDs, and edge endpoints after editing.

# Format constraints

- Top level: \`nodes\` and \`edges\` arrays.
- Every node needs \`id\`, \`type\`, integer \`x\`, \`y\`, \`width\`, and \`height\`.
- Node types are \`text\`, \`file\`, \`link\`, and \`group\`; each needs its type-specific field.
- Every edge needs unique \`id\`, \`fromNode\`, and \`toNode\`. Sides, endpoint shapes, labels, and colors are optional.
- Never leave an edge pointing to a removed or unknown node.

# Guardrails

- Prefer the dedicated Canvas tools over generic note writers.
- Do not reorder or relayout unrelated nodes.
- If the requested bulk transformation exceeds \`patch_canvas\`, explain the limitation instead of silently replacing the full JSON.

# Done when

The canvas parses, all IDs are unique, every edge endpoint exists, and a verification read reflects the intended change.
`.trim();

const SKILL_OBSIDIAN_BASES = `
# Goal

Edit a \`.base\` definition while preserving its existing YAML shape and view behavior.

# Workflow

1. Read the complete file and infer conventions from the file itself before introducing keys or expressions.
2. Identify the narrow target: source filters, displayed properties, formulas, summaries, sorting/grouping, or one named view.
3. Use \`file_edit\` for one exact change or \`apply_patch\` for coordinated YAML edits.
4. Re-read the edited file. Check indentation, list/mapping shape, quoting, and references between formulas and views.

# Guardrails

- Treat the current file as the schema source of truth; Bases syntax evolves, so do not invent unsupported keys from memory.
- Preserve unrelated views and user ordering.
- Keep expressions as strings when the surrounding file quotes expressions.
- Never edit note frontmatter when the requested target is the \`.base\` configuration itself.

# Done when

The YAML structure remains coherent, the named view/filter/formula change is present, and the final response identifies the edited file.
`.trim();

const SKILL_PDF_ANALYSIS = `
# Goal

Answer the user's PDF task with page-grounded evidence while reading the minimum necessary content.

# Workflow

1. Respect the explicit attachment or named path. Do not substitute the merely open PDF for a different requested paper.
2. Choose one \`read_pdf\` task: \`inspect\` for identity/rename, \`summarize\` for the document arc, \`search\` for a concept, \`pages\` for a known range, or \`visual\` for figures, formulas, tables, and scans.
3. Start narrow. Expand page ranges only when evidence is incomplete.
4. Distinguish extracted text from visual evidence. Preserve page numbers and state when OCR or a missing text layer limits confidence.
5. For academic papers, keep title, authors, method, evidence, limitations, and claims separate. Never infer a result from the abstract alone when the relevant pages are available.

# Guardrails

- Do not read the whole PDF when a targeted page range answers the question.
- Do not flatten formulas, tables, or charts into unsupported prose.
- Do not claim a citation or page location that the tool did not return.

# Done when

The answer addresses the requested task, cites relevant page numbers when available, and clearly marks any extraction uncertainty.
`.trim();

const SKILL_IMAGE_ANALYSIS = `
# Goal

Inspect an image with evidence appropriate to the task instead of relying on a generic whole-image description.

# Workflow

1. Confirm the requested image path and inspect the full image first when spatial context matters.
2. Choose \`view_image\` mode: \`describe\` for content, \`ocr\` for text, \`ui\` for interface defects, \`chart\` for plots, \`detail\` for a crop, or \`color\` for pixel samples.
3. Use a source-pixel \`region\` for small text or local defects. Use \`sample_points\` only when exact colors matter.
4. Separate visible evidence from interpretation. If a crop loses context, inspect the full image or say so.

# Guardrails

- Do not guess text that is unreadable at the current resolution.
- Do not report exact colors from visual impression when pixel sampling is available.
- \`view_image\` inspects pixels; it does not edit them.

# Done when

The response answers the visual question, identifies the inspected region when cropped, and avoids claims beyond the observed pixels.
`.trim();

const SKILL_CREATOR = `
# Goal

Create or improve a focused Glossa Skill that triggers reliably, spends little context, and is safe to execute in the vault.

# Workflow

1. Collect 2-4 representative user requests and at least one nearby request that should not trigger the Skill.
2. Choose the freedom level: concise heuristics for variable work, structured defaults for a preferred pattern, or strict steps for fragile operations.
3. Create \`.glossa/skills/<name>/SKILL.md\`. For a new file load \`create_note\`; for an existing file read it and make the narrowest edit.
4. Put discovery information in frontmatter and execution information in the body. Keep examples only when they resolve genuine ambiguity.
5. Call \`validate_skill\`, fix every error, and review warnings against the intended trigger boundary.

# Required contract

- \`name\`: lowercase kebab-case, 1-64 characters, matching the containing folder.
- \`description\`: what the Skill does. Add \`when_to_use\`, \`triggers\`, or \`paths\` with concrete activation cues.
- \`required-tools\`: only specialized tools the workflow actually needs loaded.
- Body: \`# Goal\`, executable \`# Workflow\`, task-specific \`# Guardrails\`, and observable \`# Done when\` criteria.
- Keep the body progressively disclosed: assume the model knows general facts and include only procedure, local conventions, edge cases, and verification it cannot infer reliably.

# Guardrails

- Do not embed API keys, passwords, personal identifiers, or machine-specific absolute paths.
- Do not grant tools via \`allowed-tools\` merely to avoid approvals.
- Do not combine unrelated jobs into one broad Skill or duplicate a built-in Skill with superficial wording changes.
- Prefer vault APIs and existing tools; never instruct use of shell or system filesystem access.

# Done when

The Skill has a narrow trigger boundary, a complete workflow, no validation errors, justified warnings only, and succeeds on the representative requests without triggering on the negative example.
`.trim();

export function initBundledSkills(): void {
  clearBundledSkills();

  registerBundledSkill({
    name: 'obsidian-markdown',
    title: 'Obsidian Markdown',
    description: 'Write vault-native Markdown while preserving links, properties, math, callouts, and local structure.',
    whenToUse: 'Use for edits involving vault-specific Markdown syntax; skip plain prose changes.',
    triggers: ['wikilink', 'embed', 'callout', 'frontmatter', 'property', 'math', 'tag'],
    requiredTools: ['patch_note'],
    body: SKILL_OBSIDIAN_MARKDOWN,
  });

  registerBundledSkill({
    name: 'obsidian-canvas',
    title: 'Obsidian Canvas',
    description: 'Inspect and edit JSON Canvas nodes, edges, IDs, and spatial layout safely.',
    whenToUse: 'Use when the target is a .canvas file or the user asks to modify a Canvas graph.',
    triggers: ['canvas', 'mind map', 'flowchart', 'node', 'edge'],
    paths: ['*.canvas', '**/*.canvas'],
    requiredTools: ['read_canvas', 'patch_canvas'],
    body: SKILL_OBSIDIAN_CANVAS,
  });

  registerBundledSkill({
    name: 'obsidian-bases',
    title: 'Obsidian Bases',
    description: 'Edit Bases YAML filters, properties, formulas, summaries, and views without disturbing unrelated configuration.',
    whenToUse: 'Use only when reading or editing a .base file.',
    triggers: ['base', 'database view', 'filter', 'formula', 'summary'],
    paths: ['*.base', '**/*.base'],
    body: SKILL_OBSIDIAN_BASES,
  });

  registerBundledSkill({
    name: 'pdf-analysis',
    title: 'PDF Analysis',
    description: 'Read papers, reports, books, scans, formulas, and figures with task-aware page selection and evidence.',
    whenToUse: 'Use for non-trivial inspection, search, summarization, or analysis of a PDF.',
    triggers: ['pdf', 'paper', 'report', 'book', 'scan', 'figure'],
    paths: ['*.pdf', '**/*.pdf'],
    requiredTools: ['read_pdf'],
    body: SKILL_PDF_ANALYSIS,
  });

  registerBundledSkill({
    name: 'image-analysis',
    title: 'Image Analysis',
    description: 'Inspect screenshots, figures, charts, OCR text, crops, and exact pixel colors with grounded visual evidence.',
    whenToUse: 'Use for detailed questions about an image file, screenshot, chart, or figure.',
    triggers: ['image', 'screenshot', 'ocr', 'chart', 'crop', 'pixel', 'color'],
    paths: ['*.png', '*.jpg', '*.jpeg', '*.gif', '*.webp', '**/*.png', '**/*.jpg', '**/*.jpeg', '**/*.gif', '**/*.webp'],
    requiredTools: ['view_image'],
    body: SKILL_IMAGE_ANALYSIS,
  });

  registerBundledSkill({
    name: 'skill-creator',
    title: 'Skill Creator',
    description: 'Create, update, and audit focused vault Skills with reliable triggers, concise workflows, safe tool declarations, and verification criteria.',
    whenToUse: 'Use when the user asks to create a Skill, revise SKILL.md, improve Skill triggering, or audit Skill quality.',
    triggers: ['create skill', 'SKILL.md', 'skill trigger', 'skill workflow', '技能', '创建技能'],
    requiredTools: ['validate_skill', 'create_note'],
    body: SKILL_CREATOR,
  });
}
