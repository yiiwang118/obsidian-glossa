# Tool Search 与按需工具契约

本文记录当前已经实现并由自动化测试约束的行为。可执行断言位于
`tests/tool_contracts.test.cjs`。

## 目标

- 默认只向模型发送高频核心工具，降低每轮 schema 和提示缓存开销。
- 专用工具必须能够被真正加载，而不是仅把 schema 作为普通文本返回。
- 搜索支持英文、常见中文能力词和精确工具名。
- 动态加载不得绕过只读模式、Plan 模式、Provider 限制或插件桥可用性。
- 已弃用工具继续兼容历史调用，但不再向模型展示或推荐。
- 核心上下文控制保持常驻；批量读取和 Skill 校验按需加载。

## 调用流程

```text
首轮 provider 请求
  -> 仅包含核心工具
  -> 模型调用 tool_search({query}) 或 tool_search({exact_names})
  -> tool_search 返回 loadedToolNames
  -> agent loop 按权限和桥状态过滤
  -> 下一轮 provider 请求加入通过过滤的完整 ToolSpec
  -> 模型直接调用已加载工具
```

Skill 可以通过 `required-tools` 声明工作流所需的专用工具。调用统一的
`skill` 工具后，agent loop 使用同一条动态加载路径，因此不需要再调用一次
`tool_search`。

`context_prune` 不删除聊天或审计记录。它只在下一次 provider 请求前移除
已完成且不再需要的成功工具调用，并同时移除 assistant tool call 与对应 tool
result，保持协议配对完整。Skill、工具披露、计划、写入、下载和裁剪工具自身
不可裁剪；失败结果也会保留，避免丢失诊断证据或重复执行副作用。

`read_note` 支持 1-based 行区间和继续读取元数据。多个明确路径已经给出时，
模型可以按需加载 `read_files`，一次读取最多 8 个文本文件；PDF 与图片仍分别
交给 `read_pdf` 和 `view_image`，不把二进制内容误当文本。

## 搜索规则

- 精确名称优先，旧式 `select:name1,name2` 继续兼容。
- 能力搜索综合工具名、别名、`searchTags`、`searchHint`、描述和参数名。
- 常见中文能力词会确定性展开，例如“反链”映射到 backlinks，“画布”映射到
  canvas/node/edge。热路径不依赖 embedding 或网络。
- 排序先按匹配分数，再按工具名稳定排序；默认最多返回 5 个、上限 8 个。
- 返回文本只包含已加载名称和短说明。完整 schema 会在下一轮正式进入
  provider 的 `tools` 字段，避免在聊天历史中重复一份大 JSON。

## 安全边界

- `listToolSpecs()` 统一执行模型隐藏、deferred 和插件桥过滤。
- 只读或 Plan 模式不会加载写工具；Codex envelope-only 模式不会重新引入
  被该模式排除的单点写工具。
- 所有本地工具调用在审批和执行前经过 JSON Schema 子集校验，包括 required、
  类型、enum、数值/长度范围、数组范围和未知顶层参数。
- 注册表审计要求名称、描述、必填字段、每个参数说明、搜索元数据和
  `additionalProperties: false` 保持一致。

## 回归覆盖

- 核心工具数量和总 schema 字符预算。
- deferred 与已弃用工具可见性。
- 中文反链、Canvas、批量读取、Skill 校验搜索，精确名称和旧 `select:` 兼容。
- enum、数值边界和未知参数拒绝。
- `tool_search` 后下一轮 provider 请求实际出现新 ToolSpec。
- 只读模式拒绝动态写工具，并把原因返回给模型。
- 行区间边界、批量请求嵌套参数、上下文裁剪配对和跨轮恢复。
- `Error:` 工具结果的失败状态，以及连续失败后的收敛保护。
