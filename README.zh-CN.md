<div align="center">

# 𝓖𝓵𝓸𝓼𝓼𝓪

**一个清爽、可控、本地优先的 Obsidian AI 侧栏。**

和你的笔记对话，附加真实上下文，让 agent 谨慎读写 vault，在 API provider 与本地 coding agent 之间自由切换。

[![Obsidian plugin](https://img.shields.io/badge/Obsidian-Plugin-7C3AED?logo=obsidian&logoColor=white)](https://obsidian.md/plugins?id=glossa)
[![Release](https://img.shields.io/github/v/release/yiiwang118/obsidian-glossa?display_name=tag&sort=semver)](https://github.com/yiiwang118/obsidian-glossa/releases)
[![CI](https://github.com/yiiwang118/obsidian-glossa/actions/workflows/ci.yml/badge.svg)](https://github.com/yiiwang118/obsidian-glossa/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-111827.svg)](LICENSE)
[![English](https://img.shields.io/badge/English-README-2563EB)](README.md)

</div>

---

## 为什么做 Glossa

很多 AI 笔记插件要么只能做很轻的聊天，要么把关键功能封在云端和付费墙后。Glossa 的目标更直接：让 Obsidian 里的研究、写作、代码阅读、资料整理和文件编辑，都可以被一个透明可控的 AI 侧栏辅助完成。

Glossa 不是云服务。它运行在 Obsidian 桌面端，本身不会接管你的数据。你的内容只会发送到你配置的模型 provider、embedding 端点、网页、MCP 服务或本地 CLI 工具，并且敏感操作需要经过权限和审批流程。

## 0.5.3 新增

| | |
|---|---|
| ✨ **版本更新提示** | Glossa 现在可以在侧栏里提示新的 GitHub Release，支持忽略当前版本，也可以手动检查。 |
| 🧭 **长对话更清爽** | 左侧对话轨道只记录用户提问，预览更稳定，长会话回跳时不再被重复弹窗干扰。 |
| ⚙️ **运行更轻** | 流式输出缓存更多 UI 状态，减少重复 Markdown 扫描，窄侧栏下的上下文 chip 也更稳。 |

## 亮点

| | |
|---|---|
| 🧠 **上下文感知聊天** | 附加当前笔记、选中文本、PDF、图片、文件夹、标签、剪贴板、网页，或用 `@` 提及具体笔记。 |
| 🛠 **Agent 工具系统** | 读取、搜索、编辑、patch、创建、重命名、解析 PDF、查询元数据、管理标签/frontmatter、运行 skill 等。 |
| 🔐 **权限优先** | 默认从 Plan/read-only 开始；写入、删除、shell、敏感路径都可以按工具、路径、会话审批。 |
| 🔎 **RAG / 语义搜索** | 使用你选择的 embedding 端点构建 vault 索引，首次上传前有明确 consent。 |
| ⚡ **多 provider 适配** | 支持 OpenAI 风格 API、Anthropic 风格 API、兼容中转站、Codex CLI、Codex App-Server、Claude Code CLI。 |
| 🧩 **Skills + MCP** | Markdown playbook 可以变成可调用 skill，也可以把外部 MCP server 接入同一套权限模型。 |
| 🧯 **Checkpoint** | 破坏性编辑前先创建快照，方便审查和回滚 agent 的改动。 |

## 安装

### 推荐：Obsidian 插件市场

打开 **设置 → 第三方插件 → 浏览**，搜索 **Glossa**，安装并启用。然后在 **Glossa Settings → Providers** 添加第一个模型端点。

[在 Obsidian 插件市场打开 Glossa](https://obsidian.md/plugins?id=glossa)

### GitHub Release

从 GitHub 下载最新版 release 资产：

- `main.js`
- `manifest.json`
- `styles.css`

放到你的 vault 目录：

```text
<your-vault>/.obsidian/plugins/glossa/
```

然后重载 Obsidian，并在第三方插件里启用 **Glossa**。

[下载最新 GitHub Release](https://github.com/yiiwang118/obsidian-glossa/releases/latest)

## 快速开始

1. 从左侧 ribbon 图标或命令面板打开 Glossa。
2. 添加 provider endpoint。
3. 直接提问，用 `/commands`，或者用 `@` 附加上下文。
4. 只需要阅读和规划时保持 **Plan**；需要文件操作时切到 **Act**。
5. 在敏感写入、删除、shell 等动作前检查 approval。

## 可以附加什么

| 来源 | 适合做什么 |
|---|---|
| 📄 当前笔记 | 解释、续写、重写、总结。 |
| 🧾 PDF | 提取标题、摘要、方法、表格、引用、指定页面信息。 |
| 🖼 图片 | 理解截图、图表、UI 问题、视觉证据。 |
| 🗂 文件夹 / 标签 | 给模型一个项目范围，而不是整个 vault。 |
| ✂ 选区 | 只处理当前选中的片段，不用手动复制。 |
| 🌐 网页 | 明确附加外部网页作为上下文。 |

当你手动上传或附加文件时，Glossa 会把它视为“这个文件 / 这个 PDF”的优先指代对象；当前打开的文件会作为背景上下文保留，除非你明确要求处理它。

## 隐私与安全

- 对话和附加上下文会发送到你配置的 provider。
- 语义索引会把笔记片段发送到你选择的 embedding 端点。
- API key 可以用 passphrase 加密保存。
- 本地 CLI provider 和 MCP server 在你的机器上运行，并受 Glossa 权限控制。
- 工具调用、approval、破坏性编辑都尽量在发生前可见。

更多信息：

- [隐私政策](PRIVACY.md)
- [安全政策](SECURITY.md)

## 从源码构建

```bash
git clone https://github.com/yiiwang118/obsidian-glossa.git
cd obsidian-glossa
npm install
npm run build
npm run typecheck
npm test
```

本地开发时可以直接构建到指定 vault：

```bash
GLOSSA_PLUGIN_DIR="/path/to/vault/.obsidian/plugins/glossa" npm run dev
```

## 项目说明

- 当前主要面向桌面端，因为完整 agent 模式依赖 Node/Electron 能力。
- 新安装默认采用保守配置：Plan 模式 + read-only 权限。
- Release 资产由 GitHub Actions 从源码构建并附加到 GitHub Release。
- 版本更新检查可以在设置中关闭。
- 欢迎 issue、PR 和可复现的 bug report。

## 社区

本开源项目已链接并认可 [LINUX DO 社区](https://linux.do/)。

## License

[MIT](LICENSE) © yiiwang
