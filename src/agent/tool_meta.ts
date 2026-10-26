import { ICON } from '../ui/icons';
import { bi } from '../utils/i18n';

export interface ToolMeta {
  icon: string;          // SVG string
  label: string;         // Short human label
  verb: string;          // Active form, e.g. "Reading" → shown while running
  color: string;         // Accent color for status pill
  category: 'read' | 'write' | 'search' | 'web' | 'meta' | 'system';
  summarize?: (args: AnyValue) => string;   // pull a key field out of args for the header line
}

/** Labels and verbs are [English, Chinese], picked when shown so a language
 *  change applies without reloading. */
type ToolMetaEntry = Omit<ToolMeta, 'label' | 'verb'> & { label: [string, string]; verb: [string, string] };

export const TOOL_META: Record<string, ToolMetaEntry> = {
  read_note: {
    icon: ICON.file, label: ['Read note', '读取笔记'], verb: ['Reading', '正在读取'],
    color: '#5b9bff', category: 'read',
    summarize: a => a.path,
  },
  read_files: {
    icon: ICON.file, label: ['Read files', '读取文件'], verb: ['Reading files', '正在读取文件'],
    color: '#5b9bff', category: 'read',
    summarize: a => { const n = Array.isArray(a.requests) ? a.requests.length : 0; return bi(`${n} files`, `${n} 个文件`); },
  },
  list_files: {
    icon: ICON.folder, label: ['List files', '列出文件'], verb: ['Browsing folder', '正在浏览文件夹'],
    color: '#5b9bff', category: 'read',
    summarize: a => a.folder || '/',
  },
  get_active_file: {
    icon: ICON.file, label: ['Active file', '当前文件'], verb: ['Loading active', '正在读取当前文件'],
    color: '#5b9bff', category: 'read',
  },
  get_selection: {
    icon: ICON.selection, label: ['Get selection', '读取选中'], verb: ['Reading selection', '正在读取选中内容'],
    color: '#5b9bff', category: 'read',
  },
  view_image: {
    icon: ICON.image, label: ['View image', '查看图片'], verb: ['Loading image', '正在加载图片'],
    color: '#b66cf0', category: 'read',
    summarize: a => a.path,
  },
  read_pdf: {
    icon: ICON.file, label: ['Read PDF', '读取 PDF'], verb: ['Extracting PDF', '正在提取 PDF'],
    color: '#5b9bff', category: 'read',
    summarize: a => `${a.path}${a.pages ? ` (${a.pages})` : ''}`,
  },
  query_metadata: {
    icon: ICON.tag, label: ['Metadata', '元数据'], verb: ['Inspecting', '正在检查'],
    color: '#5b9bff', category: 'meta',
    summarize: a => a.path,
  },
  write_note: {
    icon: ICON.file, label: ['Write note', '写入笔记'], verb: ['Writing', '正在写入'],
    color: '#ff9d3d', category: 'write',
    summarize: a => a.path,
  },
  create_note: {
    icon: ICON.plus, label: ['Create note', '新建笔记'], verb: ['Creating', '正在新建'],
    color: '#3fb950', category: 'write',
    summarize: a => a.path,
  },
  edit_section: {
    icon: ICON.pencil, label: ['Edit section', '编辑段落'], verb: ['Editing', '正在编辑'],
    color: '#ff9d3d', category: 'write',
    summarize: a => a.path,
  },
  file_edit: {
    icon: ICON.pencil, label: ['Edit file', '编辑文件'], verb: ['Editing', '正在编辑'],
    color: '#ff9d3d', category: 'write',
    summarize: a => `${a.file_path}${a.replace_all ? bi(' (all)', '（全部）') : ''}`,
  },
  apply_patch: {
    icon: ICON.pencil, label: ['Apply patch', '应用补丁'], verb: ['Patching', '正在应用补丁'],
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
        return bi(`${total} files (+${adds} ~${upds} -${dels})`, `${total} 个文件（+${adds} ~${upds} -${dels}）`);
      }
      // Legacy mode
      if (a?.path) return bi(`${a.path} (${(a.edits ?? []).length} edits)`, `${a.path}（${(a.edits ?? []).length} 处修改）`);
      return bi('(empty patch)', '（空补丁）');
    },
  },
  append_to_note: {
    icon: ICON.plus, label: ['Append', '追加'], verb: ['Appending', '正在追加'],
    color: '#ff9d3d', category: 'write',
    summarize: a => a.path,
  },
  create_folder: {
    icon: ICON.folder, label: ['Create folder', '新建文件夹'], verb: ['Creating folder', '正在新建文件夹'],
    color: '#3fb950', category: 'write',
    summarize: a => a.path,
  },
  delete_note: {
    icon: ICON.trash, label: ['Delete', '删除'], verb: ['Deleting', '正在删除'],
    color: '#f85149', category: 'write',
    summarize: a => a.path,
  },
  web_fetch: {
    icon: ICON.globe, label: ['Fetch web', '抓取网页'], verb: ['Fetching', '正在抓取'],
    color: '#b66cf0', category: 'web',
    summarize: a => a.url,
  },
  web_search: {
    icon: ICON.globe, label: ['Web search', '网页搜索'], verb: ['Searching web', '正在搜索网页'],
    color: '#4f7cff', category: 'web',
    summarize: a => `"${String(a.query ?? '').slice(0, 48)}"`,
  },
  web_research: {
    icon: ICON.globe, label: ['Web research', '网页调研'], verb: ['Researching web', '正在调研网页'],
    color: '#4f7cff', category: 'web',
    summarize: a => `"${String(a.goal ?? a.query ?? '').slice(0, 48)}"`,
  },
  download_file: {
    icon: ICON.file, label: ['Download', '下载'], verb: ['Downloading', '正在下载'],
    color: '#2f9e73', category: 'web',
    summarize: a => a.save_to || a.filename || a.url,
  },
  attempt_completion: {
    icon: ICON.check, label: ['Complete', '完成'], verb: ['Wrapping up', '正在收尾'],
    color: '#3fb950', category: 'system',
  },
  todo_write: {
    icon: ICON.check, label: ['Plan', '计划'], verb: ['Planning', '正在规划'],
    color: '#5b9bff', category: 'system',
    summarize: a => { const n = (a.items ?? []).length; return bi(`${n} step${n === 1 ? '' : 's'}`, `${n} 步`); },
  },
  discover_skills: {
    icon: ICON.sparkles, label: ['Skills', '技能'], verb: ['Finding skills', '正在查找技能'],
    color: '#b66cf0', category: 'meta',
  },
  run_skill: {
    icon: ICON.sparkles, label: ['Skill', '技能'], verb: ['Using skill', '正在使用技能'],
    color: '#b66cf0', category: 'meta',
    summarize: a => a.name,
  },
  skill: {
    icon: ICON.sparkles, label: ['Skill', '技能'], verb: ['Using skill', '正在使用技能'],
    color: '#b66cf0', category: 'meta',
    summarize: a => `${a.skill}${a.args ? ` (${String(a.args).slice(0, 24)})` : ''}`,
  },
  tool_search: {
    icon: ICON.wrench, label: ['Tool search', '搜索工具'], verb: ['Searching tools', '正在搜索工具'],
    color: '#888', category: 'meta',
    summarize: a => `"${String(a.query ?? '').slice(0, 32)}"`,
  },
  context_prune: {
    icon: ICON.wrench, label: ['Prune context', '裁剪上下文'], verb: ['Pruning context', '正在裁剪上下文'],
    color: '#888', category: 'system',
    summarize: a => String(a.mode ?? 'selected'),
  },
  validate_skill: {
    icon: ICON.sparkles, label: ['Validate skill', '校验技能'], verb: ['Validating skill', '正在校验技能'],
    color: '#b66cf0', category: 'meta',
    summarize: a => String(a.skill ?? ''),
  },

  // Phase 1 surgical tools.
  patch_note: {
    icon: ICON.pencil, label: ['Patch note', '修改笔记'], verb: ['Patching', '正在修改'],
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
    icon: ICON.tag, label: ['Frontmatter', '属性'], verb: ['Editing frontmatter', '正在编辑属性'],
    color: '#ff9d3d', category: 'write',
    summarize: a => `${a.op}${a.key ? `.${a.key}` : ''} · ${a.path}`,
  },
  manage_tags: {
    icon: ICON.tag, label: ['Tags', '标签'], verb: ['Editing tags', '正在编辑标签'],
    color: '#ff9d3d', category: 'write',
    summarize: a => `${a.op} · ${a.path}${Array.isArray(a.tags) ? ` (${a.tags.length})` : ''}`,
  },
  rename_note: {
    icon: ICON.pencil, label: ['Rename', '重命名'], verb: ['Renaming', '正在重命名'],
    color: '#ff9d3d', category: 'write',
    summarize: a => `${a.from} → ${a.to}`,
  },
  resolve_wikilink: {
    icon: ICON.link, label: ['Resolve link', '解析链接'], verb: ['Resolving', '正在解析'],
    color: '#5b9bff', category: 'meta',
    summarize: a => `[[${a.link}]]`,
  },
  get_backlinks: {
    icon: ICON.link, label: ['Backlinks', '反向链接'], verb: ['Listing backlinks', '正在列出反向链接'],
    color: '#5b9bff', category: 'meta',
    summarize: a => a.path,
  },
  get_outgoing_links: {
    icon: ICON.link, label: ['Outgoing links', '出链'], verb: ['Listing links', '正在列出链接'],
    color: '#5b9bff', category: 'meta',
    summarize: a => a.path,
  },
  get_periodic_note: {
    icon: ICON.file, label: ['Periodic note', '周期笔记'], verb: ['Resolving periodic', '正在定位周期笔记'],
    color: '#5b9bff', category: 'read',
    summarize: a => `${a.type ?? 'daily'}${a.offset ? ` (${a.offset > 0 ? '+' : ''}${a.offset})` : ''}`,
  },
  read_canvas: {
    icon: ICON.file, label: ['Read canvas', '读取白板'], verb: ['Reading canvas', '正在读取白板'],
    color: '#5b9bff', category: 'read',
    summarize: a => a.path,
  },
  patch_canvas: {
    icon: ICON.pencil, label: ['Patch canvas', '修改白板'], verb: ['Patching canvas', '正在修改白板'],
    color: '#ff9d3d', category: 'write',
    summarize: a => `${a.op} · ${a.path}`,
  },

  // Phase 2 workspace tools.
  open_in_editor: {
    icon: ICON.file, label: ['Open file', '打开文件'], verb: ['Opening', '正在打开'],
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
    icon: ICON.selection, label: ['Set selection', '设置选区'], verb: ['Selecting', '正在选择'],
    color: '#5b9bff', category: 'system',
    summarize: a => a?.heading ? `# ${a.heading}` : a?.block ? `^${a.block}` : 'range',
  },
  list_open_files: {
    icon: ICON.folder, label: ['Open tabs', '打开的标签页'], verb: ['Listing tabs', '正在列出标签页'],
    color: '#5b9bff', category: 'meta',
  },
  // Phase 3 plugin bridges.
  dataview_query: {
    icon: ICON.database, label: ['Dataview', 'Dataview'], verb: ['Querying Dataview', '正在查询 Dataview'],
    color: '#b66cf0', category: 'search',
    summarize: a => `${a.mode ?? 'query'}: ${String(a.query ?? a.source ?? '').slice(0, 40)}`,
  },
  templater_render: {
    icon: ICON.pencil, label: ['Templater', 'Templater'], verb: ['Rendering template', '正在渲染模板'],
    color: '#b66cf0', category: 'write',
    summarize: a => `${a.mode ?? '?'} · ${a.template_path}`,
  },
  tasks_query: {
    icon: ICON.check, label: ['Tasks query', 'Tasks 查询'], verb: ['Querying tasks', '正在查询任务'],
    color: '#b66cf0', category: 'search',
    summarize: a => String(a.query ?? '').replace(/\n/g, ' · ').slice(0, 50),
  },
};

export function metaFor(name: string): ToolMeta {
  const entry = TOOL_META[name];
  if (!entry) return { icon: ICON.wrench, label: name, verb: bi('Running', '正在运行'), color: '#888', category: 'system' };
  return { ...entry, label: bi(...entry.label), verb: bi(...entry.verb) };
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
  return bi(`Tool "${name}" denied by user.`, `已拒绝工具「${name}」。`);
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
