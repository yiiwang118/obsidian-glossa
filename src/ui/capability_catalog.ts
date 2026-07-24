import { TOOLS, listToolSpecs } from '../agent/tools';
import { metaFor, type ToolMeta } from '../agent/tool_meta';

export interface ToolCapability {
  name: string;
  labelEn: string;
  labelZh: string;
  descriptionEn: string;
  descriptionZh: string;
  category: ToolMeta['category'];
  icon: string;
  dangerous: boolean;
  deferred: boolean;
  autoApproved: boolean;
}

interface ToolChineseCopy {
  label: string;
  description: string;
}

const TOOL_ZH: Record<string, ToolChineseCopy> = {
  read_note: { label: '读取笔记', description: '读取指定笔记的内容，可按行、标题或块精确定位。' },
  read_files: { label: '批量读取', description: '在一次调用中读取多个明确指定的文件，减少重复往返。' },
  list_files: { label: '浏览目录', description: '列出指定 vault 目录内的文件路径，支持递归、glob 和数量限制。' },
  get_active_file: { label: '当前文件', description: '获取当前编辑器中打开的文件，帮助理解“这篇”“当前笔记”等指代。' },
  get_selection: { label: '读取选中内容', description: '获取当前编辑器或阅读视图中的选中文本。' },
  query_metadata: { label: '查询元数据', description: '读取文件属性、标签、标题和缓存元数据，不修改内容。' },
  write_note: { label: '写入笔记', description: '写入完整笔记内容，适合新内容或用户明确要求的整体替换。' },
  create_note: { label: '创建笔记', description: '在 vault 中创建新笔记，并避免无意覆盖已有文件。' },
  edit_section: { label: '编辑章节', description: '按标题定位并替换单个章节，保留笔记其余部分。' },
  append_to_note: { label: '追加内容', description: '把内容追加到指定笔记末尾。' },
  delete_note: { label: '删除笔记', description: '删除指定 vault 文件；执行前需要明确审批。' },
  file_edit: { label: '精确编辑', description: '用可验证的原文匹配完成单处或多处精确替换。' },
  apply_patch: { label: '应用补丁', description: '通过结构化补丁完成多段或多文件编辑，并保留最小改动范围。' },
  todo_write: { label: '任务计划', description: '维护多步骤任务的计划、进度和当前执行状态。' },
  attempt_completion: { label: '完成任务', description: '在满足验收条件后结束 Agent 任务。' },
  view_image: { label: '查看图片', description: '按描述、OCR、界面、图表、裁剪或像素取色模式检查图片。' },
  read_pdf: { label: '读取 PDF', description: '按任务选择页面、搜索文本，并检查论文、公式、表格、图片或扫描件。' },
  web_research: { label: '网页研究', description: '围绕一个目标进行多来源搜索、阅读与带来源的综合整理。' },
  web_search: { label: '网页搜索', description: '搜索网页并返回可继续读取的相关结果。' },
  web_fetch: { label: '读取网页', description: '抓取指定网页并提取适合模型阅读的正文内容。' },
  download_file: { label: '下载文件', description: '把明确的网络文件下载到 vault 内，并可保存来源记录。' },
  skill: { label: '运行 Skill', description: '按需加载并执行匹配任务的 Skill 工作流，而不是把全部说明常驻上下文。' },
  tool_search: { label: '查找工具', description: '根据当前任务查找并加载专业工具的 schema，减少默认上下文占用。' },
  context_prune: { label: '精简上下文', description: '移除模型侧已过期的工具结果，同时保留可见对话记录。' },
  validate_skill: { label: '校验 Skill', description: '检查 Skill 的命名、触发条件、工作流、工具声明和完成标准。' },
  discover_skills: { label: '发现 Skills', description: '发现 vault 与内置 Skills，供旧会话兼容使用。' },
  run_skill: { label: '执行 Skill', description: '执行指定 Skill，供旧会话兼容使用。' },
  patch_note: { label: '局部修改笔记', description: '按标题、块引用或属性键对笔记做结构化局部修改。' },
  manage_frontmatter: { label: '管理属性', description: '读取、设置、删除或合并 YAML frontmatter 属性。' },
  manage_tags: { label: '管理标签', description: '添加、删除或替换笔记中的属性标签与行内标签。' },
  rename_note: { label: '重命名笔记', description: '重命名或移动笔记，并按 vault 规则维护相关链接。' },
  resolve_wikilink: { label: '解析双链', description: '把 wikilink 解析为真实文件路径，并处理标题或块引用。' },
  get_backlinks: { label: '查询反向链接', description: '列出链接到指定笔记的来源与相关上下文。' },
  get_outgoing_links: { label: '查询出链', description: '列出指定笔记指向的内部链接、嵌入与目标状态。' },
  get_periodic_note: { label: '周期笔记', description: '按日、周、月等周期和偏移量定位对应笔记。' },
  read_canvas: { label: '读取 Canvas', description: '解析 Canvas 的节点、边、分组与空间布局。' },
  patch_canvas: { label: '修改 Canvas', description: '用小范围操作添加、更新或删除 Canvas 节点和连线。' },
  open_in_editor: { label: '在编辑器打开', description: '在合适的工作区叶片中打开文件，并可跳转到行、标题或块。' },
  set_selection: { label: '设置选区', description: '在打开的编辑器中定位并选中指定范围、标题或块。' },
  list_open_files: { label: '列出打开文件', description: '查看当前工作区已打开的文件与活动标签页。' },
  dataview_query: { label: 'Dataview 查询', description: '在安装 Dataview 时执行受控查询并返回结构化结果。' },
  templater_render: { label: 'Templater 渲染', description: '在安装 Templater 时预览或写入模板渲染结果。' },
  tasks_query: { label: 'Tasks 查询', description: '在安装 Tasks 时查询任务并返回结构化结果。' },
};

export const TOOL_CATEGORY_ORDER: ToolMeta['category'][] = [
  'read', 'search', 'web', 'write', 'meta', 'system',
];

export const TOOL_CATEGORY_COPY: Record<ToolMeta['category'], { en: string; zh: string }> = {
  read: { en: 'Read', zh: '读取' },
  search: { en: 'Query', zh: '查询' },
  web: { en: 'Web', zh: '网络' },
  write: { en: 'Edit', zh: '编辑' },
  meta: { en: 'Discover', zh: '发现' },
  system: { en: 'Control', zh: '控制' },
};

export function buildToolCapabilities(alwaysApprove: readonly string[]): ToolCapability[] {
  const initial = new Set(listToolSpecs().map(spec => spec.name));
  const all = listToolSpecs({ includeDeferred: true });
  const approved = new Set(alwaysApprove);
  return all.map(spec => {
    const tool = TOOLS[spec.name];
    const meta = metaFor(spec.name);
    const zh = TOOL_ZH[spec.name] ?? {
      label: meta.label,
      description: `调用 ${spec.name} 完成对应任务。`,
    };
    return {
      name: spec.name,
      labelEn: meta.label,
      labelZh: zh.label,
      descriptionEn: spec.description,
      descriptionZh: zh.description,
      category: meta.category,
      icon: meta.icon,
      dangerous: tool.dangerous,
      deferred: !initial.has(spec.name),
      autoApproved: approved.has(spec.name),
    };
  }).sort((a, b) => {
    const category = TOOL_CATEGORY_ORDER.indexOf(a.category) - TOOL_CATEGORY_ORDER.indexOf(b.category);
    return category || Number(a.deferred) - Number(b.deferred) || a.name.localeCompare(b.name);
  });
}

export function toolCatalogIssues(): string[] {
  return listToolSpecs({ includeDeferred: true })
    .map(spec => spec.name)
    .filter(name => !TOOL_ZH[name])
    .map(name => `${name}: missing Chinese capability copy`);
}

export const BUNDLED_SKILL_ZH: Record<string, { title: string; description: string; whenToUse: string }> = {
  'obsidian-markdown': {
    title: 'Markdown 编辑',
    description: '在保留双链、属性、数学公式、Callout 与原有结构的前提下编辑 vault Markdown。',
    whenToUse: '适用于涉及 vault 特有 Markdown 语法的任务；普通文字润色无需加载。',
  },
  'obsidian-canvas': {
    title: 'Canvas 编辑',
    description: '安全检查和编辑 Canvas 节点、连线、ID 与空间布局。',
    whenToUse: '目标为 .canvas 文件，或用户要求修改 Canvas 图时加载。',
  },
  'obsidian-bases': {
    title: 'Bases 编辑',
    description: '编辑 Bases 的 YAML 筛选、属性、公式、汇总和视图，不扰动无关配置。',
    whenToUse: '仅在读取或编辑 .base 文件时加载。',
  },
  'pdf-analysis': {
    title: 'PDF 分析',
    description: '根据任务选择页面，分析论文、报告、书籍、扫描件、公式和图表，并保留证据位置。',
    whenToUse: '适用于 PDF 的检索、总结、阅读或深入分析。',
  },
  'image-analysis': {
    title: '图片分析',
    description: '检查截图、图表、OCR 文本、局部裁剪和精确像素颜色。',
    whenToUse: '适用于需要理解图片、截图、图表或局部视觉细节的任务。',
  },
  'skill-creator': {
    title: 'Skill 创建器',
    description: '创建、更新并审核触发准确、流程精炼、工具声明安全且可验证的 vault Skill。',
    whenToUse: '用户要求创建或改进 Skill、SKILL.md、触发条件或工作流时加载。',
  },
};
