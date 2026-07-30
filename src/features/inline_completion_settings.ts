import { Setting } from 'obsidian';
import type GlossaPlugin from '../main';
import { confirmModal } from '../ui/confirm_modal';
import { bi } from '../utils/i18n';
import { dismissAllInlineCompletions } from './inline_completion';

function normalizedModels(plugin: GlossaPlugin): string[] {
  const endpoint = plugin.settings.endpoints.find(
    candidate => candidate.id === plugin.settings.inlineCompletionEndpointId,
  ) ?? plugin.settings.endpoints.find(
    candidate => candidate.id === plugin.settings.activeEndpointId,
  );
  if (!endpoint) return [];
  return [...new Set([
    plugin.settings.inlineCompletionModel,
    endpoint.model ?? '',
    ...(endpoint.availableModels ?? []),
  ].map(model => model.trim()).filter(Boolean))].sort((left, right) => (
    left.localeCompare(right, undefined, { sensitivity: 'base', numeric: true })
  ));
}

function markGeneral(setting: Setting): Setting {
  setting.settingEl.dataset.tab = 'general';
  return setting;
}

export function renderInlineCompletionSettings(
  containerEl: HTMLElement,
  plugin: GlossaPlugin,
  refresh: () => void,
): void {
  markGeneral(new Setting(containerEl)
    .setName(bi('Writing assistance', '写作辅助'))
    .setHeading());

  const enabledSetting = markGeneral(new Setting(containerEl)
    .setName(bi('Inline completion', '行内补全'))
    .setDesc(bi(
      'Automatically send a short excerpt around the cursor to the selected endpoint after typing pauses, then show the returned continuation as ghost text.',
      '停止输入后，自动把光标附近的一小段内容发送到所选端点，并将返回的续写显示为灰色建议。',
    )));
  enabledSetting.addToggle(toggle => toggle
    .setValue(plugin.settings.inlineCompletionEnabled)
    .onChange(async enabled => {
      if (enabled && !plugin.settings.inlineCompletionConsentGranted) {
        const confirmed = await confirmModal(plugin.app, {
          title: bi('Enable inline completion?', '启用行内补全？'),
          body: bi(
            'While enabled, Glossa automatically sends the current file path, the nearest heading, and the configured text ranges around the cursor to your selected model endpoint after typing pauses. Suggestions are not stored in chat history.',
            '启用后，Glossa 会在停止输入时，自动把当前文件路径、最近的小标题和设置范围内的光标前后文本发送到你选择的模型端点。补全建议不会写入聊天历史。',
          ),
          confirmText: bi('Enable', '启用'),
          cancelText: bi('Cancel', '取消'),
        });
        if (!confirmed) {
          toggle.setValue(false);
          return;
        }
        plugin.settings.inlineCompletionConsentGranted = true;
      }
      plugin.settings.inlineCompletionEnabled = enabled;
      if (!enabled) dismissAllInlineCompletions();
      await plugin.saveSettings();
    }));

  const endpointSetting = markGeneral(new Setting(containerEl)
    .setName(bi('Completion endpoint', '补全端点'))
    .setDesc(bi(
      'Choose a fast endpoint for writing suggestions, or follow the active sidebar endpoint.',
      '为写作建议选择一个响应较快的端点，或跟随侧栏当前端点。',
    )));
  endpointSetting.addDropdown(dropdown => {
    dropdown.addOption('', bi('Follow sidebar endpoint', '跟随侧栏端点'));
    for (const endpoint of plugin.settings.endpoints) {
      dropdown.addOption(endpoint.id, endpoint.model ? `${endpoint.label} · ${endpoint.model}` : endpoint.label);
    }
    dropdown
      .setValue(plugin.settings.inlineCompletionEndpointId ?? '')
      .onChange(async value => {
        plugin.settings.inlineCompletionEndpointId = value || null;
        plugin.settings.inlineCompletionModel = '';
        dismissAllInlineCompletions();
        await plugin.saveSettings();
        refresh();
      });
  });

  const models = normalizedModels(plugin);
  const modelSetting = markGeneral(new Setting(containerEl)
    .setName(bi('Completion model', '补全模型'))
    .setDesc(bi(
      'Use the endpoint default or a detected model. Reasoning is disabled for lower latency.',
      '使用端点默认模型或已探测到的模型。补全请求会关闭推理以降低延迟。',
    )));
  modelSetting.addDropdown(dropdown => {
    dropdown.addOption('', bi('Use endpoint default', '使用端点默认模型'));
    for (const model of models) dropdown.addOption(model, model);
    dropdown
      .setDisabled(models.length === 0)
      .setValue(plugin.settings.inlineCompletionModel)
      .onChange(async value => {
        plugin.settings.inlineCompletionModel = value;
        dismissAllInlineCompletions();
        await plugin.saveSettings();
      });
  });

  const beforeContextSetting = markGeneral(new Setting(containerEl)
    .setName(bi('Text before cursor', '光标前文范围'))
    .setDesc(bi(
      'Characters sent before the cursor. More context can improve topic continuity but increases input tokens. Default: 800.',
      '发送光标前的字符数。范围越大越容易保持主题，但输入 token 和延迟也会增加。默认 800。',
    )));
  beforeContextSetting.addSlider(slider => {
    const valueEl = beforeContextSetting.controlEl.createSpan({
      cls: 'glossa-inline-completion-slider-value',
      text: bi(`${plugin.settings.inlineCompletionContextBeforeChars} chars`, `${plugin.settings.inlineCompletionContextBeforeChars} 字符`),
    });
    slider
      .setLimits(200, 4_000, 100)
      .setValue(plugin.settings.inlineCompletionContextBeforeChars)
      .onChange(async value => {
        valueEl.setText(bi(`${value} chars`, `${value} 字符`));
        plugin.settings.inlineCompletionContextBeforeChars = value;
        dismissAllInlineCompletions();
        await plugin.saveSettings();
      });
  });

  const afterContextSetting = markGeneral(new Setting(containerEl)
    .setName(bi('Text after cursor', '光标后文范围'))
    .setDesc(bi(
      'Characters preserved as suffix context. This is especially important when completing inside an existing paragraph. Set to 0 to disable suffix awareness. Default: 200.',
      '作为后缀上下文发送的字符数。在已有段落中间补写时尤其重要；设为 0 会关闭后文感知。默认 200。',
    )));
  afterContextSetting.addSlider(slider => {
    const valueEl = afterContextSetting.controlEl.createSpan({
      cls: 'glossa-inline-completion-slider-value',
      text: bi(`${plugin.settings.inlineCompletionContextAfterChars} chars`, `${plugin.settings.inlineCompletionContextAfterChars} 字符`),
    });
    slider
      .setLimits(0, 2_000, 100)
      .setValue(plugin.settings.inlineCompletionContextAfterChars)
      .onChange(async value => {
        valueEl.setText(bi(`${value} chars`, `${value} 字符`));
        plugin.settings.inlineCompletionContextAfterChars = value;
        dismissAllInlineCompletions();
        await plugin.saveSettings();
      });
  });

  markGeneral(new Setting(containerEl)
    .setName(bi('Complete inside existing text', '允许段中补写'))
    .setDesc(bi(
      'When text remains after the cursor on the same line, fill only the missing bridge and preserve that suffix. Turn this off to request suggestions only at logical line endings.',
      '同一行光标后仍有文字时，只补齐中间缺口并保留原后文。关闭后只在逻辑行尾请求建议。',
    ))
    .addToggle(toggle => toggle
      .setValue(plugin.settings.inlineCompletionMiddleOfLine)
      .onChange(async value => {
        plugin.settings.inlineCompletionMiddleOfLine = value;
        dismissAllInlineCompletions();
        await plugin.saveSettings();
      })));

  const delaySetting = markGeneral(new Setting(containerEl)
    .setName(bi('Completion delay', '补全等待时间'))
    .setDesc(bi(
      'Wait this many milliseconds after the last edit before requesting a suggestion. Lower values react faster but can send more requests during brief pauses. Default: 650 ms.',
      '最后一次编辑后等待多少毫秒再请求建议。数值越低响应越快，但短暂停顿时可能产生更多请求。默认 650 ms。',
    )));
  delaySetting.addSlider(slider => {
    const valueEl = delaySetting.controlEl.createSpan({
      cls: 'glossa-inline-completion-slider-value',
      text: bi(`${plugin.settings.inlineCompletionDelayMs} ms`, `${plugin.settings.inlineCompletionDelayMs} 毫秒`),
    });
    slider
      .setLimits(300, 2_000, 50)
      .setValue(plugin.settings.inlineCompletionDelayMs)
      .onChange(async value => {
        valueEl.setText(bi(`${value} ms`, `${value} 毫秒`));
        plugin.settings.inlineCompletionDelayMs = value;
        await plugin.saveSettings();
      });
  });
}
