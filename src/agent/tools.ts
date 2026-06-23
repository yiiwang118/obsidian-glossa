/**
 * Tool registry.
 *
 * Each tool lives in its own file under `./tools/` (mirrors upstream Claude Code's
 * per-tool layout). This module is the thin barrel that imports each ToolImpl literal
 * and exposes the unified registry + helpers.
 */
import { readNote } from './tools/read_note';
import { listFiles } from './tools/list_files';
import { searchVault } from './tools/search_vault';
import { grepVault } from './tools/grep_vault';
import { discoverSkillsTool } from './tools/discover_skills';
import { runSkill } from './tools/run_skill';
import { searchByTag } from './tools/search_by_tag';
import { getActiveFile } from './tools/get_active_file';
import { getSelection } from './tools/get_selection';
import { queryMetadata } from './tools/query_metadata';
import { writeNote } from './tools/write_note';
import { createNote } from './tools/create_note';
import { editSection } from './tools/edit_section';
import { appendToNote } from './tools/append_to_note';
import { deleteNote } from './tools/delete_note';
import { fileEdit } from './tools/file_edit';
import { applyPatch } from './tools/apply_patch';
import { todoWrite } from './tools/todo_write';
import { attemptCompletion } from './tools/attempt_completion';
import { semanticSearch } from './tools/semantic_search';
import { viewImage } from './tools/view_image';
import { readPdf } from './tools/read_pdf';
import { webFetch } from './tools/web_fetch';
import { skillTool } from './tools/skill';
import { toolSearchTool } from './tools/tool_search';

// Phase 1 surgical / metadata tools.
import { patchNote } from './tools/patch_note';
import { manageFrontmatter } from './tools/manage_frontmatter';
import { manageTags } from './tools/manage_tags';
import { renameNote } from './tools/rename_note';
import { resolveWikilink } from './tools/resolve_wikilink';
import { getBacklinks } from './tools/get_backlinks';
import { getOutgoingLinks } from './tools/get_outgoing_links';
import { listTags } from './tools/list_tags';
import { getPeriodicNote } from './tools/get_periodic_note';
import { readCanvas } from './tools/read_canvas';
import { patchCanvas } from './tools/patch_canvas';

// Phase 2 workspace tools.
import { openInEditor } from './tools/open_in_editor';
import { setSelection } from './tools/set_selection';
import { listOpenFiles } from './tools/list_open_files';
import { executeCommand } from './tools/execute_command';
import { listCommands } from './tools/list_commands';

// Phase 3 plugin bridges (detect-then-register; see ./plugin_bridges.ts).
import { dataviewQuery } from './tools/dataview_query';
import { templaterRender } from './tools/templater_render';
import { tasksQuery } from './tools/tasks_query';
import { basesQuery } from './tools/bases_query';

import type { ToolSpec } from '../providers/types';
import type { ToolImpl } from './tools/_shared';

// Re-export shared types + helpers so existing import paths keep working.
export {
  normalizeToolResult,
  isReadOnlyTool,
  isConcurrencySafeTool,
  isDestructiveTool,
  findWithQuoteNormalization,
  buildTool,
} from './tools/_shared';
export type {
  ToolImpl,
  ToolDef,
  ToolRunResult,
  PermissionResult,
} from './tools/_shared';

/** Master tool registry, keyed by tool name. Order here loosely groups:
 *  reads → metadata → writes → edits → planning → control → media → network. */
export const TOOLS: Record<string, ToolImpl> = {
  read_note: readNote,
  list_files: listFiles,
  search_vault: searchVault,
  grep_vault: grepVault,
  search_by_tag: searchByTag,
  get_active_file: getActiveFile,
  get_selection: getSelection,
  query_metadata: queryMetadata,

  write_note: writeNote,
  create_note: createNote,
  edit_section: editSection,
  append_to_note: appendToNote,
  delete_note: deleteNote,
  file_edit: fileEdit,
  apply_patch: applyPatch,

  todo_write: todoWrite,
  attempt_completion: attemptCompletion,

  semantic_search: semanticSearch,
  view_image: viewImage,
  read_pdf: readPdf,
  web_fetch: webFetch,
  // Unified skill tool (P0-3) — supersedes the legacy pair below, which remain
  // registered with [deprecated] markers so old sessions / docs still work.
  skill: skillTool,
  tool_search: toolSearchTool,
  discover_skills: discoverSkillsTool,
  run_skill: runSkill,

  // Phase 1 surgical / metadata tools.
  patch_note: patchNote,
  manage_frontmatter: manageFrontmatter,
  manage_tags: manageTags,
  rename_note: renameNote,
  resolve_wikilink: resolveWikilink,
  get_backlinks: getBacklinks,
  get_outgoing_links: getOutgoingLinks,
  list_tags: listTags,
  get_periodic_note: getPeriodicNote,
  read_canvas: readCanvas,
  patch_canvas: patchCanvas,

  // Phase 2 workspace tools.
  open_in_editor: openInEditor,
  set_selection: setSelection,
  list_open_files: listOpenFiles,
  execute_command: executeCommand,
  list_commands: listCommands,

  // Phase 3 plugin bridges — always registered; filtered out of the model's
  // visible tool list when the upstream plugin isn't detected (see
  // listToolSpecs filter below + plugin_bridges.ts isBridgeActive()).
  dataview_query: dataviewQuery,
  templater_render: templaterRender,
  tasks_query: tasksQuery,
  bases_query: basesQuery,
};

/**
 * Build the model-facing tool spec list.
 *
 * Two filters apply by default — both produce the surface the model SHOULD see:
 *  1. Bridge filter: dataview_query / templater_render / tasks_query / bases_query
 *     are hidden when their upstream plugin isn't detected. (plugin_bridges.ts)
 *  2. Defer filter: tools flagged `shouldDefer:true` (e.g. legacy edit_section,
 *     append_to_note, discover_skills, run_skill) are hidden from the initial
 *     prompt; the model must call `tool_search` to load their schemas.
 *
 * Pass `{ includeDeferred: true }` only when you specifically want the full
 * spec list including deferred tools (e.g. tool_search itself enumerating them
 * for keyword scoring — though it consults TOOLS directly today).
 */
export function listToolSpecs(opts: { includeDeferred?: boolean } = {}): ToolSpec[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Keep bridge activation lazy to avoid loading optional plugin probes before Obsidian is ready.
  const { allBridgeToolNames, isBridgeActive } = require('./plugin_bridges') as typeof import('./plugin_bridges');
  const bridgeNames = new Set(allBridgeToolNames());
  return Object.values(TOOLS)
    .filter(t => !bridgeNames.has(t.spec.name) || isBridgeActive(t.spec.name))
    .filter(t => opts.includeDeferred || !t.shouldDefer)
    .map(t => t.spec);
}

/** Lazy alias index: { aliasName → primary ToolImpl }. Built on first access
 *  and invalidated by `clearToolAliasCache()` (intended for tests / hot
 *  reload). Aliases let us rename a tool without breaking older models or
 *  saved skill scripts that still emit the old name. */
let aliasCache: Map<string, ToolImpl> | null = null;
function ensureAliasCache(): Map<string, ToolImpl> {
  if (aliasCache) return aliasCache;
  const m = new Map<string, ToolImpl>();
  for (const tool of Object.values(TOOLS)) {
    if (!tool.aliases) continue;
    for (const alias of tool.aliases) {
      if (m.has(alias) || TOOLS[alias]) {
        // Conflict: an alias would shadow a primary or duplicate another alias.
        // Prefer the primary (skip the alias entry) — safer than silently
        // overriding. Log so the developer can rename.
        console.warn(`[tools] alias "${alias}" on tool "${tool.spec.name}" conflicts; ignored.`);
        continue;
      }
      m.set(alias, tool);
    }
  }
  aliasCache = m;
  return m;
}

export function clearToolAliasCache(): void { aliasCache = null; }

/** Look up a tool by name. Falls back to alias matching when no primary
 *  matches. Primary always wins on collision. */
export function getTool(name: string): ToolImpl | undefined {
  const primary = TOOLS[name];
  if (primary) return primary;
  return ensureAliasCache().get(name);
}
