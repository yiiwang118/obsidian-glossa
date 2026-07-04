/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-duplicate-type-constituents, @typescript-eslint/only-throw-error, @typescript-eslint/no-unused-vars -- Dynamic plugin and host-app boundaries validate these values at runtime. */
import { ICON } from '../ui/icons';

export interface ToolMeta {
  icon: string;          // SVG string
  label: string;         // Short human label
  verb: string;          // Active form, e.g. "Reading" → shown while running
  color: string;         // Accent color for status pill
  category: 'read' | 'write' | 'search' | 'web' | 'meta' | 'system';
  summarize?: (args: AnyValue) => string;   // pull a key field out of args for the header line
}

export const TOOL_META: Record<string, ToolMeta> = {
  read_note: {
    icon: ICON.file, label: 'Read note', verb: 'Reading',
    color: '#5b9bff', category: 'read',
    summarize: a => a.path,
  },
  list_files: {
    icon: ICON.folder, label: 'List files', verb: 'Listing',
    color: '#5b9bff', category: 'read',
    summarize: a => a.folder || '/',
  },
  search_vault: {
    icon: ICON.globe, label: 'Search vault', verb: 'Searching',
    color: '#5b9bff', category: 'search',
    summarize: a => `"${a.query}"`,
  },
  grep_vault: {
    icon: ICON.globe, label: 'Grep vault', verb: 'Grepping',
    color: '#5b9bff', category: 'search',
    summarize: a => `/${a.pattern}/${a.flags ?? 'i'}`,
  },
  search_by_tag: {
    icon: ICON.tag, label: 'Find by tag', verb: 'Searching',
    color: '#5b9bff', category: 'search',
    summarize: a => a.tag,
  },
  semantic_search: {
    icon: ICON.brain, label: 'Semantic search', verb: 'Embedding-searching',
    color: '#b66cf0', category: 'search',
    summarize: a => `"${a.query}" (top ${a.top_k ?? 8})`,
  },
  get_active_file: {
    icon: ICON.file, label: 'Active file', verb: 'Loading active',
    color: '#5b9bff', category: 'read',
  },
  get_selection: {
    icon: ICON.selection, label: 'Get selection', verb: 'Reading selection',
    color: '#5b9bff', category: 'read',
  },
  view_image: {
    icon: ICON.file, label: 'View image', verb: 'Loading image',
    color: '#b66cf0', category: 'read',
    summarize: a => a.path,
  },
  read_pdf: {
    icon: ICON.file, label: 'Read PDF', verb: 'Extracting PDF',
    color: '#5b9bff', category: 'read',
    summarize: a => `${a.path}${a.pages ? ` (${a.pages})` : ''}`,
  },
  query_metadata: {
    icon: ICON.tag, label: 'Metadata', verb: 'Inspecting',
    color: '#5b9bff', category: 'meta',
    summarize: a => a.path,
  },
  write_note: {
    icon: ICON.file, label: 'Write note', verb: 'Writing',
    color: '#ff9d3d', category: 'write',
    summarize: a => a.path,
  },
  create_note: {
    icon: ICON.plus, label: 'Create note', verb: 'Creating',
    color: '#3fb950', category: 'write',
    summarize: a => a.path,
  },
  edit_section: {
    icon: ICON.apply, label: 'Edit section', verb: 'Editing',
    color: '#ff9d3d', category: 'write',
    summarize: a => a.path,
  },
  file_edit: {
    icon: ICON.apply, label: 'Edit file', verb: 'Editing',
    color: '#ff9d3d', category: 'write',
    summarize: a => `${a.file_path}${a.replace_all ? ' (all)' : ''}`,
  },
  apply_patch: {
    icon: ICON.apply, label: 'Apply patch', verb: 'Patching',
    color: '#ff9d3d', category: 'write',
    summarize: a => {
      // Envelope mode — count ops and pick the salient one
      if (typeof a?.patch === 'string' && /^\s*\*\*\* Begin Patch/.test(a.patch)) {
        const adds = (a.patch.match(/^\*\*\* Add File: (.+)$/gm) || []).length;
        const dels = (a.patch.match(/^\*\*\* Delete File: (.+)$/gm) || []).length;
        const upds = (a.patch.match(/^\*\*\* Update File: (.+)$/gm) || []).length;
        const total = adds + dels + upds;
        if (total === 1) {
          const m = a.patch.match(/^\*\*\* (Add File|Delete File|Update File): (.+)$/m);
          return m ? m[2].trim() : 'envelope';
        }
        return `${total} files (+${adds} ~${upds} -${dels})`;
      }
      // Legacy mode
      if (a?.path) return `${a.path} (${(a.edits ?? []).length} edits)`;
      return '(empty patch)';
    },
  },
  append_to_note: {
    icon: ICON.plus, label: 'Append', verb: 'Appending',
    color: '#ff9d3d', category: 'write',
    summarize: a => a.path,
  },
  delete_note: {
    icon: ICON.trash, label: 'Delete', verb: 'Deleting',
    color: '#f85149', category: 'write',
    summarize: a => a.path,
  },
  web_fetch: {
    icon: ICON.globe, label: 'Fetch web', verb: 'Fetching',
    color: '#b66cf0', category: 'web',
    summarize: a => a.url,
  },
  web_search: {
    icon: ICON.globe, label: 'Web search', verb: 'Searching web',
    color: '#4f7cff', category: 'web',
    summarize: a => `"${String(a.query ?? '').slice(0, 48)}"`,
  },
  web_research: {
    icon: ICON.globe, label: 'Web research', verb: 'Researching web',
    color: '#4f7cff', category: 'web',
    summarize: a => `"${String(a.goal ?? a.query ?? '').slice(0, 48)}"`,
  },
  download_file: {
    icon: ICON.file, label: 'Download', verb: 'Downloading',
    color: '#2f9e73', category: 'web',
    summarize: a => a.save_to || a.filename || a.url,
  },
  attempt_completion: {
    icon: ICON.check, label: 'Complete', verb: 'Wrapping up',
    color: '#3fb950', category: 'system',
  },
  todo_write: {
    icon: ICON.check, label: 'Plan', verb: 'Planning',
    color: '#5b9bff', category: 'system',
    summarize: a => `${(a.items ?? []).length} step${(a.items ?? []).length === 1 ? '' : 's'}`,
  },
  discover_skills: {
    icon: ICON.sparkles, label: 'Skills', verb: 'Finding skills',
    color: '#b66cf0', category: 'meta',
  },
  run_skill: {
    icon: ICON.sparkles, label: 'Skill', verb: 'Using skill',
    color: '#b66cf0', category: 'meta',
    summarize: a => a.name,
  },
  skill: {
    icon: ICON.sparkles, label: 'Skill', verb: 'Using skill',
    color: '#b66cf0', category: 'meta',
    summarize: a => `${a.skill}${a.args ? ` (${String(a.args).slice(0, 24)})` : ''}`,
  },
  tool_search: {
    icon: ICON.wrench, label: 'Tool search', verb: 'Searching tools',
    color: '#888', category: 'meta',
    summarize: a => `"${String(a.query ?? '').slice(0, 32)}"`,
  },

  // Phase 1 surgical tools.
  patch_note: {
    icon: ICON.apply, label: 'Patch note', verb: 'Patching',
    color: '#ff9d3d', category: 'write',
    summarize: a => {
      const t = a?.target ?? {};
      const where = t.heading ? `## ${String(t.heading).replace(/^#+\s*/, '')}`
                  : t.block_ref ? `^${t.block_ref}`
                  : t.frontmatter_key ? `prop.${t.frontmatter_key}`
                  : '?';
      return `${a.op ?? '?'} · ${where} · ${a.path}`;
    },
  },
  manage_frontmatter: {
    icon: ICON.tag, label: 'Frontmatter', verb: 'Editing frontmatter',
    color: '#ff9d3d', category: 'write',
    summarize: a => `${a.op}${a.key ? `.${a.key}` : ''} · ${a.path}`,
  },
  manage_tags: {
    icon: ICON.tag, label: 'Tags', verb: 'Editing tags',
    color: '#ff9d3d', category: 'write',
    summarize: a => `${a.op} · ${a.path}${Array.isArray(a.tags) ? ` (${a.tags.length})` : ''}`,
  },
  rename_note: {
    icon: ICON.apply, label: 'Rename', verb: 'Renaming',
    color: '#ff9d3d', category: 'write',
    summarize: a => `${a.from} → ${a.to}`,
  },
  resolve_wikilink: {
    icon: ICON.tag, label: 'Resolve link', verb: 'Resolving',
    color: '#5b9bff', category: 'meta',
    summarize: a => `[[${a.link}]]`,
  },
  get_backlinks: {
    icon: ICON.tag, label: 'Backlinks', verb: 'Listing backlinks',
    color: '#5b9bff', category: 'meta',
    summarize: a => a.path,
  },
  get_outgoing_links: {
    icon: ICON.tag, label: 'Outgoing links', verb: 'Listing links',
    color: '#5b9bff', category: 'meta',
    summarize: a => a.path,
  },
  list_tags: {
    icon: ICON.tag, label: 'List tags', verb: 'Listing tags',
    color: '#5b9bff', category: 'meta',
  },
  get_periodic_note: {
    icon: ICON.file, label: 'Periodic note', verb: 'Resolving periodic',
    color: '#5b9bff', category: 'read',
    summarize: a => `${a.type ?? 'daily'}${a.offset ? ` (${a.offset > 0 ? '+' : ''}${a.offset})` : ''}`,
  },
  read_canvas: {
    icon: ICON.file, label: 'Read canvas', verb: 'Reading canvas',
    color: '#5b9bff', category: 'read',
    summarize: a => a.path,
  },
  patch_canvas: {
    icon: ICON.apply, label: 'Patch canvas', verb: 'Patching canvas',
    color: '#ff9d3d', category: 'write',
    summarize: a => `${a.op} · ${a.path}`,
  },

  // Phase 2 workspace tools.
  open_in_editor: {
    icon: ICON.file, label: 'Open file', verb: 'Opening',
    color: '#5b9bff', category: 'system',
    summarize: a => {
      const tail = a?.to?.line ? ` :L${a.to.line}`
                 : a?.to?.heading ? ` # ${a.to.heading}`
                 : a?.to?.block ? ` ^${a.to.block}`
                 : '';
      return `${a.path}${tail}${a?.leaf && a.leaf !== 'active' ? `  [${a.leaf}]` : ''}`;
    },
  },
  set_selection: {
    icon: ICON.selection, label: 'Set selection', verb: 'Selecting',
    color: '#5b9bff', category: 'system',
    summarize: a => a?.heading ? `# ${a.heading}` : a?.block ? `^${a.block}` : 'range',
  },
  list_open_files: {
    icon: ICON.folder, label: 'Open tabs', verb: 'Listing tabs',
    color: '#5b9bff', category: 'meta',
  },
  execute_command: {
    icon: ICON.wrench, label: 'Run command', verb: 'Dispatching',
    color: '#ff9d3d', category: 'system',
    summarize: a => a?.command_id ?? '?',
  },
  list_commands: {
    icon: ICON.wrench, label: 'List commands', verb: 'Listing commands',
    color: '#5b9bff', category: 'meta',
    summarize: a => a?.filter ? `"${a.filter}"` : '(all)',
  },

  // Phase 3 plugin bridges.
  dataview_query: {
    icon: ICON.brain, label: 'Dataview', verb: 'Querying Dataview',
    color: '#b66cf0', category: 'search',
    summarize: a => `${a.mode ?? 'query'}: ${String(a.query ?? a.source ?? '').slice(0, 40)}`,
  },
  templater_render: {
    icon: ICON.apply, label: 'Templater', verb: 'Rendering template',
    color: '#b66cf0', category: 'write',
    summarize: a => `${a.mode ?? '?'} · ${a.template_path}`,
  },
  tasks_query: {
    icon: ICON.check, label: 'Tasks query', verb: 'Querying tasks',
    color: '#b66cf0', category: 'search',
    summarize: a => String(a.query ?? '').replace(/\n/g, ' · ').slice(0, 50),
  },
  bases_query: {
    icon: ICON.brain, label: 'Bases query', verb: 'Querying base',
    color: '#b66cf0', category: 'search',
    summarize: a => `${a.base_path}${a.view ? `  [${a.view}]` : ''}`,
  },
};

export function metaFor(name: string): ToolMeta {
  return TOOL_META[name] ?? {
    icon: ICON.wrench, label: name, verb: 'Running',
    color: '#888', category: 'system',
  };
}

/* ─── Per-tool render dispatchers ────────────────────────────────────────── */
/** UI integration points (P3-15). Each dispatcher first consults the tool's
 *  own render hook (set on `ToolImpl`), falling back to TOOL_META heuristics
 *  when no hook is defined. Returning `null` means "no custom rendering —
 *  caller should use default markdown/diff path". */
import { getTool } from './tools';

/** Header text shown above the tool card while it runs.
 *  Returns null to let the caller use its own default formatting. */
export function renderToolUseMessage(name: string, args: AnyValue): HTMLElement | string | null {
  const tool = getTool(name);
  if (tool?.renderToolUseMessage) {
    try { return tool.renderToolUseMessage(args); } catch (e) { console.warn('[tool render] use threw', e); }
  }
  // Default: `<verb> <summary>` (e.g. "Reading Foo.md").
  const meta = metaFor(name);
  const summary = tool?.getToolUseSummary?.(args) ?? meta.summarize?.(args) ?? '';
  return summary ? `${meta.verb} ${summary}` : meta.verb;
}

/** Result block renderer. Returns null to use the default markdown renderer. */
export function renderToolResultMessage(name: string, result: string, args: AnyValue): HTMLElement | string | null {
  const tool = getTool(name);
  if (tool?.renderToolResultMessage) {
    try { return tool.renderToolResultMessage(result, args); } catch (e) { console.warn('[tool render] result threw', e); }
  }
  return null;
}

/** Rejected-call renderer (user denied approval). */
export function renderToolUseRejectedMessage(name: string, args: AnyValue): HTMLElement | string | null {
  const tool = getTool(name);
  if (tool?.renderToolUseRejectedMessage) {
    try { return tool.renderToolUseRejectedMessage(args); } catch (e) { console.warn('[tool render] rejected threw', e); }
  }
  return `Tool "${name}" denied by user.`;
}

/** Errored-call renderer. */
export function renderToolUseErrorMessage(name: string, error: string, args: AnyValue): HTMLElement | string | null {
  const tool = getTool(name);
  if (tool?.renderToolUseErrorMessage) {
    try { return tool.renderToolUseErrorMessage(error, args); } catch (e) { console.warn('[tool render] error threw', e); }
  }
  return null;
}

/** Activity description for spinner (e.g. "Reading Foo.md…"). Prefers tool's
 *  own hook; falls back to `${verb} ${summary}` from TOOL_META. */
export function activityDescriptionFor(name: string, args: AnyValue): string {
  const tool = getTool(name);
  if (tool?.getActivityDescription) {
    try {
      const v = tool.getActivityDescription(args);
      if (v) return v;
    } catch (e) { console.warn('[tool render] activity threw', e); }
  }
  const meta = metaFor(name);
  const summary = tool?.getToolUseSummary?.(args) ?? meta.summarize?.(args) ?? '';
  return summary ? `${meta.verb} ${summary}` : meta.verb;
}
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-duplicate-type-constituents, @typescript-eslint/only-throw-error, @typescript-eslint/no-unused-vars -- Re-enable review lint rules after dynamic boundary module. */
