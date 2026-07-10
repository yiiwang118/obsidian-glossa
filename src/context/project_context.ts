
import { App, TFile } from 'obsidian';

/**
 * Hierarchical project-context loader — mirrors upstream Claude Code's CLAUDE.md /
 * AGENTS.md discovery. Walks from the vault root down through every ancestor folder
 * of the currently active file, picking up any of the canonical context filenames at
 * each level. Deeper files take precedence: they appear LATER in the concatenated
 * output, so when the model reads top-down the local file's instructions naturally
 * override the project-level ones.
 *
 * Canonical filenames (any of):
 *   AGENTS.md, CLAUDE.md, .codex.md, NOTE_CODEX.md
 *
 * Returns an empty string when no context files exist anywhere on the ancestry chain.
 */
const CONTEXT_FILENAMES = ['AGENTS.md', 'CLAUDE.md', '.codex.md', 'NOTE_CODEX.md'];

export interface ContextFileEntry {
  path: string;       // Vault-relative path
  text: string;
  depth: number;      // 0 = vault root, 1 = top-level folder, ...
}

/** Returns the ordered list of context files visible from the active file's directory.
 *  Useful for both prompt construction and UI diagnostics ("which files are loaded?"). */
export async function discoverContextFiles(app: App): Promise<ContextFileEntry[]> {
  const af = app.workspace.getActiveFile();
  const folderPath = af ? af.parent?.path ?? '' : '';
  const segments = folderPath ? folderPath.split('/').filter(Boolean) : [];

  // Build the ancestry: root → each folder down to (and including) the active file's folder
  const folders: { path: string; depth: number }[] = [{ path: '', depth: 0 }];
  let cur = '';
  for (let i = 0; i < segments.length; i++) {
    cur = cur ? `${cur}/${segments[i]}` : segments[i];
    folders.push({ path: cur, depth: i + 1 });
  }

  const seen = new Set<string>();
  const out: ContextFileEntry[] = [];
  for (const { path: folder, depth } of folders) {
    for (const name of CONTEXT_FILENAMES) {
      const p = folder ? `${folder}/${name}` : name;
      if (seen.has(p)) continue;
      seen.add(p);
      const f = app.vault.getAbstractFileByPath(p);
      if (f instanceof TFile) {
        try {
          const text = await app.vault.cachedRead(f);
          if (text.trim()) out.push({ path: p, text, depth });
        } catch { /* ignore */ }
      }
    }
  }
  return out;
}

/** Render the discovered context files into a single string for system-prompt injection.
 *  Order: shallowest first → deepest last (so deeper instructions appear later and naturally
 *  override earlier ones when the model reads sequentially). */
export async function loadProjectContext(app: App): Promise<string> {
  const entries = await discoverContextFiles(app);
  if (entries.length === 0) return '';

  const sections: string[] = [];
  if (entries.length > 1) {
    sections.push(
      `_${entries.length} project-context files loaded from the vault hierarchy. ` +
      `Files appear in order of increasing locality — when statements conflict, ` +
      `the LATER (more deeply nested) file wins._`
    );
  }
  for (const e of entries) {
    const tag = e.depth === 0 ? 'vault root' : `folder depth ${e.depth}`;
    sections.push(`### ${e.path}  (${tag})\n\n${e.text}`);
  }
  return sections.join('\n\n');
}
