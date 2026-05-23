<div align="center">

# Glossa

**为你的知识库准备的 AI 侧栏 — 多 provider 聊天、agent 模式、上下文感知编辑、vault 原生 skills。**

[![CI](https://github.com/yiiwang118/obsidian-glossa/actions/workflows/ci.yml/badge.svg)](https://github.com/yiiwang118/obsidian-glossa/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/yiiwang118/obsidian-glossa?display_name=tag&sort=semver)](https://github.com/yiiwang118/obsidian-glossa/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-1181_passed-brightgreen)](tests/)
[![en](https://img.shields.io/badge/English-README-blue)](README.md)

</div>

---

## 是什么

Glossa 是一个跑在桌面知识库主机里的侧栏助手。它对接多个 LLM provider（OpenAI、Anthropic、任意 OpenAI 兼容网关、Codex CLI），通过 `@` 提及读取你的选区 / 当前笔记 / 任意文件，在 vault 上跑工具型 agent（每个动作都要显式批准），需要安静的时候不打扰你。

它**不是**云服务。Glossa 是本地插件；唯一的网络调用流向**你自己配置的** provider 端点。

## 特性

- **多 provider** · OpenAI、Anthropic、任意 OpenAI/Anthropic 兼容网关（DeepSeek、GLM、Qwen、Groq、MiniMax、代理后的 Gemini、本地 Ollama…），加上 Codex CLI 和 Codex App-Server。一个侧栏、一个聊天历史，按会话切换端点。
- **模型能看到的上下文** · `@file`、`@folder`、`@tag`、`@selection`、`@clipboard`、`@web url`；自动附加当前文件/选区；按 chip pin/移除。
- **带 sandbox 的 agent 模式** · 40+ 工具覆盖 读 / 编辑 / 搜索 / RAG / canvas / frontmatter / tags / templater / dataview / tasks / 网络。三档权限（read-only / workspace-write / full）。按工具、按文件夹、按会话的批准规则。每个决定都进 audit log。
- **`apply_patch` envelope** · Codex 风格的多文件 diff，渐进匹配（精确 → rstrip → trim → unicode 归一化），应用前可预览。
- **语义搜索（RAG）** · 本地 cosine 比对，走你自己的嵌入端点；文件变化时增量重建；除了**你**选的嵌入端点，绝不把内容发给任何人；首次构建有一次性 consent 弹窗。
- **Skills** · `.glossa/skills/` 下的 Markdown 文件就是可调用的 agent 技能，带各自的 allowed-tools 白名单。可按 glob 条件激活（`paths: ['*.canvas']`）。
- **MCP 桥** · 接入任何 MCP 服务（filesystem、GitHub、Slack…）。工具自动出现在 agent loop 里；权限规则同样生效。
- **加密** · 可选密码加密 API 密钥（PBKDF2 + AES-GCM-256，密钥永不从内存导出）。
- **斜杠命令** · `/translate`、`/summarize`、`/critique`、`/improve`、`/diagram`、`/skill`、`/tldr` 等，完全可自定义。
- **Checkpoint** · 每次破坏性工具调用先快照受影响文件；按 turn 一键回滚。
- **自动 compact** · 长会话超过 token 预算时就地总结；可撤销。

## 截图

> 待补 — 见 `docs/screenshots/`。

## 安装

### 应用内社区市场（上架后）

1. Settings → 第三方插件 → 社区插件市场 → 搜索 **Glossa**
2. 安装 → 启用
3. 打开右侧栏；点 Glossa 图标
4. 齿轮 → Providers → 至少加一个端点

### Beta / 预发布通过 BRAT

1. 装 [BRAT](https://github.com/TfTHacker/obsidian42-brat)
2. BRAT → Add Beta plugin → `yiiwang118/obsidian-glossa`
3. 在社区插件里启用

### 手动

```bash
# 进入你的 vault
mkdir -p .obsidian/plugins/glossa
cd .obsidian/plugins/glossa
curl -L -o main.js       https://github.com/yiiwang118/obsidian-glossa/releases/latest/download/main.js
curl -L -o manifest.json https://github.com/yiiwang118/obsidian-glossa/releases/latest/download/manifest.json
curl -L -o styles.css    https://github.com/yiiwang118/obsidian-glossa/releases/latest/download/styles.css
```

重启宿主应用，在社区插件里启用 Glossa。

## 快速上手

1. 打开侧栏（ribbon 图标或命令面板 → "Open sidebar"）
2. 设置 → Providers → **Add endpoint** → 粘贴 API key
3. 选模式 pill：**Plan**（只读，建议性）或 **Act**（允许跑工具）
4. 直接输入，或 `@` 附加上下文，或 `/` 触发斜杠命令
5. Shift-Enter 换行，Enter 发送

## Provider 矩阵

| Provider | 流式 | 工具调用 | Thinking / Reasoning | 图像输入 |
|---|---|---|---|---|
| OpenAI / OpenAI 兼容 | ✅ | ✅ | ✅ (reasoning_effort) | ✅ data-URI |
| Anthropic | ✅ | ✅ | ✅ (extended thinking) | ✅ |
| Codex CLI（legacy `exec --json`） | ✅ | ✅ | ✅ (xhigh effort) | ✅ 临时文件 |
| Codex App-Server（stdio JSON-RPC） | ✅ | ✅ | ✅ | ✅ |
| 自定义（任意 HTTP 网关） | ✅ | ✅ | 看实现 | 看实现 |

在企业代理 / GFW 后面用 Obsidian 系统代理模式（`useObsidianFetch`）。

## Agent 模式

三档权限：

- **read-only** — 只有标记 `isReadOnly: true` 的工具（read_note、search_vault、semantic_search…）能跑
- **workspace-write** — 读 + 写工具（file_edit、write_note、patch_note、apply_patch…）；破坏性调用进 approval modal
- **full** — 同上，再加 execute_command 与危险 codex sandbox（请慎用）

批准规则可保存为三种 scope：全局（任何参数）、文件夹（路径前缀）、精确路径；三种行为：allow / deny / ask。每个决定都追加到 200 条上限的 audit log。

## 隐私与安全

完整数据流见 [PRIVACY.md](PRIVACY.md)，漏洞披露见 [SECURITY.md](SECURITY.md)。

**简述**：
1. 你的对话 / prompt / 附带 context 发给**你配置的 provider**。Glossa 作者看不到。
2. RAG / 嵌入重建会**把每个 markdown 文件的内容上传**到你选的嵌入端点。首次构建前有一次性 consent 弹窗。
3. API 密钥默认在 `data.json` 里明文存储。需要 unlock 时输入密码？去 设置 → Security 打开加密。
4. MCP 子进程继承一个**过滤后**的 env（LLM 凭据已剥离）。如果你要让 MCP 用其它密钥（GitHub PAT、AWS key），请填到该 MCP 服务自己的 env 配置里，而不是 shell rc。

## Skills

在 vault 的 `.glossa/skills/<your-skill>/SKILL.md` 放一个 Markdown：

```yaml
---
name: critique-this
description: Reviewer 风格的严苛过审，严格控制行数。
allowed-tools: [read_note, file_edit]
paths: ['Reviews/*.md']
---

以 ICML 审稿人视角审阅附件文档。输出：
- 3 个最强点（每条 1 行）
- 5 个弱点（每条 1 行，按严重度排序）
- 1 行是否接受
```

agent 通过 `tool_search` 发现它，通过 `skill` 工具调用它。

## MCP 服务

设置 → MCP → 市场，或手动加：

```json
{
  "id": "github",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-github"],
  "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_..." }
}
```

工具以 `github__list_issues`、`github__create_pr` 等形式出现。权限规则可针对单个 MCP 工具或整服务 `mcp:github:*`。

## 从源码构建

```bash
git clone https://github.com/yiiwang118/obsidian-glossa.git
cd obsidian-glossa
npm install
npm run dev        # 保存时重新构建
npm run build      # 生产打包 (main.js)
npm run typecheck  # tsc --noEmit
npm test           # 单元 + 集成（60 + 1181 断言）
```

## 测试

7 层测试套件在 `tests/`：

| 套件 | 范围 | 环境 |
|---|---|---|
| A 单元 | crypto、parser、permission、token、tool_search、slash、markdown、vault path | Node |
| B 集成 | mock provider 驱动 agent loop、approval 优先级、checkpoint 并发、compact、加密生命周期、file_index | Node + mock |
| C provider | SSE / NDJSON / JSON-RPC fuzz | Node |
| D perf | 嵌入搜索、渲染、file_index micro-bench | Node |
| E 安全 | SSRF、18 工具 × 10 攻击路径穿越、MCP env 隔离、namespace 碰撞、marketplace 命令注入 | Node |
| F e2e | 长会话渲染、流式、session race、模式切换、cancel cycle、加密循环、MCP 重连、对抗模型 | happy-dom |
| G chromium | 真 Chromium via Puppeteer | headless Chromium |

```bash
npm test              # A + B + C + E (~5s)
npm run test:e2e      # F (happy-dom, ~6s)
npm run test:render   # G (real Chromium, ~1s)
npm run test:all      # 全套 (~10s)
```

## Roadmap

见 [open issues with **enhancement** label](https://github.com/yiiwang118/obsidian-glossa/issues?q=is%3Aissue+is%3Aopen+label%3Aenhancement) 与 [milestones](https://github.com/yiiwang118/obsidian-glossa/milestones)。

短期方向：
- Skill 市场（curated `.glossa/skills/` bundle）
- 单消息分支（alt-response 树）
- 纯本地模式（Ollama / llama.cpp / 完全离线）
- 移动端构建（当前因用了 `child_process` 和 `node:fs` 仅桌面）

## 贡献

欢迎 PR。详见 [CONTRIBUTING.md](CONTRIBUTING.md)。开 PR 前请：

1. `npm test` 和 `npm run typecheck` 通过
2. 新工具自带 `tests/A_unit/` 或 `tests/E_security/` 用例
3. UI 改动 PR 描述里附截图
4. 生产路径不留 `console.log`

## 致谢

agent loop、`apply_patch` envelope、skill 系统、工具注册架构大量受 [Claude Code](https://github.com/anthropics/claude-code) 与 Codex 启发。设置 / 批准 / 回滚的模式借鉴了 [Cline](https://github.com/cline/cline)。感谢所有让这个项目成为可能的开源前辈。

## License

[MIT](LICENSE) © yiiwang
