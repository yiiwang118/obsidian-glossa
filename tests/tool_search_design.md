# tool_search 集成测试方案设计

> 实装文件留待用户统一测试时再写代码。此文档约定**测什么 / 怎么测 / 断言哪里**。

## 范围

`tool_search` 工具的核心契约（来自 `src/agent/tools/tool_search.ts`）：

1. **关键词搜索模式**：query 字符串 → 在所有 `shouldDefer:true` 的工具中，按
   `name×3 + searchHint×2 + description×1` 计分，返回 top-N 匹配 + 完整 schema
2. **显式选择模式**：`select:foo,bar` → 直接返回这些工具的 schema（不限于 deferred）
3. **deferred 工具过滤**：默认 spec 列表必须排除 `shouldDefer:true` 的工具
4. **错误路径**：空 query / 无 token / 无命中 → 各自的错误信息

外加：`tools.ts` 的 `listToolSpecs()` 过滤逻辑（deferred 排除 + bridge 排除）

---

## 测试文件布局

新建 `tests/tool_search.test.cjs`，遵循现有测试范式（每个 `.test.cjs` 导出
`async function run(t, loadModule)`，使用 esbuild 内联打包）。

依赖：
- `src/agent/tools.ts`（导出 TOOLS, listToolSpecs, getTool）
- `src/agent/tools/tool_search.ts`（被测）
- `src/agent/plugin_bridges.ts`（probeBridges / isBridgeActive — 桥过滤）
- `src/agent/tools/_shared.ts`（buildTool — 用来在测试中构造 mock 工具）

---

## 测试场景清单

每个场景标注 **预期断言点**（assertion targets）。

### 场景 1: deferred 工具不出现在默认 spec 列表

```
setup: 加载 tools.ts 模块；记录 listToolSpecs() 返回的 name 集合
expect:
  - 不包含 'edit_section'        (shouldDefer:true)
  - 不包含 'append_to_note'      (shouldDefer:true)
  - 不包含 'discover_skills'     (shouldDefer:true)
  - 不包含 'run_skill'           (shouldDefer:true)
  - 包含 'patch_note'             (默认可见)
  - 包含 'read_note'              (默认可见)
  - 包含 'tool_search'            (自己也不被 defer)
```

### 场景 2: 桥工具在 plugin 未检测到时被过滤

```
setup: 默认状态下 probeBridges 没运行（或 app mock 没装这些 plugin）
expect:
  - listToolSpecs() 不包含 'dataview_query'
  - listToolSpecs() 不包含 'templater_render'
  - listToolSpecs() 不包含 'tasks_query'
  - listToolSpecs() 不包含 'bases_query'
note: 此场景需要确保 plugin_bridges 模块的 activeBridges 是空集
```

### 场景 3: 桥工具在 plugin 检测到后出现

```
setup:
  mockApp = { plugins: { plugins: { dataview: { api: {} } } } }
  调用 probeBridges(mockApp)
expect:
  - listToolSpecs() 包含 'dataview_query'
  - listToolSpecs() 仍不包含 'templater_render' (其 plugin 未 mock)
```

### 场景 4: 关键词搜索 — 命中 deferred 工具

```
setup: query = "section edit"
call: toolSearchTool.run(_app, {query})
expect:
  - 结果字符串包含 'edit_section'   (因 searchHint 含 'edit')
  - 结果字符串包含 '## edit_section' (markdown header 格式)
  - 结果字符串包含 '"parameters"'    (schema 已嵌入)
  - 返回 1 条 (max_results 默认 5，但只有 edit_section 命中)
```

### 场景 5: 关键词搜索 — name×3 weight

```
setup: 假设 query = "skill"
expect:
  - 'run_skill' 和 'discover_skills' 都命中
  - 'run_skill' 的 name 含 'skill' (3 分)
  - 'discover_skills' 的 name 含 'skill' (3 分)
  - 两者并列, 在 top-N 内
```

### 场景 6: 关键词搜索 — searchHint×2 weight

```
setup: query = "deprecated legacy"   (这些词只在 deprecated 工具的 searchHint 出现)
expect:
  - 命中 edit_section / append_to_note (deprecated, searchHint 含 'legacy')
  - score 高于仅 description 命中的工具
```

### 场景 7: 显式 select 模式

```
setup: query = "select:edit_section,run_skill"
expect:
  - 结果含 'edit_section' (完整 schema)
  - 结果含 'run_skill' (完整 schema)
  - 不含其他工具
  - 即使被 select 的工具是 deferred,也能取
```

### 场景 8: 显式 select 模式 — 非 deferred 工具也能取

```
setup: query = "select:read_note,patch_note"
expect:
  - 返回这两个工具的 schema
note: select 模式不限于 deferred (per tool_search.ts 实现)
```

### 场景 9: 显式 select — 未知工具静默跳过

```
setup: query = "select:edit_section,does_not_exist,run_skill"
expect:
  - 返回 edit_section + run_skill (2 个)
  - 不报错; does_not_exist 被跳过
```

### 场景 10: 显式 select — 全部未知

```
setup: query = "select:nope1,nope2"
expect:
  - 返回错误字符串包含 "No tool matched"
```

### 场景 11: 空 query 拒绝

```
setup: query = "" / "   "
expect:
  - 返回 'Error: query is required.'
```

### 场景 12: 无 token query 拒绝

```
setup: query = "!!! @@@"      (无字母数字 token)
expect:
  - 返回 'Error: query has no searchable tokens.'
```

### 场景 13: 无命中

```
setup: query = "asdfqwertyzxcv"
expect:
  - 返回字符串包含 "No deferred tools matched"
  - 列出可用 deferred 工具的 name 列表
```

### 场景 14: max_results 截断

```
setup: query = "edit"  (会命中 file_edit / edit_section / append_to_note 等)
        max_results = 1
expect:
  - 返回字符串只含 1 个 "## " header
  - 最高分的那个 (file_edit 因 name 含 'edit', 但它非 deferred — 只考虑 deferred)
  - 实际命中 edit_section (deferred, name 含 'edit')
```

### 场景 15: max_results 上限钳制

```
setup: max_results = 999
expect:
  - 最多返回 20 (tool_search.ts 钳制到 [1, 20])
```

### 场景 16: 结果格式合约

```
setup: 任意命中场景
expect:
  - 每个工具块以 '## <name>' 开头
  - 紧跟 description
  - 含 '```json' 代码围栏
  - JSON 含 {name, parameters}
```

### 场景 17: tool_search 自己不被过滤

```
expect:
  - listToolSpecs() 包含 'tool_search'
  - tool_search 自己 shouldDefer 是 falsy (undefined)
```

---

## Mock 策略

测试需要 mock `app` 对象。最小 mock：

```js
const mockApp = {
  plugins: {
    plugins: {
      // 控制 detect-then-register 状态
      dataview: { api: { query: async () => ({ successful: true, value: '' }) } },
      // 不放 templater-obsidian / tasks-plugin → 这两个桥保持 inactive
    },
  },
  vault: { /* 大多数测试用不到 */ },
};
```

注意：`plugin_bridges.ts` 的 `probeBridges()` 函数是模块级状态（`activeBridges`
Set）。**测试之间需要 reset**——可以在每个测试 case 开头：

```js
const bridges = await loadModule('.../plugin_bridges.ts');
bridges.probeBridges({ plugins: { plugins: {} } });   // 清空
```

或者扩展 `plugin_bridges.ts` 暴露一个 `__resetForTests()`（建议加，方便测试）。

---

## 边界情况清单

| 边界 | 期望行为 |
|---|---|
| query 含 Unicode / emoji | tokenize 跳过非 `[a-z0-9_]+`，但 ASCII 部分仍参与匹配 |
| 多个工具同分 | 顺序按 `Object.keys(TOOLS)` 插入序（稳定） |
| `select:` 后空字符串 | 等同于无命中：`"No tool matched any of: "` 后面跟空 |
| query 含 SQL/HTML 注入字符 | 仅做 token 提取；不会被解释 |
| TOOLS 在测试期间被 mutate | tool_search 内部 `Object.values(TOOLS)` 读时态值 — 测试要注意状态隔离 |
| alias 命中 | 当前实现 score 函数只看 `tool.spec.name`，不看 aliases；如果未来要支持，加测 case |

---

## 测试代码骨架

文件位置：`tests/tool_search.test.cjs`

```js
const path = require('path');

exports.run = async (t, loadModule) => {
  const tools = await loadModule(path.resolve(__dirname, '../src/agent/tools.ts'));
  const bridges = await loadModule(path.resolve(__dirname, '../src/agent/plugin_bridges.ts'));

  // --- 场景 1: deferred 不出现在默认 spec ---
  const specs = tools.listToolSpecs();
  const names = new Set(specs.map(s => s.name));
  t.ok(!names.has('edit_section'),    'deferred edit_section excluded from default');
  t.ok(!names.has('run_skill'),       'deferred run_skill excluded from default');
  t.ok(names.has('patch_note'),       'patch_note in default');
  t.ok(names.has('tool_search'),      'tool_search itself visible');

  // --- 场景 2/3: 桥过滤 ---
  bridges.probeBridges({ plugins: { plugins: {} } });
  t.ok(!new Set(tools.listToolSpecs().map(s => s.name)).has('dataview_query'),
       'dataview bridge hidden when plugin absent');

  bridges.probeBridges({ plugins: { plugins: { 'dataview': { api: {} } } } });
  t.ok(new Set(tools.listToolSpecs().map(s => s.name)).has('dataview_query'),
       'dataview bridge surfaces when plugin present');

  // --- 场景 4: 关键词搜索命中 ---
  const ts = tools.getTool('tool_search');
  const r4 = await ts.run({}, { query: 'section edit' });
  t.ok(r4.includes('edit_section'),   'keyword search hits deferred tool by hint');
  t.ok(r4.includes('"parameters"'),   'result includes schema JSON');

  // --- 场景 7: select 模式 ---
  const r7 = await ts.run({}, { query: 'select:edit_section,run_skill' });
  t.ok(r7.includes('## edit_section'), 'select mode returns edit_section');
  t.ok(r7.includes('## run_skill'),    'select mode returns run_skill');
  t.ok(!r7.includes('## patch_note'),  'select mode does not return non-selected');

  // --- 场景 11: 空 query ---
  const r11 = await ts.run({}, { query: '' });
  t.ok(r11.startsWith('Error'),       'empty query rejected');

  // --- 场景 13: 无命中 ---
  const r13 = await ts.run({}, { query: 'asdfqwertyzxcv' });
  t.ok(r13.includes('No deferred tools matched'), 'no-match returns clear error');

  // --- 场景 14: max_results 截断 ---
  const r14 = await ts.run({}, { query: 'skill', max_results: 1 });
  const headers = (r14.match(/^## /gm) ?? []).length;
  t.eq(headers, 1, 'max_results=1 returns exactly one tool');

  // ... 其余场景按上表展开
};
```

---

## 推荐对 `plugin_bridges.ts` 加的测试辅助

```ts
// src/agent/plugin_bridges.ts
/** Test-only: clear active set + listeners. Production code never calls this. */
export function __resetForTests(): void {
  activeBridges.clear();
  listeners.clear();
}
```

加这一行 export 后，每个 case 都能干净启动。

---

## 不在本次测试范围的事

- `tool_search` 是否真的被 LLM 在多轮会话里正确调用 → 端到端测试，需要真实
  provider 模拟，本套件不覆盖
- view.ts 渲染 tool_search 卡片 → UI 集成测试，独立于这套
- 性能（10k 工具下的搜索延迟）→ 当前规模不需要

---

## 运行命令

```bash
cd obsidian-glossa
npm test
```

测试通过条件：`npm test` 全部通过，0 failed。
