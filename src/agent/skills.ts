/**
 * Skills system — vault-stored prompt skills the model can discover and invoke.
 * Mirrors upstream Claude Code's SkillTool. Each skill lives at
 *   .glossa/skills/<name>/SKILL.md          (preferred)
 *   .note-codex/skills/<name>/SKILL.md      (legacy, still discovered)
 * with frontmatter and a body. Models call the unified `skill` tool to invoke.
 *
 * We scan both roots so users who created skills under the old plugin name
 * (note-codex) don't lose them when the bundle renames to Glossa.
 */
import type { App } from 'obsidian';
import { TFile as TFileCls, TFolder } from 'obsidian';

/** Source of a skill — drives precedence (managed > user > project > legacy > bundled). */
export type SkillSource = 'project' | 'project-nested' | 'legacy' | 'user' | 'bundled';

export interface Skill {
  /** Folder name (kebab-case, no spaces). */
  name: string;
  /** Human title (frontmatter `title:`) — falls back to folder name. */
  title: string;
  /** One-line description for the discovery list. */
  description: string;
  /** Optional triggers — phrases that hint when to use this skill. */
  triggers?: string[];
  /** When-to-use clause appended to description in the skill listing. Helps the
   *  model decide WHEN to invoke. From frontmatter `when_to_use:` / `whenToUse:`. */
  whenToUse?: string;
  /** Path patterns (gitignore-style, e.g. `*.canvas`, `Papers/**`) — when set,
   *  this skill is CONDITIONAL: it only activates after a file matching one of
   *  these patterns is touched in the session. From frontmatter `paths:`. */
  paths?: string[];
  /** Tool names allowlisted to run without per-call approval WHILE this skill
   *  is active. From frontmatter `allowed-tools:` / `allowedTools:`. */
  allowedTools?: string[];
  /** Execution mode: 'inline' (default) injects body into the active context;
   *  'fork' runs the skill in an isolated sub-agent with its own token budget.
   *  From frontmatter `context:`. */
  context?: 'inline' | 'fork';
  /** Per-skill model override. From frontmatter `model:`. */
  model?: string;
  /** Optional hint shown to the user beside `args` input. From `argument-hint:`. */
  argumentHint?: string;
  /** When false, the skill can only be invoked by the user (e.g. via slash command UI),
   *  not by the model. From `user-invocable:`. */
  userInvocable?: boolean;
  /** When true, the model cannot invoke this skill at all (excluded from listing).
   *  From `disable-model-invocation:`. */
  disableModelInvocation?: boolean;
  /** Bundled-skill extra files extracted to the skill dir on first invocation.
   *  Keys are skill-relative paths (forward slashes, no `..`). Only set on
   *  bundled (in-memory) skills — disk skills carry their own sibling files. */
  files?: Record<string, string>;
  /** Where the SKILL.md lives (or virtual path for bundled skills). */
  path: string;
  /** Source classification — drives precedence + UI labeling. */
  source: SkillSource;
  /** Full markdown body (after frontmatter). Injected when the skill runs. */
  body: string;
}

/** Disk skill roots searched in order. First hit wins per skill folder name
 *  (within the project sources). `~/.glossa/skills/` (user-global) is loaded
 *  separately by loadUserSkills() — it lives outside the vault. */
const PROJECT_SKILL_ROOTS: Array<{ root: string; source: SkillSource }> = [
  { root: '.glossa/skills', source: 'project' },
  { root: '.note-codex/skills', source: 'legacy' },
];

/** Parse a YAML-ish array literal like `[a, "b c", 'don''t', 4]`. We don't
 *  pull in a YAML library for this — the prior code did a naive
 *  `val.replace(/'/g, '"')` and called JSON.parse, which corrupted any string
 *  containing a literal single quote (e.g. "don't" → `don"t"` → parse error
 *  with characters silently dropped). */
function parseInlineArray(raw: string): string[] {
  // Strip the brackets, then split at commas that aren't inside quotes.
  const inner = raw.slice(1, -1);
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (quote) {
      if (c === quote) { quote = null; continue; }
      cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === ',') {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  if (cur.trim().length || out.length) out.push(cur.trim());
  return out.filter(s => s.length);
}

/** Parse a frontmatter value into the most useful runtime type. Handles:
 *  - inline arrays `[a, b, "c d"]`
 *  - quoted strings `"x"` / `'x'`
 *  - booleans `true` / `false` / `yes` / `no`
 *  - bare strings (returned as-is). */
function parseScalar(raw: string): any {
  const val = raw.trim();
  if (val.startsWith('[') && val.endsWith(']')) return parseInlineArray(val);
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    return val.slice(1, -1);
  }
  const lower = val.toLowerCase();
  if (lower === 'true' || lower === 'yes' || lower === 'on') return true;
  if (lower === 'false' || lower === 'no' || lower === 'off') return false;
  return val;
}

/** Coerce a frontmatter value (which might be a string OR an inline array) to a
 *  string[]. Returns undefined when the field is absent or empty. */
function asStringArray(v: unknown): string[] | undefined {
  if (Array.isArray(v)) return v.map(String).filter(s => s.length > 0);
  if (typeof v === 'string' && v.length > 0) return [v];
  return undefined;
}

/** Coerce to boolean — accepts boolean literal, "true"/"false"/"yes"/"no", etc. */
function asBoolean(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true' || s === 'yes' || s === 'on' || s === '1') return true;
    if (s === 'false' || s === 'no' || s === 'off' || s === '0') return false;
  }
  return undefined;
}

/** Parse simple frontmatter (--- delimited) into { meta, body }.
 *  Supports both inline `key: [a, b]` arrays AND block-style YAML lists:
 *      paths:
 *        - "*.canvas"
 *        - Papers/**
 *  block-style continues until the next non-indented line.
 *
 *  Tolerates a leading UTF-8 BOM (some editors silently add one to
 *  saved files) and Windows CRLF line endings — both would otherwise cause
 *  the opening `---` not to match, and the entire SKILL.md would be treated
 *  as having no frontmatter. */
function parseFrontmatter(text: string): { meta: Record<string, any>; body: string } {
  // Strip BOM if present, then normalise CRLF → LF for the regex test.
  // We keep the original line endings inside `body` because that's what the
  // skill body cares about for code-block fidelity; only the frontmatter
  // header lines need LF for our parsing.
  const stripped = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
  const m = stripped.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) return { meta: {}, body: stripped };
  const meta: Record<string, any> = {};
  const lines = m[1].replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1].trim();
    const raw = kv[2];
    // Block-style YAML list: empty value followed by indented `- item` lines.
    if (raw.trim() === '' && i + 1 < lines.length && /^\s+-\s+/.test(lines[i + 1])) {
      const items: string[] = [];
      while (i + 1 < lines.length && /^\s+-\s+/.test(lines[i + 1])) {
        i += 1;
        const m2 = lines[i].match(/^\s+-\s+(.*)$/);
        if (m2) {
          const v = parseScalar(m2[1]);
          items.push(typeof v === 'string' ? v : String(v));
        }
      }
      meta[key] = items;
      continue;
    }
    meta[key] = parseScalar(raw);
  }
  return { meta, body: m[2] };
}

/** Parse the extended fields out of a metadata object. Shared between disk + bundled. */
export function parseSkillFrontmatter(meta: Record<string, any>, fallbackName: string): {
  title: string;
  description: string;
  triggers?: string[];
  whenToUse?: string;
  paths?: string[];
  allowedTools?: string[];
  context?: 'inline' | 'fork';
  model?: string;
  argumentHint?: string;
  userInvocable?: boolean;
  disableModelInvocation?: boolean;
} {
  // Reject context values we don't recognize, default to inline.
  const ctxRaw = meta.context;
  const context = ctxRaw === 'fork' ? 'fork' : ctxRaw === 'inline' ? 'inline' : undefined;
  return {
    title: String(meta.title ?? fallbackName),
    description: String(meta.description ?? '(no description)'),
    triggers: asStringArray(meta.triggers),
    whenToUse: typeof meta.when_to_use === 'string' ? meta.when_to_use
              : typeof meta.whenToUse === 'string' ? meta.whenToUse
              : undefined,
    paths: asStringArray(meta.paths),
    allowedTools: asStringArray(meta['allowed-tools'] ?? meta.allowedTools),
    context,
    model: typeof meta.model === 'string' ? meta.model : undefined,
    argumentHint: typeof meta['argument-hint'] === 'string' ? meta['argument-hint']
                : typeof meta.argumentHint === 'string' ? meta.argumentHint
                : undefined,
    userInvocable: asBoolean(meta['user-invocable'] ?? meta.userInvocable),
    disableModelInvocation: asBoolean(meta['disable-model-invocation'] ?? meta.disableModelInvocation),
  };
}

// ── Bundled skills registry ────────────────────────────────────────────────
/** Bundled skill definition — registered programmatically at plugin init.
 *  Mirrors upstream Claude Code's `registerBundledSkill()`. */
export interface BundledSkillDef {
  name: string;
  title?: string;
  description: string;
  whenToUse?: string;
  triggers?: string[];
  paths?: string[];
  allowedTools?: string[];
  context?: 'inline' | 'fork';
  model?: string;
  argumentHint?: string;
  userInvocable?: boolean;
  disableModelInvocation?: boolean;
  /** Markdown body injected when the skill is invoked. */
  body: string;
  /** Sibling reference files extracted to disk on first invocation. */
  files?: Record<string, string>;
}

const bundledSkills: Skill[] = [];

/** Register a built-in skill bundled with the plugin. Call during plugin init. */
export function registerBundledSkill(def: BundledSkillDef): void {
  invalidateDiscoverCache();
  bundledSkills.push({
    name: def.name,
    title: def.title ?? def.name,
    description: def.description,
    whenToUse: def.whenToUse,
    triggers: def.triggers,
    paths: def.paths,
    allowedTools: def.allowedTools,
    context: def.context,
    model: def.model,
    argumentHint: def.argumentHint,
    userInvocable: def.userInvocable,
    disableModelInvocation: def.disableModelInvocation,
    files: def.files,
    path: `(bundled)/${def.name}/SKILL.md`,
    source: 'bundled',
    body: def.body,
  });
}

/** Clear bundled skill registry (test helper / hot reload). */
export function clearBundledSkills(): void {
  invalidateDiscoverCache();
  bundledSkills.length = 0;
}

export function getBundledSkills(): Skill[] {
  return bundledSkills.slice();
}

// ── Disk skill loader ──────────────────────────────────────────────────────
/** Load one disk skill folder. Returns null on missing SKILL.md / parse error. */
async function loadDiskSkill(
  app: App,
  skillFolder: TFolder,
  source: SkillSource,
): Promise<Skill | null> {
  const skillFile = app.vault.getAbstractFileByPath(`${skillFolder.path}/SKILL.md`);
  if (!(skillFile instanceof TFileCls)) return null;
  try {
    const raw = await app.vault.cachedRead(skillFile);
    const { meta, body } = parseFrontmatter(raw);
    const parsed = parseSkillFrontmatter(meta, skillFolder.name);
    return {
      name: skillFolder.name,
      ...parsed,
      body: body.trim(),
      path: skillFile.path,
      source,
    };
  } catch (e) {
    console.warn(`[skills] failed to load ${skillFolder.path}/SKILL.md`, e);
    return null;
  }
}

/** Load all skills under a given root folder. */
async function loadSkillsFromRoot(
  app: App,
  rootPath: string,
  source: SkillSource,
): Promise<Skill[]> {
  const root = app.vault.getAbstractFileByPath(rootPath);
  if (!(root instanceof TFolder)) return [];
  const out: Skill[] = [];
  for (const child of root.children) {
    if (!(child instanceof TFolder)) continue;
    const s = await loadDiskSkill(app, child, source);
    if (s) out.push(s);
  }
  return out;
}

/** Load nested skill dirs found under arbitrary folders in the vault.
 *  These are skill folders located at any depth, like
 *  `Project/MLPaper/.glossa/skills/some-skill/SKILL.md`. We accumulate the set
 *  of discovered nested-skill-dir paths as the user touches files; this
 *  function loads from that accumulated set. */
async function loadNestedSkills(app: App, dirs: ReadonlySet<string>): Promise<Skill[]> {
  const out: Skill[] = [];
  for (const dir of dirs) {
    const root = app.vault.getAbstractFileByPath(dir);
    if (!(root instanceof TFolder)) continue;
    for (const child of root.children) {
      if (!(child instanceof TFolder)) continue;
      const s = await loadDiskSkill(app, child, 'project-nested');
      if (s) out.push(s);
    }
  }
  return out;
}

// ── Nested skill directory discovery + cross-session persistence ──────────
/** Set of nested skill dirs discovered. Persisted to
 *  `.glossa/nested_skill_dirs.json` (debounced 750ms after each new entry)
 *  and reloaded at plugin init so we don't re-walk the vault tree every
 *  startup. */
const nestedSkillDirs = new Set<string>();

const NESTED_DIRS_PATH = '.glossa/nested_skill_dirs.json';
let persistLoaded = false;
let persistTimer: number | null = null;

interface NestedDirsFile {
  version: 1;
  dirs: Record<string, number>;  // path → last-seen timestamp
}

/** Load persisted dirs on plugin init. Re-validates each path — stale
 *  entries (folder deleted while plugin was off) are dropped on next flush.
 *  Reads via safeReadJson so a corrupted current falls back to .bak. */
export async function loadPersistedNestedSkillDirs(app: App): Promise<void> {
  if (persistLoaded) return;
  persistLoaded = true;
  try {
    const { safeReadJson } = await import('../utils/safe_write');
    const parsed = await safeReadJson<Partial<NestedDirsFile>>(app.vault.adapter, NESTED_DIRS_PATH);
    if (!parsed?.dirs || typeof parsed.dirs !== 'object') return;
    for (const path of Object.keys(parsed.dirs)) {
      const folder = app.vault.getAbstractFileByPath(path);
      if (folder instanceof TFolder) nestedSkillDirs.add(path);
    }
  } catch (e) {
    console.warn('[skills] failed to load persisted nested dirs', e);
  }
}

function schedulePersist(app: App): void {
  if (persistTimer) window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    persistTimer = null;
    persistNow(app).catch(() => {});
  }, 750);
}

/** Synchronously cancel any pending debounced persist + force a flush.
 *  Call from plugin.onunload so in-flight changes from the last 750ms
 *  aren't lost. Idempotent (safe to call multiple times). */
export async function flushPersistedNestedSkillDirs(app: App): Promise<void> {
  if (persistTimer) {
    window.clearTimeout(persistTimer);
    persistTimer = null;
  }
  await persistNow(app);
}

async function persistNow(app: App): Promise<void> {
  try {
    const adapter = app.vault.adapter;
    if (!(await adapter.exists('.glossa'))) await adapter.mkdir('.glossa');
    const now = Date.now();
    const data: NestedDirsFile = {
      version: 1,
      dirs: Object.fromEntries([...nestedSkillDirs].map(p => [p, now])),
    };
    // Atomic write — small file, but a corrupted persistence would force
    // re-discovery on every plugin restart, defeating the cache purpose.
    const { safeWriteJson } = await import('../utils/safe_write');
    await safeWriteJson(adapter, NESTED_DIRS_PATH, data, { pretty: true });
  } catch (e) {
    console.warn('[skills] persist nested dirs failed', e);
  }
}

/** Walk up from `filePath` and register any `.glossa/skills` dir found.
 *  Mirrors upstream Claude Code's `discoverSkillDirsForPaths`. */
export function discoverNestedSkillDirs(app: App, filePath: string): string[] {
  const parts = filePath.split('/');
  const added: string[] = [];
  // Walk up but skip the vault root (handled by PROJECT_SKILL_ROOTS already).
  for (let i = parts.length - 1; i > 0; i--) {
    const parent = parts.slice(0, i).join('/');
    if (!parent) break;
    const candidate = `${parent}/.glossa/skills`;
    if (nestedSkillDirs.has(candidate)) continue;
    const folder = app.vault.getAbstractFileByPath(candidate);
    if (folder instanceof TFolder) {
      nestedSkillDirs.add(candidate);
      added.push(candidate);
    }
  }
  if (added.length > 0) {
    schedulePersist(app);
    // New nested skill dirs change discoverSkills' output; bust the cache.
    invalidateDiscoverCache();
  }
  return added;
}

export function clearNestedSkillDirs(): void {
  nestedSkillDirs.clear();
}

// ── Realpath-style dedup ───────────────────────────────────────────────────
/** Compute a canonical identity for a skill so symlinks / hardlinks / duplicate
 *  folder-name collisions across sources all collapse to one. Obsidian's
 *  vault API doesn't expose realpath, so we use `(path, sizeHint)` — for
 *  bundled skills the virtual path is unique enough. */
function skillIdentity(s: Skill): string {
  return `${s.source}:${s.path}`;
}

// ── Multi-source discovery + precedence ────────────────────────────────────
/** Source precedence (highest wins on folder-name collision):
 *  project (.glossa/skills) > project-nested > legacy (.note-codex/skills) > user > bundled */
const SOURCE_PRIORITY: Record<SkillSource, number> = {
  project: 5,
  'project-nested': 4,
  legacy: 3,
  user: 2,
  bundled: 1,
};

// ── discoverSkills TTL cache ───────────────────────────────────────────────
// Many call sites (agent-loop system prompt assembly, skill_activation,
// skill_listing, skill tool checkPermissions, /skill autocomplete) each hit
// discoverSkills once per turn / per file event. A 50-skill vault would do
// the full disk walk + SKILL.md cachedRead 5+ times per turn. We cache the
// Skill[] for 2.5s and invalidate on:
//   - bundled-skill registry change
//   - any vault.modify event on a SKILL.md path
//   - nested skill dir discovery
const DISCOVER_TTL_MS = 2500;
let discoverCache: { skills: Skill[]; expiresAt: number } | null = null;

/** Drop the discoverSkills cache. Called by the bundled-skill register/clear
 *  helpers and by main.ts when a SKILL.md is modified. */
export function invalidateDiscoverCache(): void {
  discoverCache = null;
}

/** Discover every skill available in the current session, applying precedence:
 *   1. project-level disk skills (`.glossa/skills/<name>/SKILL.md`)
 *   2. nested project skills (discovered by `discoverNestedSkillDirs`)
 *   3. legacy disk skills (`.note-codex/skills/<name>/SKILL.md`)
 *   4. (TODO: user-global `~/.glossa/skills/` — left as no-op until plugin
 *       can read outside the vault sandbox; obsidian electron build allows
 *       it via `app.vault.adapter.basePath` + `fs`, but mobile cannot)
 *   5. bundled skills (registered via `registerBundledSkill`)
 *
 *  Dedup is by skill `name` (folder); on collision the higher-priority source
 *  wins. realpath-style dedup ALSO collapses same-realpath duplicates within
 *  one source (e.g. two symlinks pointing at the same SKILL.md). */
export async function discoverSkills(app: App): Promise<Skill[]> {
  // Cache hit: return the previous result if still fresh. The disk walk is
  // the same regardless of caller; multiple call sites per turn would
  // otherwise repeat it 5-10x. Invalidation is signal-driven (see
  // invalidateDiscoverCache).
  const now = Date.now();
  if (discoverCache && discoverCache.expiresAt > now) {
    return discoverCache.skills;
  }
  // Load from all disk sources in parallel — they're independent.
  const [projectSkills, legacySkills, nestedSkills] = await Promise.all([
    loadSkillsFromRoot(app, PROJECT_SKILL_ROOTS[0].root, 'project'),
    loadSkillsFromRoot(app, PROJECT_SKILL_ROOTS[1].root, 'legacy'),
    loadNestedSkills(app, nestedSkillDirs),
  ]);

  // Combine sources in priority order so that on name-collision, higher
  // priority (added first) wins via the `seen` Set below.
  const all: Skill[] = [
    ...projectSkills,
    ...nestedSkills,
    ...legacySkills,
    ...getBundledSkills(),
  ];

  // Dedup by name (folder name): higher priority source wins.
  const byName = new Map<string, Skill>();
  for (const s of all) {
    const prev = byName.get(s.name);
    if (!prev || SOURCE_PRIORITY[s.source] > SOURCE_PRIORITY[prev.source]) {
      byName.set(s.name, s);
    }
  }

  // Realpath-style dedup: collapse same canonical identity (catches symlink
  // cycles within one source where two folders point at the same SKILL.md).
  const byIdentity = new Map<string, Skill>();
  for (const s of byName.values()) {
    const id = skillIdentity(s);
    if (!byIdentity.has(id)) byIdentity.set(id, s);
  }

  const out = Array.from(byIdentity.values());
  out.sort((a, b) => a.name.localeCompare(b.name));
  discoverCache = { skills: out, expiresAt: now + DISCOVER_TTL_MS };
  return out;
}

/** Locate a single skill by exact folder name (case-sensitive). */
export async function getSkill(app: App, name: string): Promise<Skill | null> {
  const all = await discoverSkills(app);
  return all.find(s => s.name === name) ?? null;
}
