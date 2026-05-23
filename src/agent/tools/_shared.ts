/**
 * Shared types and helpers for the per-tool modules in this directory.
 * Mirrors the upstream Claude Code tool architecture: each tool lives in its own file
 * exporting a single ToolImpl literal; the registry in ../tools.ts imports them all.
 */
import type { App } from 'obsidian';
import type { ToolSpec, ToolContentBlock } from '../../providers/types';

/** Permission decision returned by Tool.checkPermissions — mirrors upstream Claude Code's
 *  PermissionResult union. Most tools don't need to override checkPermissions; the agent
 *  loop applies a default policy of `allow` for read-only + `ask` for destructive. */
export type PermissionResult<Input = any> =
  | { behavior: 'allow';  updatedInput?: Input; decisionReason?: string }
  | { behavior: 'ask';    updatedInput?: Input; message?: string }
  | { behavior: 'deny';   message: string; decisionReason?: string };

/** A tool may return either a plain string (most tools) or this structured shape
 *  when it wants to send rich content (images, resources) back to the model. */
export interface ToolRunResult {
  /** Human-readable text for the UI card + a fallback for providers that can't
   *  carry rich blocks (OpenAI tool messages). */
  text: string;
  /** Anthropic content blocks. When present, providers prefer these over `text`
   *  for the actual tool_result payload sent to the model. */
  contentBlocks?: ToolContentBlock[];
}

export interface ToolImpl {
  spec: ToolSpec;
  /** Legacy: dangerous = needs approval. Kept for back-compat with code that hasn't
   *  been migrated to the more specific isReadOnly/isDestructive flags. */
  dangerous: boolean;
  /** Pure read of vault state — no mutations. */
  isReadOnly?: (args: any) => boolean;
  /** Tool result is independent of side-effects from other concurrent tools. */
  isConcurrencySafe?: (args: any) => boolean;
  /** Destructive (file mutation / network). */
  isDestructive?: (args: any) => boolean;
  describe: (args: any) => string;
  /** Preview shown in approval modal. May accept (args) or (app, args). */
  preview?: ((args: any) => Promise<string>) | ((app: App, args: any) => Promise<string>);
  /** Optional permission hook — return ask/deny to override the default policy. */
  checkPermissions?: (app: App, args: any) => Promise<PermissionResult>;
  /** Tool runner. May return a plain string or a ToolRunResult with content
   *  blocks. The optional 3rd arg supplies an AbortSignal threaded from the
   *  agent loop's opts.signal so long-running tools (network fetches, plugin
   *  bridges querying large indices) can bail out when the user hits Stop
   *  rather than continuing to compute / pay network round-trips after the
   *  UI has moved on. The arg is OPTIONAL: tools that don't honor it are
   *  fine (the existing AbortController on opts.signal still cancels the
   *  STREAM from the provider; this just lets tools cooperate). */
  run: (app: App, args: any, ctx?: { signal?: AbortSignal }) => Promise<string | ToolRunResult>;

  // ── Extended fields (introduced for buildTool factory) ────────────────────
  /** Backward-compat: alternate names this tool answers to (e.g. after a rename). */
  aliases?: string[];
  /** One-line keyword phrase used by ToolSearch for deferred-tool matching.
   *  3–10 words, no trailing period. Prefer terms not already in the tool name. */
  searchHint?: string;
  /** When tool result exceeds this many chars, the agent loop will persist it
   *  to disk under `.glossa/tool_outputs/<id>.txt` and replace the inlined text
   *  with a `[truncated, see <path>]` preview. `Infinity` disables persistence
   *  (e.g. read_note has its own internal caps). Defaults to 100_000. */
  maxResultSizeChars?: number;
  /** When true, this tool is "deferred": its full schema is NOT included in the
   *  initial tool spec list sent to the model. The model must call
   *  `tool_search` first to load the schema. Use for rarely-needed plugin-bridge
   *  tools so the default tool surface stays compact. */
  shouldDefer?: boolean;
  /** Called on a COPY of the input before observers (approval, permission rules,
   *  audit log) see it. Mutate in place to normalize / expand derived fields
   *  (e.g. path expansion). The original args sent to `run()` are NOT mutated
   *  — this keeps the model-visible schema stable and preserves prompt cache. */
  backfillObservableInput?: (input: Record<string, unknown>) => void;
  /** Present-continuous spinner activity, e.g. "Reading Foo.md". Falls back
   *  to TOOL_META.verb when undefined. */
  getActivityDescription?: (args: any) => string | null;
  /** Compact, single-line summary used in collapsed transcript views.
   *  Falls back to TOOL_META.summarize when undefined. */
  getToolUseSummary?: (args: any) => string | null;

  // ── Per-tool render hooks (P3-15) ─────────────────────────────────────────
  /** Custom HTML/text renderer for the tool's input message (shown above the
   *  tool card while it's running). Receives the args; returns either a DOM
   *  Node or a plain string. When unset, tool_meta.ts falls back to the
   *  default "<verb> <summary>" line. */
  renderToolUseMessage?: (args: any) => HTMLElement | string | null;
  /** Custom renderer for the tool's result block (shown after success).
   *  When unset, the default Markdown rendering applies. Returning null
   *  delegates to the default. */
  renderToolResultMessage?: (result: string, args: any) => HTMLElement | string | null;
  /** Custom renderer for the rejected/denied case (e.g. show a "denied" pill
   *  with no diff). When unset, falls back to "Tool denied" text. */
  renderToolUseRejectedMessage?: (args: any) => HTMLElement | string | null;
  /** Custom renderer for the error case (e.g. show stack/code separately).
   *  When unset, falls back to plain error text. */
  renderToolUseErrorMessage?: (error: string, args: any) => HTMLElement | string | null;
}

// ── buildTool factory ──────────────────────────────────────────────────────
/** ToolImpl shape accepted by buildTool. All safety/UI fields are optional;
 *  TOOL_DEFAULTS fills them in fail-closed. */
export type ToolDef = Omit<ToolImpl, 'dangerous' | 'isReadOnly' | 'isConcurrencySafe' | 'isDestructive'> & {
  dangerous?: boolean;
  isReadOnly?: (args: any) => boolean;
  isConcurrencySafe?: (args: any) => boolean;
  isDestructive?: (args: any) => boolean;
};

/** Fail-closed defaults: when in doubt, assume the tool MUTATES and is NOT
 *  parallel-safe. The agent loop's safety machinery then routes it through
 *  the slow path (single-batch sequential execution + approval). */
const TOOL_DEFAULTS = {
  dangerous: true,                       // ask before running
  isReadOnly: (_args: any) => false,     // assumes mutation
  isConcurrencySafe: (_args: any) => false,
  isDestructive: (_args: any) => true,
  maxResultSizeChars: 100_000,
};

/** Build a complete ToolImpl from a partial definition, filling in fail-closed
 *  defaults. Mirrors upstream Claude Code's `buildTool()` pattern in Tool.ts.
 *
 *  Coherence rules applied:
 *  - If `isReadOnly` is set but `dangerous` is not, `dangerous` defaults to `!isReadOnly(args)`.
 *  - If `isReadOnly` is set but `isConcurrencySafe` is not, it inherits `isReadOnly`.
 *  - If `isReadOnly` is set but `isDestructive` is not, it inherits `!isReadOnly(args)`. */
export function buildTool(def: ToolDef): ToolImpl {
  // dangerous defaults to !isReadOnly() if isReadOnly was set, otherwise true.
  const dangerous = def.dangerous ?? (def.isReadOnly ? !def.isReadOnly({}) : TOOL_DEFAULTS.dangerous);
  return {
    ...def,
    dangerous,
    isReadOnly: def.isReadOnly ?? TOOL_DEFAULTS.isReadOnly,
    isConcurrencySafe: def.isConcurrencySafe ?? def.isReadOnly ?? TOOL_DEFAULTS.isConcurrencySafe,
    isDestructive: def.isDestructive ?? (def.isReadOnly ? (a: any) => !def.isReadOnly!(a) : TOOL_DEFAULTS.isDestructive),
    maxResultSizeChars: def.maxResultSizeChars ?? TOOL_DEFAULTS.maxResultSizeChars,
  };
}

/** Normalize a tool's return value (string OR ToolRunResult) into a uniform shape. */
export function normalizeToolResult(raw: string | ToolRunResult): ToolRunResult {
  if (typeof raw === 'string') return { text: raw };
  return { text: raw.text ?? '', contentBlocks: raw.contentBlocks };
}

/** Unicode normalization mirroring upstream Claude Code's findActualString helper:
 *  if the model authored an edit with straight ASCII quotes but the file has curly
 *  Unicode quotes (or vice versa), try to locate a normalised match.
 *
 *  Parity with patch_envelope.ts: also collapses full-width / non-breaking
 *  spaces to a regular space so file_edit and apply_patch have the same
 *  matching tolerance. */
export function normalizeForMatch(s: string): string {
  return s
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—‐]/g, '-')
    .replace(/[   　]/g, ' ');     // NBSP, figure space, narrow NBSP, ideographic space
}
export function findWithQuoteNormalization(haystack: string, needle: string): string | null {
  if (haystack.includes(needle)) return needle;
  const nh = normalizeForMatch(haystack);
  const nn = normalizeForMatch(needle);
  const idx = nh.indexOf(nn);
  if (idx < 0) return null;
  return haystack.slice(idx, idx + needle.length);
}

/** Default classification helpers used by the agent loop. */
export function isReadOnlyTool(t: ToolImpl, args: any = {}): boolean {
  return t.isReadOnly ? t.isReadOnly(args) : !t.dangerous;
}
export function isConcurrencySafeTool(t: ToolImpl, args: any = {}): boolean {
  if (t.isConcurrencySafe) return t.isConcurrencySafe(args);
  return isReadOnlyTool(t, args);
}
export function isDestructiveTool(t: ToolImpl, args: any = {}): boolean {
  return t.isDestructive ? t.isDestructive(args) : t.dangerous;
}

/**
 * Reject paths that would escape the vault, contain NUL bytes, or otherwise
 * look hostile. Every tool that takes a user-controlled path MUST call this
 * before touching the filesystem — the LLM is treated as untrusted input.
 *
 * Throws a descriptive Error the agent loop will surface as a tool result the
 * model can read and self-correct from (instead of silently obeying a bad
 * path). Returns the trimmed-of-leading-`./` form so downstream code uses a
 * canonical key.
 *
 * Obsidian's `getAbstractFileByPath()` does some normalisation but does NOT
 * refuse `..`-bearing paths — it'll cheerfully look up `Foo/../../etc/passwd`
 * relative to the vault and silently return null, then the create-folder
 * helpers will happily mkdir along the way. So we guard at the tool boundary.
 */
export function assertVaultPath(input: unknown, field = 'path'): string {
  if (typeof input !== 'string' || input.length === 0) {
    throw new Error(`Missing or non-string "${field}". Pass a vault-relative path like "Notes/Foo.md".`);
  }
  if (input.length > 1024) {
    throw new Error(`"${field}" too long (${input.length} chars). Vault paths should be < 1024 chars.`);
  }
  if (input.includes('\0')) {
    throw new Error(`"${field}" contains a NUL byte. Refusing.`);
  }
  // URL-decode defensively. A model that's been trained on web traversal
  // payloads may emit `..%2Fetc/passwd` to slip past a literal `..` check.
  // We decode once before segment-checking. If the input isn't a valid URI
  // (e.g. legit filename "100%-done.md"), decodeURIComponent throws and we
  // keep the raw form — same fail-closed posture as the rest of this guard.
  //
  // Trade-off: an Obsidian file literally named with `%2F` (etc.) in it
  // becomes inaccessible after this change. That's a vanishingly rare name
  // and the alternative — accepting URL-encoded path traversal — is worse.
  let decoded = input;
  try { decoded = decodeURIComponent(input); } catch { /* keep raw */ }
  // Strip leading `./`. Reject absolute paths (Unix `/x`, Windows `C:\x`,
  // UNC `\\x`, AND single-backslash-prefixed `\foo` which on Windows means
  // "root of current drive" — same blast radius as `C:\foo`).
  let p = decoded.replace(/^\.\//, '').trim();
  if (p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\') || p.startsWith('\\')) {
    throw new Error(`"${field}" must be vault-relative, not absolute. Got: ${input}`);
  }
  // Normalise separators, then check no segment is `..`. We refuse even
  // `Notes/../Other` because if the LLM wants Other.md it should just say so.
  const segs = p.replace(/\\/g, '/').split('/');
  if (segs.some(s => s === '..' || s === '.')) {
    throw new Error(`"${field}" must not contain "." or ".." segments. Got: ${input}`);
  }
  return p;
}

/** Canonicalize a single value the same way assertVaultPath does for the
 *  observable / permission-check side: strip leading `./`, trim whitespace.
 *  Does NOT throw — non-string values pass through unchanged so callers
 *  can apply it unconditionally to any field. */
export function canonicalizeVaultPath(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  return v.replace(/^\.\//, '').trim();
}

/** Factory that builds a `backfillObservableInput` function which
 *  canonicalizes every path-bearing field on the observable input copy.
 *  Replaces ~20 hand-written copies of `if (input.path) input.path =
 *  ((input.path as string)).replace(/^\.\//,'').trim()`.
 *
 *  Usage in a tool def:
 *
 *      backfillObservableInput: normalizePathFields(['path']),
 *      backfillObservableInput: normalizePathFields(['file_path']),
 *      backfillObservableInput: normalizePathFields(['from', 'to']),
 */
export function normalizePathFields(fields: readonly string[]): (input: Record<string, unknown>) => void {
  return (input) => {
    for (const f of fields) {
      if (f in input) (input as any)[f] = canonicalizeVaultPath((input as any)[f]);
    }
  };
}

/** Extract the folder part of a vault path. Empty string if at vault root. */
export function vaultFolderOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i > 0 ? path.slice(0, i) : '';
}

/** Translate an Obsidian-style glob (`**`, `*`, `?`) to a RegExp. Used by
 *  list_files and grep_vault — keep these in lockstep so user-facing glob
 *  semantics don't drift between the two. */
export function globToRegExp(glob: string): RegExp {
  // Anchor + escape regex metachars except `*` and `?` which we expand below.
  let rx = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') { rx += '.*'; i++; }
    else if (c === '*') rx += '[^/]*';
    else if (c === '?') rx += '[^/]';
    else if (/[.+^${}()|[\]\\]/.test(c)) rx += '\\' + c;
    else rx += c;
  }
  rx += '$';
  return new RegExp(rx);
}
