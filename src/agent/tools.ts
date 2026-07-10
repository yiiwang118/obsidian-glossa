
/**
 * Tool registry.
 *
 * Each tool lives in its own file under `./tools/` (mirrors upstream Claude Code's
 * per-tool layout). This module is the thin barrel that imports each ToolImpl literal
 * and exposes the unified registry + helpers.
 */
import { readNote } from './tools/read_note';
import { readFiles } from './tools/read_files';
import { discoverSkillsTool } from './tools/discover_skills';
import { runSkill } from './tools/run_skill';
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
import { viewImage } from './tools/view_image';
import { readPdf } from './tools/read_pdf';
import { webFetch } from './tools/web_fetch';
import { webSearch } from './tools/web_search';
import { webResearch } from './tools/web_research';
import { downloadFile } from './tools/download_file';
import { skillTool } from './tools/skill';
import { toolSearchTool } from './tools/tool_search';
import { contextPrune } from './tools/context_prune';
import { validateSkill } from './tools/validate_skill';

// Phase 1 surgical / metadata tools.
import { patchNote } from './tools/patch_note';
import { manageFrontmatter } from './tools/manage_frontmatter';
import { manageTags } from './tools/manage_tags';
import { renameNote } from './tools/rename_note';
import { resolveWikilink } from './tools/resolve_wikilink';
import { getBacklinks } from './tools/get_backlinks';
import { getOutgoingLinks } from './tools/get_outgoing_links';
import { getPeriodicNote } from './tools/get_periodic_note';
import { readCanvas } from './tools/read_canvas';
import { patchCanvas } from './tools/patch_canvas';

import { openInEditor } from './tools/open_in_editor';
import { setSelection } from './tools/set_selection';
import { listOpenFiles } from './tools/list_open_files';

// Phase 3 plugin bridges (detect-then-register; see ./plugin_bridges.ts).
import { dataviewQuery } from './tools/dataview_query';
import { templaterRender } from './tools/templater_render';
import { tasksQuery } from './tools/tasks_query';

import type { ToolSpec } from '../providers/types';
import type { ToolImpl } from './tools/_shared';
import { allBridgeToolNames, isBridgeActive } from './plugin_bridges';

// Re-export shared types + helpers so existing import paths keep working.
export {
  normalizeToolResult,
  isReadOnlyTool,
  isConcurrencySafeTool,
  isDestructiveTool,
  validateToolInput,
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
  read_files: readFiles,
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

  view_image: viewImage,
  read_pdf: readPdf,
  web_research: webResearch,
  web_search: webSearch,
  web_fetch: webFetch,
  download_file: downloadFile,
  // Unified skill tool (P0-3) — supersedes the legacy pair below, which remain
  // registered with [deprecated] markers so old sessions / docs still work.
  skill: skillTool,
  tool_search: toolSearchTool,
  context_prune: contextPrune,
  validate_skill: validateSkill,
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
  get_periodic_note: getPeriodicNote,
  read_canvas: readCanvas,
  patch_canvas: patchCanvas,

  open_in_editor: openInEditor,
  set_selection: setSelection,
  list_open_files: listOpenFiles,

  // Phase 3 plugin bridges — always registered; filtered out of the model's
  // visible tool list when the upstream plugin isn't detected (see
  // listToolSpecs filter below + plugin_bridges.ts isBridgeActive()).
  dataview_query: dataviewQuery,
  templater_render: templaterRender,
  tasks_query: tasksQuery,
};

const MODEL_HIDDEN_TOOL_NAMES = new Set([
  'attempt_completion',
  'append_to_note',
  'edit_section',
  'discover_skills',
  'run_skill',
]);
const BRIDGE_TOOL_NAMES = new Set(allBridgeToolNames());

/** True when a registered local tool is eligible for model exposure. This
 *  centralizes bridge/deferred filtering so tool_search cannot advertise a
 *  schema that the agent loop is unable to load. */
export function isToolAvailableForModel(
  name: string,
  opts: { includeDeferred?: boolean } = {},
): boolean {
  const tool = TOOLS[name];
  if (!tool || MODEL_HIDDEN_TOOL_NAMES.has(name)) return false;
  if (BRIDGE_TOOL_NAMES.has(name) && !isBridgeActive(name)) return false;
  if (tool.shouldDefer && !opts.includeDeferred) return false;
  return true;
}

/**
 * Build the model-facing tool spec list.
 *
 * Two filters apply by default — both produce the surface the model SHOULD see:
   *  1. Bridge filter: dataview_query / templater_render / tasks_query
 *     are hidden when their upstream plugin isn't detected. (plugin_bridges.ts)
 *  2. Defer filter: specialized tools (Canvas, links, metadata, workspace UI,
 *     plugin bridges, full-file writes) are hidden from the initial prompt;
 *     tool_search or a matching skill loads their schemas for the next step.
 *
 * Pass `{ includeDeferred: true }` only when you specifically want the full
 * spec list including deferred tools (tool_search uses this availability rule
 * so inactive bridges and model-hidden compatibility tools stay unreachable).
 */
export function listToolSpecs(opts: { includeDeferred?: boolean } = {}): ToolSpec[] {
  return Object.values(TOOLS)
    .filter(t => isToolAvailableForModel(t.spec.name, opts))
    .map(t => t.spec);
}

interface RegistrySchema {
  type?: string;
  description?: string;
  properties?: Record<string, RegistrySchema>;
  required?: string[];
  items?: RegistrySchema;
  additionalProperties?: boolean;
}

/** Static quality audit for model-facing tool contracts. Kept side-effect free
 *  so tests and release checks can fail with actionable per-tool messages. */
export function toolRegistryIssues(): string[] {
  const issues: string[] = [];
  const aliases = new Map<string, string>();
  for (const [key, tool] of Object.entries(TOOLS)) {
    const name = tool.spec.name;
    if (key !== name) issues.push(`${key}: registry key differs from spec name "${name}"`);
    if (!/^[a-z][a-z0-9_]*$/.test(name)) issues.push(`${name}: name must be snake_case`);
    if (tool.spec.description.trim().length < 20) issues.push(`${name}: description is too short`);
    if (tool.shouldDefer && !tool.searchHint && !tool.searchTags?.length) {
      issues.push(`${name}: deferred tool needs searchHint or searchTags`);
    }
    const schema = tool.spec.parameters as RegistrySchema;
    if (schema.type !== 'object') issues.push(`${name}: parameter schema must be an object`);
    if (schema.additionalProperties !== false) issues.push(`${name}: top-level schema must reject unknown properties`);
    const properties = schema.properties ?? {};
    for (const required of schema.required ?? []) {
      if (!(required in properties)) issues.push(`${name}: required property "${required}" is undefined`);
    }
    collectSchemaDescriptionIssues(name, schema, '', issues);
    for (const alias of tool.aliases ?? []) {
      if (!/^[a-z][a-z0-9_]*$/.test(alias)) issues.push(`${name}: invalid alias "${alias}"`);
      const owner = aliases.get(alias);
      if (owner && owner !== name) issues.push(`${name}: alias "${alias}" conflicts with ${owner}`);
      if (TOOLS[alias] && alias !== name) issues.push(`${name}: alias "${alias}" shadows a primary tool`);
      aliases.set(alias, name);
    }
  }
  return issues;
}

function collectSchemaDescriptionIssues(
  toolName: string,
  schema: RegistrySchema,
  prefix: string,
  issues: string[],
): void {
  for (const [name, child] of Object.entries(schema.properties ?? {})) {
    const path = prefix ? `${prefix}.${name}` : name;
    if (!child.description?.trim()) issues.push(`${toolName}: parameter "${path}" needs a description`);
    collectSchemaDescriptionIssues(toolName, child, path, issues);
    if (child.items) collectSchemaDescriptionIssues(toolName, child.items, `${path}[]`, issues);
  }
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
