import type { ContextItem, ContextItemRef } from '../types';
import type { PdfReadTask } from './pdf';

export type CurrentContextRole = 'none' | 'default-target' | 'ambient' | 'secondary';

const DOCUMENT_OPERATION = /(?:^|\s)\/(?:summarize|translate|improve|explain|critique|expand|diagram|cite|continue|toc|tldr)\b|总结|概括|摘要|梳理|解释|说明|翻译|改写|润色|评审|分析|提取|归纳|要点|目录|续写|继续写|summari[sz]e|explain|translate|rewrite|improve|critique|analy[sz]e|review|extract|key\s+points?|table\s+of\s+contents?|continue\s+writing|tldr/i;
const EXPLICIT_CURRENT = /(?:当前|正在打开|打开的|本)(?:文件|笔记|文档|PDF|图片|图像|页面|内容)|(?:这个|这篇|这份)(?:文件|笔记|文档|PDF|图片|图像|文章|内容)|current\s+(?:file|note|document|pdf|image)|open\s+(?:file|note|document|pdf|image)|this\s+(?:file|note|document|pdf|image)/i;

/** Decide how the model should use the open file. The file remains available
 * in every mode; this role controls task targeting rather than data inclusion. */
export function currentContextRole(
  userText: string,
  items: readonly Pick<ContextItem, 'label' | 'detail' | 'isCurrent'>[],
  hasExplicitAttachments: boolean,
): CurrentContextRole {
  const current = items.filter(item => item.isCurrent);
  if (!current.length) return 'none';
  if (hasExplicitAttachments) return 'secondary';
  const text = userText.trim();
  if (DOCUMENT_OPERATION.test(text) || EXPLICIT_CURRENT.test(text) || mentionsCurrentSource(text, current)) {
    return 'default-target';
  }
  return 'ambient';
}

export function buildCurrentContextPolicyHint(
  userText: string,
  items: readonly ContextItemRef[],
  hasExplicitAttachments: boolean,
): string {
  const role = currentContextRole(userText, items, hasExplicitAttachments);
  if (role === 'none') return '';
  const current = items.filter(item => item.isCurrent).map(item => item.detail || item.label).filter(Boolean);
  const attached = items.filter(item => !item.isCurrent).map(item => item.detail || item.label).filter(Boolean);
  const instructions = role === 'default-target'
    ? [
        'The open file is the default object of this content operation because no other target was supplied.',
        'Use its provided text or image directly. A text selection is optional: do not call get_selection or ask the user to select content merely because no selection exists.',
        'If extraction is incomplete, use the file path with read_note, read_pdf, or view_image instead of asking the user to paste the file.',
      ]
    : role === 'secondary'
      ? [
          'User-attached items are the primary target. Keep the open file as secondary context and use it only when the request connects them.',
        ]
      : [
          'The open file is available background context. Use it when relevant to the prompt, but do not let it replace an unrelated ongoing conversation task.',
        ];
  return [
    `<current-context-policy role="${role}">`,
    ...instructions,
    current.length ? `Open item(s): ${current.join('; ')}` : '',
    attached.length ? `Explicitly attached item(s): ${attached.join('; ')}` : '',
    '</current-context-policy>',
  ].filter(Boolean).join('\n');
}

/** Placeholder inserted into slash templates when source content travels in
 * the structured context/image channel instead of being pasted inline. */
export function buildContextSourceReference(
  file: { path: string; extension: string } | null,
  explicitItems: readonly Pick<ContextItem, 'label' | 'detail'>[],
): string {
  if (explicitItems.length) {
    const sources = explicitItems.map(item => item.detail || item.label).filter(Boolean).join('; ');
    return [
      '<source-reference kind="user-attached">',
      `Use the attached context item(s) as the source: ${sources}`,
      'Their content is supplied separately in <context> or as image input. A text selection is not required.',
      '</source-reference>',
    ].join('\n');
  }
  if (!file || file.extension === 'md') return '';
  return [
    '<source-reference kind="current-file">',
    `Use the currently open file as the source: ${file.path}`,
    'Its content is supplied separately in <context> or as image input. A text selection is not required.',
    '</source-reference>',
  ].join('\n');
}

/** Select an efficient PDF extraction strategy from the user's requested job. */
export function pdfReadTaskForPrompt(userText: string): PdfReadTask {
  const text = userText.trim();
  if (/\/(?:summarize|tldr)\b|总结|概括|摘要|归纳|summari[sz]e|tldr/i.test(text)) return 'summarize';
  if (/重命名|改名|命名|rename/i.test(text)) return 'rename';
  if (/标题|作者|元数据|检查|识别|title|author|metadata|inspect|identify/i.test(text)) return 'inspect';
  if (/搜索|查找|定位|检索|search|find|locate/i.test(text)) return 'search';
  return 'auto';
}

function mentionsCurrentSource(
  text: string,
  current: readonly Pick<ContextItem, 'label' | 'detail'>[],
): boolean {
  const lowered = text.toLowerCase();
  return current.some(item => {
    const candidates = [item.label, item.detail]
      .filter((value): value is string => typeof value === 'string' && value.trim().length >= 3)
      .flatMap(value => [value, value.split('/').pop() ?? value])
      .map(value => value.toLowerCase());
    return candidates.some(candidate => lowered.includes(candidate));
  });
}
