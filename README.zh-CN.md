<div align="center">

# Glossa

### 理解你的知识库，也尊重每一次修改。

一个本地优先的 AI 工作侧栏：阅读真实笔记、研究公开资料、处理 PDF 与图片，并在清楚可见的审批下修改文件。

[![安装](https://img.shields.io/badge/安装-插件市场-7C3AED?style=for-the-badge)](https://obsidian.md/plugins?id=glossa)
[![版本](https://img.shields.io/github/v/release/yiiwang118/obsidian-glossa?display_name=tag&sort=semver&style=for-the-badge)](https://github.com/yiiwang118/obsidian-glossa/releases/latest)
[![检查](https://img.shields.io/github/actions/workflow/status/yiiwang118/obsidian-glossa/ci.yml?branch=main&style=for-the-badge&label=checks)](https://github.com/yiiwang118/obsidian-glossa/actions/workflows/ci.yml)
[![协议](https://img.shields.io/badge/License-MIT-111827?style=for-the-badge)](LICENSE)

[English](README.md) · [最新版本](https://github.com/yiiwang118/obsidian-glossa/releases/latest) · [更新记录](CHANGELOG.md)

<img src="docs/assets/glossa-hero.png" alt="Glossa AI 侧栏正在处理笔记" width="100%">

</div>

Glossa 不是一个和笔记割裂的聊天框，而是一块真正能工作的侧栏。当前笔记可以自然进入上下文；你明确附加的文件会保持为任务目标；任何文件修改都会经过可见工具、权限判断和审批流程。

## Glossa 能做什么

| | 能力 | 实际体验 |
|---|---|---|
| 🧠 | **理解上下文** | 直接处理当前笔记、选区、附件、PDF、图片和上一轮任务状态，不必反复复制内容。 |
| ✍️ | **精确修改文件** | 修改一个章节、替换精确文本、协调多文件变更，并保留无关 Markdown，而不是动不动重写全文。 |
| 📚 | **认真阅读文档** | 按页理解论文、搜索 PDF 正文、渲染视觉页面，并对截图执行 OCR、图表分析和 UI 细节检查。 |
| 🌐 | **研究公开资料** | 有边界地搜索和提取网页，核对论文身份，验证下载内容，并保存带来源信息的真实文件。 |
| 🧩 | **运行聚焦 Skills** | 使用 Markdown、Canvas、Bases、PDF、图片工作流，也可以创建并校验自己的 Vault Skill。 |
| 🔐 | **让操作可追踪** | 从只读开始，逐项审批写入，查看工具结果，并在修改不合适时恢复 checkpoint。 |

## 最近更新

- **2026-07-17 — ![NEW](https://img.shields.io/badge/NEW-EF4444?style=flat-square) 设置搜索与发布检查终于和宿主保持一致。** [`0.6.11`](https://github.com/yiiwang118/obsidian-glossa/releases/tag/0.6.11) 接入 1.13 声明式设置索引，模型、翻译、Agent、上下文、工具、隐私和存储选项都能从设置搜索中找到，同时保留 Glossa 原有的任务分区界面。选区几何计算在目录扫描器下保持完整类型，旧设置控件已替换；GitHub Actions 会重新构建并验证三个标准 Release 文件，但不再生成插件目录校验器无法接受的共享多文件 attestation。本版本要求应用版本不低于 1.13.0。
- **2026-07-17 — ![NEW](https://img.shields.io/badge/NEW-EF4444?style=flat-square) 翻译留在选区旁，不再占用一轮聊天记录。** [`0.6.10`](https://github.com/yiiwang118/obsidian-glossa/releases/tag/0.6.10) 支持选中文本后连续按两次 Enter，或绑定任意软件快捷键，在原文附近打开流式翻译浮层。论文标题与技术术语的中英文方向判断更准确；PDF 视觉换行会被清理，但真实段落、Markdown、公式、代码、URL 和引用仍会保留；翻译还可以使用独立于侧栏的端点与模型。保存翻译和 PDF 图标暂不进入本次发布，继续在独立分支优化交互。
- **2026-07-13 — ![NEW](https://img.shields.io/badge/NEW-EF4444?style=flat-square) ✅ 社区规范检查真正进入发布流程。** [`0.6.9`](https://github.com/yiiwang118/obsidian-glossa/releases/tag/0.6.9) 把官方 `eslint-plugin-obsidianmd` 规则加入零 warning 门禁，并与严格 TypeScript lint、自动测试、依赖审计、生产构建、源码审查、CSS 兼容性和发布元数据检查一起执行。设置标题与 DOM helper 现在遵循宿主规范；原生 HTTP 和 DNS fallback 会验证每一个穿过 Node 边界的值；哈希改用 Web Crypto；回归测试则持续保护浏览器优先请求、私网地址拦截和旧 WebView CSS 兼容性。
- **2026-07-12 — ![NEW](https://img.shields.io/badge/NEW-EF4444?style=flat-square) 🎛️ 设置终于可以快速看懂。** [`0.6.8`](https://github.com/yiiwang118/obsidian-glossa/releases/tag/0.6.8) 将配置重组为五个按任务划分的区域：常规、模型与网络、Agent、工具与 Skills、数据与高级。紧凑状态栏始终显示当前模型、模式和 Auto/EN/中文语言控制；全局统一的键盘友好选择器，让文字、勾选标记、箭头和行高保持对齐。
- **2026-07-12 — ![NEW](https://img.shields.io/badge/NEW-EF4444?style=flat-square) 🧩 信任一个工具或 Skill 之前，先看清它能做什么。** 新的可搜索能力目录会标明默认加载与按需加载工具、自动执行范围、审批要求和只读属性。内置 Skill 与 Vault Skill 也会展示来源、触发提示、依赖工具和校验状态，不再像一个不透明的提示词目录。
- **2026-07-12 — ![NEW](https://img.shields.io/badge/NEW-EF4444?style=flat-square) 🧠 思考档位不再替你做隐式决定。** 可以选择 `off`、`none`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max` 或 `ultra`。OpenAI-compatible 请求会原样发送所选值，`off` 会省略字段，Anthropic-style 端点使用明确预算；模型或网关不支持时，会保留真实服务端错误并指出实际发送的档位。导出对话和设置也改成了独立顶部按钮。
- **2026-07-10 — 📌 当前笔记是自然上下文，不是必须先选中的材料。** [`0.6.7`](https://github.com/yiiwang118/obsidian-glossa/releases/tag/0.6.7) 让总结、解释、翻译和分析请求可以自动使用当前 Markdown 笔记；明确选区或附件指定其他目标时仍然优先。“继续”“用中文”“放到下面”等短追问会保留上一轮标题、URL、输出目录、失败原因和真正任务对象。
- **2026-07-10 — ⚙️ 更小的 Prompt 可以完成更多工作。** 专用 schema 会等到 `tool_search` 或当前 Skill 真正需要时再加载；`read_note` 支持精确行范围，`read_files` 一次可读取最多 8 个已知文件。过期读取和搜索证据可以退出模型上下文，但可见聊天、写入确认、下载、计划、失败和 Skill 状态都会保留；重复失败必须换策略，完全相同的调用循环会被提前终止。
- **2026-07-10 — 📚 论文、图片和公式按任务类型认真处理。** PDF 可以核对身份、总结、搜索概念、读取页码范围，或为公式、表格、图形和扫描页渲染视觉证据；图片可以在描述、OCR、UI 审查、图表分析、局部裁剪和精确颜色采样之间切换。公式归一化会修复历史 `\(...\)` 与 `\[...\]`，同时保护代码；有界缓存则加快重复媒体检查。
- **2026-07-10 — 🛠️ 六个聚焦 Skill 自带校验，不靠仪式感。** Glossa 内置 `obsidian-markdown`、`obsidian-canvas`、`obsidian-bases`、`pdf-analysis`、`image-analysis` 和 `skill-creator`。Skill Creator 使用正向与负向触发样例，选择合适约束，编写聚焦的 `SKILL.md`，并在启用前检查命名、触发条件、路径安全、工作流结构与工具引用。

<details>
<summary><strong>更早的更新</strong>（2026-04-08 至 2026-07-05，共 17 条）</summary>

- **2026-07-05 — `0.6.6` 让动态插件边界明确并能通过审查。** Dataview、Tasks、Templater 和 PDF.js 集成收窄类型并增加运行时能力判断，消除源码审查发现的最后几处宽泛顶层类型，同时保留宿主边界兼容性，不再用未经检查的值隐藏失败。
- **2026-07-04 — `0.6.5` 社区审查失败会先在本地停止发布。** 移除被禁止的 `no-explicit-any` 禁用指令，收紧并说明 lint directive，统一非 `Error` Promise rejection，并扩展发布检查以拦截目录审查同类问题；`0.6.4` 作为被替代的第一次清理保留完整审计记录。
- **2026-07-04 — `0.6.3` 更新入口回到软件内插件页。** 更新提示现在优先打开软件内的 Glossa 插件详情页；社区目录尚未同步时，GitHub Release 仍作为备用入口。
- **2026-07-04 — `0.6.2` 插件市场准备。** 收紧公开描述和发布文档，替换审查路径中的直接 fetch，移除 CSS `:has()` 兼容风险，加入严格源码 lint，并把依赖审计降到 0 个已知漏洞。
- **2026-07-03 — `0.6.1` 更快的选区翻译。** 输入框为空时，选中文本并连续按两次 Enter 即可翻译；混合语言检测会忽略 Markdown URL，并降低模型名、Provider 名和其他专有名词的权重，再判断目标语言。
- **2026-07-03 — `0.6.1` 更安静的选区与会话行为。** 快速翻译提示移入输入框 placeholder；删除当前会话后可以干净重置；流式输出只在用户跟随底部时自动滚动；Node 集成测试也补齐所需浏览器全局对象。
- **2026-06-30 — `0.6.0` 有边界的网页研究。** 搜索可以路由到 DuckDuckGo、Brave、Tavily、Exa 或 SerpAPI，再经过域名过滤、去重、可信度提示、元数据和任务导向摘要提取有来源的结果。
- **2026-06-30 — `0.6.0` 带来源记录的安全下载。** 公开 PDF、图片、数据集和 Release 资产可以在跳转检查、私网拦截、大小限制、覆盖控制、SHA-256 和可选 `.source.json` 记录下保存，并支持下载后检查 PDF。
- **2026-06-30 — `0.5.3` 安静的更新提示。** 侧栏可以节流检查 GitHub Release，支持手动检查和忽略当前版本；补丁版本能正确比较，长会话也减少重复 DOM 工作。
- **2026-06-29 — `0.5.2` 长对话导航。** 紧凑 conversation rail 只记录用户提问，滚动时高亮当前问题，悬停预览历史提问，并能快速跳转，而不会给 transcript 增加额外导航内容。
- **2026-06-26 — `0.5.1` 更清楚的附件上下文。** 上传文件会保留在已发送消息中，输入框将明确附件与当前笔记分开；发送后旧 chip 会清理，普通文本也不会无谓触发 MathJax。
- **2026-06-26 — `0.5.0` Agent UI 刷新。** 侧栏、输入框、工具活动、状态 pill、PDF 上下文、历史命名、空会话持久化和端点设置完成一次协调一致的视觉与交互更新。
- **2026-06-25 — `0.4.3` PDF、图片与 Provider 润色。** 改进任务导向文档提示；`xhigh` 可以不经隐式降级直接发送；自动选区不再捕获无关 UI 文本；Custom API 工具调用更可靠。
- **2026-06-23 — `0.4.2` 提交后的审查修复。** 清理剩余 lint 问题，用可信 SVG 渲染替代不安全 HTML 插入，保持旧 WebView 中的发布 UI 可读，并为 GitHub Actions 产物增加 provenance。
- **2026-06-23 — `0.4.1` 第一次社区提交准备。** 加入 `read_pdf`、发布元数据检查、保守的 Plan 与只读默认值、端点自身连接测试、有界大 diff 预览和明确隐私说明。
- **2026-05-19 — `0.4.0` 安全与持久化加固。** 原子 JSON 写入、首次 RAG consent、Checkpoint 写入串行化、编码路径穿越防护、严格 patch envelope、延迟工具过滤、CI、隐私文档和发布自动化一起落地。
- **2026-04-08 — `0.3.0` 开源前基线。** 最后一个内部版本建立了聊天、上下文、Provider 与笔记工具基础，随后这些能力被系统加固并进入第一次公开发布。

每个版本的 Added、Changed、Fixed 与 Checks 明细见完整[更新记录](CHANGELOG.md)。

</details>

## 典型工作流

```text
打开一篇论文
  -> 询问方法或某张图
  -> Glossa 自动选择文本页或视觉证据
  -> 回答保持在具体页面内容上
```

```text
给出公开论文标题和 Vault 目录
  -> 有边界地发现来源
  -> 核对标题与响应内容
  -> 保存真实 PDF
  -> 继续读取下载后的论文
```

```text
要求修改一篇笔记
  -> 只读取相关内容
  -> 预览并审批修改
  -> 写入最小 patch
  -> 重新检查变更区域
```

## 自然工作的上下文

- 发送请求时会刷新当前 Markdown 正文，不使用过时快照。
- 明确附加的文件或选区会成为“这个文件”“这篇论文”的优先指代对象。
- 来源语言和回答语言相互独立，英文论文不会覆盖用户的中文表达习惯。
- 长对话保留最近证据，压缩较早工具结果，同时保存用户纠正、URL、路径、失败原因和下一步。
- 聊天落盘时会移除重复图片数据和仅供模型使用的上下文，保留有用文本与元数据。

## 安全边界

- **Plan 模式与只读权限** 是新安装的保守起点。
- **写入审批** 可以按工具、路径、目录或会话设置。
- **Checkpoint** 会在破坏性修改前保存受影响文件的快照。
- **网络工具** 对响应大小、跳转、私网地址和下载意图设置明确边界。
- **下载验证** 会在写入前检查大小、响应状态和文件签名。
- **社区版本** 不执行 Shell 命令，不读取系统身份，也不直接访问系统文件目录。

Glossa 本身不是托管 AI 服务。对话与选定上下文会发送到你配置的模型端点；网页只会在执行对应网络任务时访问。完整边界见[隐私政策](PRIVACY.md)和[安全说明](SECURITY.md)。

## 安装

### 插件市场

打开 **设置 → 第三方插件 → 浏览**，搜索 **Glossa**，然后安装并启用。

[在插件市场打开 Glossa](https://obsidian.md/plugins?id=glossa)

### GitHub Release

从[最新版本](https://github.com/yiiwang118/obsidian-glossa/releases/latest)下载 `main.js`、`manifest.json` 和 `styles.css`，放入：

```text
<your-vault>/.obsidian/plugins/glossa/
```

重新加载应用，然后在第三方插件中启用 **Glossa**。

## 一分钟开始

1. 从左侧 ribbon 或命令面板打开 Glossa。
2. 添加 OpenAI-compatible、Anthropic-compatible 或本地 HTTP 模型端点。
3. 打开一篇笔记，用 `@` 附加文件，或选择一段文本。
4. 直接提问；只读任务保持 **Plan**，需要修改文件时切换到 **Act**。
5. 在写入或下载前检查 approval。

## 构建与验证

```bash
git clone https://github.com/yiiwang118/obsidian-glossa.git
cd obsidian-glossa
npm install
npm run check
```

`npm run check` 会依次运行 TypeScript、review lint、strict lint、禁用指令审计、完整测试、依赖审计、生产构建、生成 bundle 扫描和发布元数据检查。

开发构建可以直接同步到指定 Vault：

```bash
GLOSSA_PLUGIN_DIR="/path/to/vault/.obsidian/plugins/glossa" npm run dev
```

## 项目说明

- 当前版本仅支持桌面端。
- 新安装默认使用 Plan 模式和只读权限。
- Release 资产由 GitHub Actions 重新构建并验证后发布。
- 欢迎提交 issue 和可稳定复现的 bug report。
- 本开源项目认可并链接 [LINUX DO 社区](https://linux.do/)。

## License

[MIT](LICENSE) © yiiwang
