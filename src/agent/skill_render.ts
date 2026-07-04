/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-duplicate-type-constituents, @typescript-eslint/only-throw-error, @typescript-eslint/no-unused-vars -- Dynamic plugin and host-app boundaries validate these values at runtime. */
/**
 * Render a skill's body for injection into the conversation.
 *
 * Responsibilities:
 *   1. Resolve `${SKILL_DIR}` to the skill's own directory so the body can
 *      reference sibling files (e.g. `${SKILL_DIR}/example-canvas.json`).
 *   2. Resolve `${ARGUMENTS}` / `$ARGUMENTS` to the user-passed args string.
 *   3. For bundled skills with `files{}`, ensure those sibling files have
 *      been extracted to the skill dir on first invocation.
 *
 * Returns the rendered body. The caller wraps it with title/metadata.
 */
import type { App } from 'obsidian';
import { dirname } from 'path';
import type { Skill } from './skills';

/** Path under the vault where bundled skill files are extracted. We do NOT
 *  write into `.glossa/skills/<name>` for bundled skills (that root is
 *  user-owned); instead use `.glossa/bundled-skills/<name>`. */
function bundledSkillDir(name: string): string {
  return `.glossa/bundled-skills/${name}`;
}

/** Extract a bundled skill's `files{}` to disk under the bundled-skill dir.
 *  Idempotent — skips files that already exist. Returns the dir path. */
async function ensureBundledFilesExtracted(app: App, skill: Skill): Promise<string> {
  const dir = bundledSkillDir(skill.name);
  const files = skill.files;
  if (!files || Object.keys(files).length === 0) return dir;
  const adapter = app.vault.adapter;
  // Ensure dir + parent chain.
  if (!(await adapter.exists('.glossa'))) await adapter.mkdir('.glossa');
  if (!(await adapter.exists('.glossa/bundled-skills'))) await adapter.mkdir('.glossa/bundled-skills');
  if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
  for (const [rel, content] of Object.entries(files)) {
    // Reject traversal-bearing relative paths.
    const normalized = rel.replace(/^\/+/, '');
    if (normalized.split('/').includes('..')) {
      console.warn(`[skill_render] refusing to write traversal path: ${rel}`);
      continue;
    }
    const target = `${dir}/${normalized}`;
    const parent = target.substring(0, target.lastIndexOf('/'));
    if (parent && !(await adapter.exists(parent))) {
      await adapter.mkdir(parent);
    }
    if (await adapter.exists(target)) continue; // idempotent
    try {
      await adapter.write(target, content);
    } catch (e) {
      console.warn(`[skill_render] failed to extract ${target}`, e);
    }
  }
  return dir;
}

/** Compute the directory path the skill's `${SKILL_DIR}` should resolve to. */
function skillDirFor(app: App, skill: Skill): string {
  // Bundled skills use the (deterministic) extraction dir.
  if (skill.source === 'bundled') return bundledSkillDir(skill.name);
  // Disk skills: dirname of the SKILL.md path.
  return dirname(skill.path);
}

/** Render the skill body with substitutions applied. */
export async function renderSkillBody(app: App, skill: Skill, args: string): Promise<string> {
  // For bundled skills, lazily extract files on first invocation.
  if (skill.source === 'bundled' && skill.files && Object.keys(skill.files).length > 0) {
    await ensureBundledFilesExtracted(app, skill);
  }
  const skillDir = skillDirFor(app, skill);

  // Substitution table. Order: SKILL_DIR first (likely to be referenced as
  // part of file paths in template strings), then args.
  let body = skill.body;
  // ${SKILL_DIR}, $SKILL_DIR
  body = body.replace(/\$\{SKILL_DIR\}/g, skillDir);
  body = body.replace(/\$SKILL_DIR\b/g, skillDir);
  // ${CLAUDE_SKILL_DIR} — upstream compat alias.
  body = body.replace(/\$\{CLAUDE_SKILL_DIR\}/g, skillDir);
  // ${ARGUMENTS}, $ARGUMENTS — user-passed args.
  body = body.replace(/\$\{ARGUMENTS\}/g, args);
  body = body.replace(/\$ARGUMENTS\b/g, args);

  // Prepend a "Base directory" hint so the model knows where to look for
  // sibling files referenced by the body.
  const prefix = `Base directory for this skill: ${skillDir}\n\n`;
  return prefix + body;
}
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-duplicate-type-constituents, @typescript-eslint/only-throw-error, @typescript-eslint/no-unused-vars */
