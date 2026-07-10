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

## 0.6.7 新增能力

### 更少上下文开销，完成更多实际工作

- **当前文件智能进入上下文。** 总结、解释、翻译、分析打开的笔记时不再要求先选中文本；当用户明确指定其他附件时，附件仍然优先。
- **追问不再丢目标。** “继续”“用中文”“放到下面”这类短指令会保留上一轮标题、URL、输出目录、失败尝试和真正任务对象。
- **精确分段与批量读取。** `read_note` 可以读取指定行区间；`read_files` 可以在一次有界调用中读取最多 8 个已知文本路径。
- **主动裁剪模型上下文。** 已经过期的读取和搜索结果可以退出后续模型请求，但不会删除可见聊天；写入确认、下载、失败证据、Skills 和计划始终受到保护。
- **专用工具按需加载。** 首轮工具表保持精简；Canvas、反链、frontmatter、批量读取、Skill 校验等 schema 只在需要时加载。
- **自动阻止无效循环。** 工具返回错误会进入真正的 error 状态；重复失败会要求切换策略，完全相同的调用循环会被运行时拒绝。

### PDF、图片和公式更可靠

- **按任务读取 PDF。** 可以核对文档身份、总结、搜索概念、读取页码范围，或为公式、表格、图形和扫描页渲染视觉证据。
- **按目的检查图片。** 支持普通描述、OCR、UI 审查、图表分析、局部裁剪和精确像素颜色采样。
- **稳定渲染数学公式。** 历史内容里的 `\(...\)` 与 `\[...\]` 会在阅读视图中正确归一化，同时保持代码块和行内代码原样。
- **重复读取更快。** PDF 文本、渲染页面、图片读取和裁剪使用按文件身份与参数区分的有界内存缓存。

### 更容易信任的 Skills

Glossa 内置 6 个聚焦 Skill：

`obsidian-markdown` · `obsidian-canvas` · `obsidian-bases` · `pdf-analysis` · `image-analysis` · `skill-creator`

Skill Creator 会先定义正向和负向触发样例，选择合适的约束强度，再编写聚焦的 `SKILL.md`；校验器会检查命名、触发条件、路径安全、工作流结构和工具引用。

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
- Release 资产由 GitHub Actions 构建并生成 attestation。
- 欢迎提交 issue 和可稳定复现的 bug report。
- 本开源项目认可并链接 [LINUX DO 社区](https://linux.do/)。

## License

[MIT](LICENSE) © yiiwang
