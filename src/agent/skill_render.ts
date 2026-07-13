
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
import type { Skill } from './skills';

/** Path under the vault where bundled skill files are extracted. We do NOT
 *  write into `.glossa/skills/<name>` for bundled skills (that root is
 *  user-owned); instead use `.glossa/bundled-skills/<name>`. */
function bundledSkillDir(name: string): string {
  return `.glossa/bundled-skills/${name}`;
}

function safeSkillRelativePath(input: string): string | null {
  const raw = input.trim();
  if (!raw || raw.includes('\0') || raw.startsWith('/') || raw.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(raw)) return null;
  const normalized = raw.replace(/\\/g, '/');
  const segments = normalized.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) return null;
  return normalized;
}

/** Extract a bundled skill's `files{}` to disk under the bundled-skill dir.
 *  Idempotent — skips files that already exist. Returns the dir path. */
async function ensureBundledFilesExtracted(app: App, skill: Skill): Promise<string> {
  const dir = bundledSkillDir(skill.name);
  const files = skill.files;
  if (!files || Object.keys(files).length === 0) return dir;
  const adapter = app.vault.adapter;
  await ensureAdapterDir(adapter, dir);
  for (const [rel, content] of Object.entries(files)) {
    const normalized = safeSkillRelativePath(rel);
    if (!normalized) {
      console.warn(`[skill_render] refusing to write traversal path: ${rel}`);
      continue;
    }
    const target = `${dir}/${normalized}`;
    const parent = target.substring(0, target.lastIndexOf('/'));
    if (parent) await ensureAdapterDir(adapter, parent);
    if (await adapter.exists(target)) continue; // idempotent
    try {
      await adapter.write(target, content);
    } catch (e) {
      console.warn(`[skill_render] failed to extract ${target}`, e);
    }
  }
  return dir;
}

async function ensureAdapterDir(adapter: App['vault']['adapter'], path: string): Promise<void> {
  const parts = path.split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!(await adapter.exists(current))) await adapter.mkdir(current);
  }
}

/** Compute the directory path the skill's `${SKILL_DIR}` should resolve to. */
function skillDirFor(skill: Skill): string {
  // Bundled skills use the (deterministic) extraction dir.
  if (skill.source === 'bundled') return bundledSkillDir(skill.name);
  // Skill paths are vault-relative and always use forward slashes.
  const separator = skill.path.lastIndexOf('/');
  return separator > 0 ? skill.path.slice(0, separator) : '';
}

/** Render the skill body with substitutions applied. */
export async function renderSkillBody(app: App, skill: Skill, args: string): Promise<string> {
  // For bundled skills, lazily extract files on first invocation.
  if (skill.source === 'bundled' && skill.files && Object.keys(skill.files).length > 0) {
    await ensureBundledFilesExtracted(app, skill);
  }
  const skillDir = skillDirFor(skill);

  // Substitution table. Order: SKILL_DIR first (likely to be referenced as
  // part of file paths in template strings), then args.
  const needsDirectoryHint = Boolean(skill.files && Object.keys(skill.files).length > 0)
    || /\$(?:\{(?:CLAUDE_)?SKILL_DIR\}|(?:CLAUDE_)?SKILL_DIR\b)/.test(skill.body);
  let body = skill.body.slice(0, 80_000);
  if (skill.body.length > body.length) {
    body += '\n\n[Skill body truncated at 80,000 characters. Keep SKILL.md focused.]';
  }
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
  return needsDirectoryHint ? `Base directory for this skill: ${skillDir}\n\n${body}` : body;
}
