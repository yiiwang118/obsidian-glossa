const PATH_KEYS = new Set([
  'path', 'paths', 'file_path', 'base_path', 'target_path', 'template_path',
  'from', 'to', 'folder', 'save_to',
]);

const ACTIVE_FILE_TOOLS = new Set(['get_active_file', 'get_selection', 'set_selection']);
const VAULT_WIDE_TOOLS = new Set([
  'list_open_files', 'list_tags', 'search_by_tag', 'search_vault', 'grep_vault',
  'semantic_search', 'rebuild_embedding_index',
  // These bridge/metadata tools can enumerate or resolve paths outside their
  // explicit input, so they are not safe under a hard folder boundary.
  'dataview_query', 'tasks_query', 'get_backlinks', 'get_outgoing_links',
  'get_periodic_note', 'resolve_wikilink', 'templater_render',
]);

export function normalizeWorkspaceFolder(value: string): string {
  return value.trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^\.\/+/, '')
    .replace(/\/{2,}/g, '/')
    .replace(/\/$/, '');
}

export function normalizeWorkspaceFolders(values: readonly string[]): string[] {
  const folders = values.map(normalizeWorkspaceFolder).filter(Boolean);
  return Array.from(new Set(folders)).sort();
}

export function isPathInWorkspace(path: string, folders: readonly string[]): boolean {
  const normalized = normalizeWorkspaceFolder(path);
  const scopes = normalizeWorkspaceFolders(folders);
  if (scopes.length === 0) return true;
  return scopes.some(folder => normalized === folder || normalized.startsWith(`${folder}/`));
}

function collectPathValues(value: unknown, key: string | null, output: string[]): void {
  if (typeof value === 'string') {
    if (key && (PATH_KEYS.has(key) || key.endsWith('_path') || key.endsWith('Path'))) output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectPathValues(item, key, output);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [childKey, child] of Object.entries(value)) collectPathValues(child, childKey, output);
}

function envelopePaths(patch: unknown): string[] {
  if (typeof patch !== 'string') return [];
  const paths: string[] = [];
  const pattern = /^\*\*\* (?:Add File|Delete File|Update File|Move to):\s*(.+)$/gm;
  for (const match of patch.matchAll(pattern)) {
    const path = match[1]?.trim();
    if (path) paths.push(path);
  }
  return paths;
}

export function toolWorkspacePaths(toolName: string, args: unknown, activePath?: string | null): string[] {
  const paths: string[] = [];
  collectPathValues(args, null, paths);
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    paths.push(...envelopePaths((args as Record<string, unknown>).patch));
  }
  if (ACTIVE_FILE_TOOLS.has(toolName) && activePath) paths.push(activePath);
  return Array.from(new Set(paths.map(normalizeWorkspaceFolder)));
}

export function workspaceScopeViolation(
  toolName: string,
  args: unknown,
  folders: readonly string[],
  activePath?: string | null,
): string | null {
  const scopes = normalizeWorkspaceFolders(folders);
  if (scopes.length === 0) return null;
  if (VAULT_WIDE_TOOLS.has(toolName)) {
    return `${toolName} can inspect vault-wide state and is disabled while Agent workspace folders are active.`;
  }
  const paths = toolWorkspacePaths(toolName, args, activePath);
  if (toolName === 'list_files' && paths.length === 0) {
    return `list_files must specify one of the allowed folders: ${scopes.join(', ')}`;
  }
  const outside = paths.filter(path => !isPathInWorkspace(path, scopes));
  return outside.length > 0
    ? `Agent workspace blocks ${outside.join(', ')}. Allowed folders: ${scopes.join(', ')}`
    : null;
}
