import type { SlashCommand } from '../types';

export const BUILTIN_SLASH_COMMANDS: SlashCommand[] = [
  {
    id: 'translate', trigger: '/translate', title: 'Translate',
    description: 'Translate selection (or current note). Tip: select text and press Enter twice.',
    template: `Translate the following into ${'${args:Chinese}'}. Preserve markdown structure, code blocks, and math. Keep proper nouns in their original language.\n\n${'${selection-or-file}'}`,
  },
  {
    id: 'summarize', trigger: '/summarize', title: 'Summarize',
    description: 'Concise summary of the selection or current note.',
    template: `Summarize the following in 5–8 bullet points. Be concrete; cite specific terms.\n\n${'${selection-or-file}'}`,
  },
  {
    id: 'improve', trigger: '/improve', title: 'Improve writing',
    description: 'Rewrite for clarity and flow, preserving meaning.',
    template: `Rewrite the following for clarity, concision, and flow. Preserve the meaning and any technical claims. Keep markdown intact.\n\n${'${selection-or-file}'}`,
  },
  {
    id: 'explain', trigger: '/explain', title: 'Explain',
    description: 'Plain-English explanation of the selection.',
    template: `Explain the following in plain language for someone with general technical background. Use a short concrete example if helpful.\n\n${'${selection-or-file}'}`,
  },
  {
    id: 'critique', trigger: '/critique', title: 'Critique',
    description: 'Reviewer-style critical assessment.',
    template: `You are a tough but constructive reviewer. Give 3 strongest points and 5 weaknesses of the following, in bullet form. Be specific.\n\n${'${selection-or-file}'}`,
  },
  {
    id: 'expand', trigger: '/expand', title: 'Expand outline',
    description: 'Turn an outline / sketch into a fuller draft.',
    template: `Expand the following outline into a full draft. Match the style of the surrounding context. Add detail and examples without making things up.\n\n${'${selection-or-file}'}`,
  },
  {
    id: 'diagram', trigger: '/diagram', title: 'Mermaid diagram',
    description: 'Generate a Mermaid diagram from the selection.',
    template: `Convert the following into a Mermaid diagram. Pick the diagram type that fits best (flowchart, sequence, class, ER, etc.). Output ONLY the mermaid code block.\n\n${'${selection-or-file}'}`,
  },
  {
    id: 'cite', trigger: '/cite', title: 'Find citations',
    description: 'Suggest 3–5 relevant citations for the claim.',
    template: `For the following statement, suggest 3–5 relevant academic citations. Format: "Author et al. (Year). Title. Venue." Mark each as [verified] or [unverified].\n\n${'${selection-or-file}'}`,
  },
  {
    id: 'define', trigger: '/define', title: 'Add glossary entry',
    description: 'Generate a glossary entry for the selected term.',
    template: `Write a precise glossary entry for the term "${'${selection}'}" suitable for a graduate-level technical reader. Include: 1) one-sentence definition, 2) where it appears, 3) common confusions.`,
  },
  {
    id: 'continue', trigger: '/continue', title: 'Continue writing',
    description: 'Continue from current cursor.',
    template: `Continue writing from where the current text leaves off, matching its style and tone. Keep markdown intact.\n\n${'${selection-or-file}'}`,
  },
  {
    id: 'toc', trigger: '/toc', title: 'Table of contents',
    description: 'Generate TOC for current note.',
    template: `Generate a table of contents (markdown list with depth ≤ 3) for the following note. Use the existing headings.\n\n${'${file}'}`,
  },
  {
    id: 'tldr', trigger: '/tldr', title: 'One-sentence TL;DR',
    description: 'A single-sentence summary.',
    template: `Give a single-sentence TL;DR of the following.\n\n${'${selection-or-file}'}`,
  },
  {
    id: 'skill', trigger: '/skill', title: 'Run skill',
    description: 'Invoke a vault skill by name. Pass the skill name as the arg (e.g. /skill obsidian-canvas). Optional second arg becomes the skill\'s $ARGUMENTS.',
    // Strategy: emit a system-reminder telling the model to call the `skill`
    // tool with the user-supplied name. We can't directly trigger a tool from
    // a slash template — but a strong directive ensures the model does.
    template: `Use the \`skill\` tool to invoke the skill named "${'${args}'}". Pass the skill body's instructions through; if it has \`$ARGUMENTS\` placeholders, leave them as-is — the user provided no extra arguments. Selection / current-file context:\n\n${'${selection-or-file}'}`,
  },
];

/** Resolve template placeholders against the current editing context. */
export function applySlashTemplate(opts: {
  template: string;
  selection: string;
  fileContent: string;
  fileName: string;
  args?: string;
  vaultName: string;
}): string {
  const selectionOrFile = opts.selection || opts.fileContent;
  return opts.template
    .replace(/\$\{selection\}/g, opts.selection || '')
    .replace(/\$\{file\}/g, opts.fileContent || '')
    .replace(/\$\{filename\}/g, opts.fileName || '')
    .replace(/\$\{selection-or-file\}/g, selectionOrFile || '')
    .replace(/\$\{vault\}/g, opts.vaultName)
    .replace(/\$\{args(?::([^}]+))?\}/g, (_, def) => opts.args || def || '');
}
