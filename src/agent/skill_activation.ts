
/**
 * Session-scoped activation state for skills with `paths` frontmatter.
 *
 * A skill with `paths: ["*.canvas", "Papers/**"]` is "conditional": it lives
 * on disk but does NOT appear in the skill listing nor become callable until a
 * file matching one of those patterns is touched in this session. Once
 * activated, it stays available until session reset.
 *
 * Mirrors upstream Claude Code's `activateConditionalSkillsForPaths`. The
 * matching is gitignore-style (segment-level glob), so patterns can target
 * folders (`Papers/**`) or extensions (`*.canvas`).
 *
 * Activation triggers (wired in main.ts):
 *  - `app.workspace.on('file-open', f)` → run check for f.path
 *  - `app.vault.on('modify', f)`        → run check for f.path
 *  - explicit tool calls with a path field (file_edit, read_note, etc.) also
 *    trigger via the agent loop's `pathsTouchedByTool` integration.
 */

import { discoverNestedSkillDirs, discoverSkills, type Skill } from './skills';
import type { App } from 'obsidian';

/** Names of skills that have been activated this session. */
const activated = new Set<string>();

/** Listeners notified when the active set changes — so SkillTool's prompt
 *  injector knows to refresh. Each listener fires AT MOST once per call. */
const listeners = new Set<() => void>();

export function onActivationChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notify() {
  for (const cb of listeners) {
    try { cb(); } catch (e) { console.warn('[skill_activation] listener threw', e); }
  }
}

export function activeSkillNames(): ReadonlySet<string> {
  return activated;
}

export function clearActivation(): void {
  activated.clear();
  notify();
}

/** Match one skill `paths` pattern against a vault-relative path. Supports:
 *   - `*.ext`              → matches files with that extension (any depth)
 *   - `Folder/**`          → matches anything under Folder/
 *   - `Folder/*.canvas`    → segment-level glob
 *   - `**\/Foo.md`         → matches Foo.md at any depth */
function pathMatchesPattern(pattern: string, path: string): boolean {
  // Strip trailing slash for normalisation.
  const pat = pattern.replace(/\/+$/, '');
  const p = path.replace(/^\/+/, '');
  // Convert glob to regex.
  let rx = '^';
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i];
    if (c === '*' && pat[i + 1] === '*') {
      // ** — match any number of path segments (including zero).
      // Followed by / → consume the slash too so `Papers/**` matches `Papers/Foo.md`.
      if (pat[i + 2] === '/') { rx += '(?:.*/)?'; i += 2; }
      else { rx += '.*'; i++; }
    } else if (c === '*') {
      rx += '[^/]*';
    } else if (c === '?') {
      rx += '[^/]';
    } else if ('.+^${}()|[]\\'.includes(c)) {
      rx += '\\' + c;
    } else {
      rx += c;
    }
  }
  rx += '$';
  // Two flavors: pattern with no slashes → match the basename anywhere.
  if (!pat.includes('/')) {
    return new RegExp(rx).test(p.split('/').pop() ?? p);
  }
  return new RegExp(rx).test(p);
}

/** Activate any conditional skill whose patterns match the given path. Returns
 *  the list of newly-activated skill names. Bundled and disk skills are both
 *  considered. */
export async function activateForPath(app: App, filePath: string): Promise<string[]> {
  if (!filePath) return [];
  // Walk parent dirs to discover nested skill folders (cheap; cached on success).
  discoverNestedSkillDirs(app, filePath);

  const all = await discoverSkills(app);
  const newly: string[] = [];
  for (const skill of all) {
    if (!skill.paths || skill.paths.length === 0) continue;
    if (activated.has(skill.name)) continue;
    if (skill.paths.some(pat => pathMatchesPattern(pat, filePath))) {
      activated.add(skill.name);
      newly.push(skill.name);
    }
  }
  if (newly.length > 0) notify();
  return newly;
}

/** Manual activation (e.g. user clicked a "use this skill" button). */
export function activateByName(name: string): void {
  if (activated.has(name)) return;
  activated.add(name);
  notify();
}

/** Returns true if `skill` would appear in the model's skill listing right now
 *  (i.e. unconditional or already-activated, and not user-only). */
export function isSkillVisible(skill: Skill): boolean {
  if (skill.disableModelInvocation) return false;
  if (skill.paths && skill.paths.length > 0 && !activated.has(skill.name)) return false;
  return true;
}
