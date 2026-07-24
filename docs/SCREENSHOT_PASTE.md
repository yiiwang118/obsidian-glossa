# Glossa 截图粘贴功能说明

## 功能概览

本次修改让 Glossa 对话输入框可以直接接收系统剪贴板中的截图。

- 使用 Windows 截图工具截图后，在 Glossa 输入框按 `Ctrl+V` 即可添加图片。
- 普通文字粘贴仍然使用输入框原有行为，不会被图片处理逻辑拦截。
- 支持同时粘贴多张图片，每张图片会生成独立名称和附件预览。
- 支持纯图片发送，不要求额外输入文字。
- 图片只作为当前对话的临时附件，不会自动写入 Obsidian vault。

## 图片处理规则

- PNG、JPEG、GIF 或 WebP 不超过 5 MB 时保持原格式。
- 超过 5 MB 或格式不受现有 provider 支持时，图片会转为 WebP。
- 转换质量初始为 0.92，最长边初始限制为 4096 像素。
- 如果仍超过 5 MB，宽高每轮缩小到原来的 85%，最多尝试 10 次。
- 压缩成功后会显示压缩前后的文件大小。
- 无法解码或最终仍然过大的图片会显示错误提示，不会发送损坏数据。

## 发送流程

1. 输入框的 paste 事件只提取 `image/*` 剪贴板项目。
2. 图片经过命名、格式检查和必要的压缩。
   发送操作会等待这一异步步骤完成，避免附件进入下一轮对话。
3. 图片作为 `ContextItem(kind: image)` 加入现有上下文栏。
4. 发送时继续通过现有 `imagesForAPI()` 和 `attachedImages` 链路进入多模态请求。
5. 纯图片消息会在模型请求中补充 `Analyze the attached image(s).`，但聊天气泡只显示图片附件。
6. 发送完成后，未固定的图片按原有规则从 composer 清除。

## 主要修改位置

- `src/ui/view.ts`
  - 接入图片粘贴事件。
  - 添加纯图片发送判断。
  - 将处理后的图片加入现有上下文和 provider 请求。
- `src/utils/composer_events.ts`
  - 识别剪贴板图片。
  - 只在存在图片时消费 paste 事件。
  - 生成稳定且不重复的截图名称。
- `src/utils/image.ts`
  - 统一 5 MB 图片附件上限。
  - 增加截图格式规范化和 Canvas/WebP 压缩。
- `src/context/manager.ts`
  - 图片按实际数据去重，避免同尺寸或同名截图互相覆盖。
- `tests/composer_events.test.cjs` 和 `tests/context_manager.test.cjs`
  - 覆盖图片粘贴、文字粘贴、多图命名和同尺寸图片去重。

## 验证结果

- TypeScript 类型检查通过。
- 全量测试通过，0 failed。
- review lint 和等价 strict/directives lint 通过。
- 生产构建通过。
- `review:scan` 和 `release:check --allow-dirty` 通过。
- 依赖审计为 0 个已知漏洞。
