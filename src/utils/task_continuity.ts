export interface TaskContinuityToolEvent {
  name: string;
  args?: unknown;
  result?: string;
  status?: string;
}

export interface TaskContinuityMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content?: string;
  displayContent?: string;
  toolEvents?: readonly TaskContinuityToolEvent[];
}

export interface TaskContinuityContextRef {
  label: string;
  detail?: string;
  isCurrent?: boolean;
}

export interface TaskContinuityOptions {
  hasExplicitSelection?: boolean;
}

export function buildTaskContinuityHint(
  currentText: string,
  currentUserId: string,
  messages: readonly TaskContinuityMessage[],
  items: readonly TaskContinuityContextRef[],
  options: TaskContinuityOptions = {},
): string {
  if (hasPreviousTaskNegation(currentText)) return '';
  const responseRevision = looksLikeResponseRevision(currentText);
  const explicitPreviousTask = looksLikeExplicitPreviousTaskReference(currentText);
  if (!responseRevision && (!explicitPreviousTask || hasExplicitReplacementTarget(currentText)) && hasExplicitCurrentTaskTarget(currentText)) return '';
  if (!responseRevision && !explicitPreviousTask && options.hasExplicitSelection) return '';
  if (!responseRevision && !explicitPreviousTask && hasExplicitAttachedContext(items)) return '';
  const recentFailure = recentFailedToolSummary(currentUserId, messages);
  if (!responseRevision && !looksLikeTaskContinuation(currentText, !!recentFailure)) return '';
  const previous = previousExplicitUserRequest(currentUserId, messages, currentText);
  if (!previous) return '';

  const current = items.filter(it => it.isCurrent).map(it => it.detail || it.label).filter(Boolean);
  const previousRawText = previous.displayContent ?? previous.content ?? '';
  const previousText = compactTaskHintText(previousRawText, 420);
  const previousFailure = failedToolSummaryForUserTurn(previous.id, messages) || recentFailure;
  const targetLock = taskTargetLockSummary(previousRawText, previousFailure);
  const previousAnswer = responseRevision
    ? compactTaskHintText(previousAssistantAnswer(currentUserId, messages), 1_200)
    : '';
  return [
    '<task-continuity>',
    responseRevision
      ? 'The current user message is a language/style correction to the previous assistant answer, not a new request about the currently selected/open item. Re-answer the previous request now with this correction applied; do not ask what the user wants to do with the selection.'
      : 'The current user message appears to continue a previous unfinished request. Resolve short references like "内容", "这个", "它", "直接", "continue", or "that" against the previous explicit request below.',
    `Previous explicit request: ${previousText}`,
    previousAnswer ? `Previous assistant answer to revise: ${previousAnswer}` : '',
    targetLock ? `Task target lock: ${targetLock}` : '',
    previousFailure ? `Recent failed tool result(s): ${previousFailure}` : '',
    responseRevision && options.hasExplicitSelection
      ? 'A still-visible selection is supporting source context from the previous turn. Keep using it when relevant, but do not replace the previous task with a generic question about that selection.'
      : '',
    current.length ? `Ambient current/open item(s), not the target unless the user explicitly names them: ${current.join('; ')}` : '',
    'Keep the previous target until the user clearly names a different one. Before writing a file, verify the title/topic matches the locked target cues; if it matches an ambient item instead, stop and fetch/read the correct target.',
    '</task-continuity>',
  ].filter(Boolean).join('\n');
}

export function looksLikeTaskContinuation(text: string, hasRecentFailure: boolean): boolean {
  const s = text.replace(/\s+/g, ' ').trim();
  if (!s) return false;
  if (hasPreviousTaskNegation(s)) return false;
  if (looksLikeStrongTaskContinuation(s)) return true;
  if (!hasRecentFailure || s.length > 180) return false;
  return /(直接.*内容|获取.*内容|获得.*内容|这个|那个|这篇|那篇|这份|那份|它|\bthe content\b|\bthis\b|\bthat\b|\bit\b)/i.test(s);
}

export function looksLikeStrongTaskContinuation(text: string): boolean {
  const s = text.replace(/\s+/g, ' ').trim();
  return /(继续|接着|刚才|上面|之前|前面|上一|再试|重试|重新|按刚才|same|previous|above|retry|continue)/i.test(s);
}

/** High-precision follow-ups that revise the immediately previous answer rather
 * than introducing a new file/selection task. */
export function looksLikeResponseRevision(text: string): boolean {
  const s = text.replace(/\s+/g, ' ').trim().replace(/[。.!！?？]+$/, '');
  if (!s || s.length > 96) return false;
  return /^(?:请)?(?:用|改用|换成|改成)\s*(?:简体|繁体)?(?:中文|英文|英语)(?:回答|回复|重写|再说一遍)?$/i.test(s)
    || /^(?:中文|英文|英语)(?:回答|回复|重写|再说一遍)?$/i.test(s)
    || /^(?:把)?(?:上面|刚才|之前|这个回答|这个回复|答案|回答|回复)(?:的内容)?(?:改成|换成|重写为)\s*(?:简体|繁体)?(?:中文|英文|英语)$/i.test(s)
    || /^(?:再|更)?(?:简洁|详细|具体|专业|口语化|通俗)(?:一点)?$/i.test(s)
    || /^(?:please\s+)?(?:reply|respond|answer|rewrite)(?:\s+(?:that|it|the answer))?\s+in\s+(?:chinese|english)$/i.test(s)
    || /^(?:make|rewrite)\s+(?:that|it|the answer)\s+(?:shorter|longer|more concise|more detailed|in chinese|in english)$/i.test(s);
}

export function looksLikeExplicitPreviousTaskReference(text: string): boolean {
  const s = text.replace(/\s+/g, ' ').trim();
  if (hasPreviousTaskNegation(s)) return false;
  return /(刚才|刚刚|上面|之前|前面|上一|上次|前一个|上一个|按刚才|按之前|继续刚才|继续上面|重试刚才|重试上面|previous|above|prior|last task|previous task|same task|same as before|retry previous|retry that)/i.test(s);
}

export function hasExplicitCurrentTaskTarget(text: string): boolean {
  const s = text.replace(/\s+/g, ' ').trim();
  if (!s) return false;
  if (/(当前\s*(?:文件|笔记|PDF|图片|图像)|当前打开的\s*(?:文件|笔记|PDF|图片|图像)|打开的\s*(?:文件|笔记|PDF|图片|图像)|本(?:文件|笔记|PDF)|此(?:文件|笔记|PDF)|current\s+(?:file|note|pdf|image)|open\s+(?:file|note|pdf|image)|this\s+(?:file|note|pdf|image))/i.test(s)) return true;
  if (hasExplicitReplacementTarget(s)) return true;
  if (/https?:\/\/\S+/i.test(s) || /\[[^\]]{2,}\]\([^)]+\)/.test(s)) return true;
  if (hasInputFileReference(s)) return true;
  if (hasExplicitQuotedTarget(s)) return true;
  if (/\b[A-Z][\w-]+(?:\s+(?:[A-Z0-9][\w-]+|of|and|the|to|for|at|in|with|on)){2,}\b/.test(s)) return true;
  const verb = /(下载|读取|总结|阅读|翻译|分析|打开|处理)\s*/i.exec(s);
  if (!verb) return false;
  const target = s.slice(verb.index + verb[0].length).trim();
  if (startsWithShortReference(target)) return false;
  return /^[A-Za-z0-9\u4e00-\u9fff][^，。,.!?]{2,}(论文|文章|PDF|网页|链接|文件|笔记)/i.test(target);
}

export function compactTaskHintText(text: string, maxChars: number): string {
  const cleaned = text.replace(/<context>[\s\S]*?<\/context>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= maxChars) return cleaned;
  return cleaned.slice(0, Math.max(0, maxChars - 1)).trimEnd() + '...';
}

export function hasExplicitAttachedContext(items: readonly TaskContinuityContextRef[]): boolean {
  return items.some(it => !it.isCurrent);
}

export function hasExplicitReplacementTarget(text: string): boolean {
  return /(另一个|另一篇|另一份|新的|别的|\b(?:another|different|new)\s+(?:paper|article|pdf|file|note|url|link|document|one)\b)/i.test(text);
}

function previousExplicitUserRequest(
  currentUserId: string,
  messages: readonly TaskContinuityMessage[],
  currentText: string,
): TaskContinuityMessage | null {
  let fallback: TaskContinuityMessage | null = null;
  const cue = taskCueFor(currentText);
  const titleCue = taskTitleCueFor(currentText);
  const urlCue = urlOrDomainCueFor(currentText);
  const hasSpecificCue = !!urlCue || !!titleCue;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.id === currentUserId || m.role !== 'user') continue;
    if (!fallback) fallback = m;
    const text = m.displayContent ?? m.content ?? '';
    const searchable = `${text}\n${failedToolSummaryForUserTurn(m.id, messages)}`.toLowerCase();
    if (urlCue && searchable.includes(urlCue) && !looksLikeTaskContinuation(text, false)) return m;
    if (titleCue && searchable.includes(titleCue) && !looksLikeTaskContinuation(text, false)) return m;
    if (cue && taskCueFor(text) === cue && !looksLikeTaskContinuation(text, false)) return m;
  }
  if (hasSpecificCue) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.id === currentUserId || m.role !== 'user') continue;
    const text = m.displayContent ?? m.content ?? '';
    if (!looksLikeTaskContinuation(text, false)) return m;
  }
  return fallback;
}

function previousAssistantAnswer(
  currentUserId: string,
  messages: readonly TaskContinuityMessage[],
): string {
  const currentIndex = messages.findIndex(message => message.id === currentUserId);
  const start = currentIndex >= 0 ? currentIndex - 1 : messages.length - 1;
  for (let i = start; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== 'assistant') continue;
    const content = message.displayContent ?? message.content ?? '';
    if (content.trim()) return content;
  }
  return '';
}

function failedToolSummaryForUserTurn(
  userId: string,
  messages: readonly TaskContinuityMessage[],
): string {
  const userIndex = messages.findIndex(m => m.id === userId);
  if (userIndex < 0) return '';
  const failed: string[] = [];
  for (let i = userIndex + 1; i < messages.length && failed.length < 4; i++) {
    const m = messages[i];
    if (m.role === 'user') break;
    for (const ev of m.toolEvents ?? []) {
      const summary = failedToolEventSummary(ev);
      if (!summary) continue;
      failed.push(summary);
      if (failed.length >= 4) break;
    }
    if (failed.length >= 4) break;
    const textSummary = failedMessageTextSummary(m);
    if (textSummary) failed.push(textSummary);
  }
  return failed.join('; ');
}

function recentFailedToolSummary(
  currentUserId: string,
  messages: readonly TaskContinuityMessage[],
): string {
  const failed: string[] = [];
  for (let i = messages.length - 1; i >= 0 && failed.length < 4; i--) {
    const m = messages[i];
    if (m.id === currentUserId) continue;
    if (m.role === 'user') break;
    for (const ev of m.toolEvents ?? []) {
      const summary = failedToolEventSummary(ev);
      if (!summary) continue;
      failed.push(summary);
      if (failed.length >= 4) break;
    }
    if (failed.length >= 4) break;
    const textSummary = failedMessageTextSummary(m);
    if (textSummary) failed.push(textSummary);
  }
  return failed.join('; ');
}

function failedToolEventSummary(ev: TaskContinuityToolEvent): string {
  const result = ev.result ?? '';
  const failedByResult = /^(Error|Failed)\b|failed to fetch|Failed to fetch|not found|Nothing was saved|timed out/i.test(result);
  if (ev.status !== 'error' && ev.status !== 'denied' && !failedByResult) return '';
  return `${ev.name}${toolTargetSuffix(ev)} -> ${compactTaskHintText(result, 180)}`;
}

function failedMessageTextSummary(message: TaskContinuityMessage): string {
  if (message.role !== 'assistant' && message.role !== 'tool') return '';
  const text = message.displayContent ?? message.content ?? '';
  if (!looksLikeFailureText(text)) return '';
  return `${message.role} -> ${compactTaskHintText(text, 240)}`;
}

function looksLikeFailureText(text: string): boolean {
  const s = text.replace(/\s+/g, ' ').trim();
  if (!s) return false;
  const action = '(?:下载|获取|读取|访问|打开|写入|保存|生成|创建|修改|执行|连接|解析|完成|找到|写成|抓取)';
  const unableAction = new RegExp(`(?:无法|不能)[^。.!?]{0,12}${action}`, 'i');
  const actionFailed = new RegExp(`${action}[^。.!?]{0,40}(?:失败|出错|错误|不成功)`, 'i');
  return /(?:\*\*\[error\]\*\*|\[error\]|failed to fetch|fetch failed|turn failed|stream error|not found|timed out|timeout|nothing was saved|没能|未能|没有[^。.!?]{0,40}成功)/i.test(s)
    || unableAction.test(s)
    || actionFailed.test(s)
    || /错误[:：]/.test(s);
}

function taskTargetLockSummary(previousText: string, previousFailure: string): string {
  const targetCues = collectTargetCues(previousText, previousFailure);
  const outputDestinations = collectOutputDestinations(previousText);
  return [
    targetCues.length ? `target cues: ${targetCues.join('; ')}` : '',
    outputDestinations.length ? `requested output: ${outputDestinations.join('; ')}` : '',
  ].filter(Boolean).join(' | ');
}

function collectTargetCues(previousText: string, previousFailure: string): string[] {
  const cues: string[] = [];
  const combined = `${previousText}\n${previousFailure}`;
  for (const url of combined.match(/https?:\/\/[^\s)>，。]+/gi) ?? []) {
    pushCue(cues, url);
  }
  for (const pattern of quotedTargetPatterns()) {
    for (const match of previousText.matchAll(pattern)) {
      pushCue(cues, match[1] ?? '');
    }
  }
  for (const match of previousText.matchAll(/([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){1,3})\s+写的/g)) {
    pushCue(cues, match[1] ?? '');
  }
  for (const match of previousText.matchAll(/(?:写的|called|named|about)\s+([A-Za-z0-9][A-Za-z0-9 '&:.-]{3,90}?)(?=(?:放到|放在|保存|存到|写成|整理|下载|$|[，。,.!?]))/gi)) {
    pushCue(cues, match[1] ?? '');
  }
  for (const match of previousText.matchAll(/\b[A-Z][A-Za-z0-9'-]+(?:\s+(?:[A-Z0-9][A-Za-z0-9'-]+|of|and|the|to|for|at|in|with|on)){1,7}\b/g)) {
    pushCue(cues, match[0] ?? '');
  }
  return cues.slice(0, 6);
}

function collectOutputDestinations(previousText: string): string[] {
  const destinations: string[] = [];
  for (const match of previousText.matchAll(/(?:放到|放在|保存到|存到|写到|写入|输出到)\s*([^\s，。,.!?]+)/g)) {
    const destination = normalizeCue(match[1] ?? '')
      .replace(/(?:下面|下|里|中|目录)$/u, '')
      .trim();
    pushCue(destinations, destination);
  }
  return destinations.slice(0, 3);
}

function pushCue(cues: string[], value: string): void {
  const cue = normalizeCue(value);
  if (!cue || isShortReferenceText(cue)) return;
  if (cues.some(existing => existing.toLowerCase() === cue.toLowerCase())) return;
  cues.push(cue);
}

function normalizeCue(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'“”「」《》()[\],，。:：;；-]+|[\s"'“”「」《》()[\],，。:：;；-]+$/g, '')
    .trim();
}

function toolTargetSuffix(ev: TaskContinuityToolEvent): string {
  const args = isRecord(ev.args) ? ev.args : null;
  if (!args) return '';
  const target = ['url', 'path', 'save_to', 'query']
    .map(k => typeof args[k] === 'string' ? `${k}=${compactTaskHintText(args[k], 120)}` : '')
    .filter(Boolean)
    .join(', ');
  return target ? `(${target})` : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function taskCueFor(text: string): string {
  const s = text.replace(/\s+/g, ' ').trim();
  if (/(下载|fetch|download|获取网页|获取链接)/i.test(s)) return 'download';
  if (/(搜索|查找|search|find)/i.test(s)) return 'search';
  if (/(总结|摘要|summarize|summary)/i.test(s)) return 'summarize';
  if (/(翻译|translate)/i.test(s)) return 'translate';
  if (/(读取|阅读|read)/i.test(s)) return 'read';
  if (/(写成|写入|写到|生成|write|save|output)/i.test(s)) return 'write';
  return '';
}

function taskTitleCueFor(text: string): string {
  const s = text.replace(/\s+/g, ' ').trim();
  for (const pattern of quotedTargetPatterns()) {
    for (const match of s.matchAll(pattern)) {
      const quoted = match[1]?.trim() ?? '';
      if (quoted && !isShortReferenceText(quoted)) return quoted.toLowerCase();
    }
  }
  const titleCase = /\b[A-Z][\w-]+(?:\s+(?:[A-Z0-9][\w-]+|of|and|the|to|for|at|in|with|on)){1,}\b/.exec(s);
  if (titleCase) return titleCase[0].toLowerCase();
  const referenced = /(?:关于|那个|那篇|about|called|named)\s+([A-Za-z0-9][A-Za-z0-9 -]{5,80})/i.exec(s);
  if (!referenced) return '';
  return referenced[1]
    .replace(/\b(?:task|download|summary|summarize|translate|paper|article)\b.*$/i, '')
    .replace(/(?:任务|下载|总结|翻译|论文|文章).*$/, '')
    .trim()
    .toLowerCase();
}

function urlOrDomainCueFor(text: string): string {
  const url = /https?:\/\/([^\s/?#)]+)/i.exec(text);
  if (url?.[1]) return url[1].toLowerCase();
  const domain = /\b((?:[a-z0-9-]+\.)+[a-z]{2,})(?:[/:?#][^\s)]*)?/i.exec(text);
  const host = domain?.[1]?.toLowerCase() ?? '';
  if (!host) return '';
  const lastPart = host.split('.').pop() ?? '';
  if (/^(md|markdown|pdf|txt|doc|docx|html|htm)$/.test(lastPart)) return '';
  return host;
}

function hasPreviousTaskNegation(text: string): boolean {
  const s = text.replace(/\s+/g, ' ').trim();
  return /(不要|别|不用|不是|并非|不要再|别再).*?(继续|接着|重试|按).*?(刚才|刚刚|上面|之前|前面|上一|上次|前一个|上一个)/.test(s)
    || /\b(?:do not|don't|dont|not|no need to|stop)\b.*?\b(?:continue|retry|use|follow)\b.*?\b(?:previous|above|prior|last|same)\b/i.test(s)
    || /\b(?:do not|don't|dont|not|no need to|stop)\b.*?\b(?:previous task|last task|same task)\b/i.test(s);
}

function hasExplicitQuotedTarget(text: string): boolean {
  for (const pattern of quotedTargetPatterns()) {
    for (const match of text.matchAll(pattern)) {
      const quoted = match[1]?.trim() ?? '';
      if (quoted && !isShortReferenceText(quoted)) return true;
    }
  }
  return false;
}

function quotedTargetPatterns(): RegExp[] {
  return [
    /《([^》]{2,})》/g,
    /「([^」]{2,})」/g,
    /“([^”]{2,})”/g,
    /"([^"]{2,})"/g,
  ];
}

function hasInputFileReference(text: string): boolean {
  const fileRefPattern = /(?:^|[\s"'“”「」《》])((?:[./~]?[\w.-]+\/)*(?:[\w .-]+)\.(?:pdf|md|markdown|html?|txt|docx?))\b/gi;
  for (const match of text.matchAll(fileRefPattern)) {
    const start = (match.index ?? 0) + match[0].length - (match[1]?.length ?? 0);
    if (!isOutputFileReference(text, start)) return true;
  }
  return false;
}

function isOutputFileReference(text: string, fileStart: number): boolean {
  const prefix = text.slice(Math.max(0, fileStart - 48), fileStart);
  return /(写到|写入|保存到|存到|放到|放在|输出到|命名为|另存为)\s*$/.test(prefix)
    || /\b(?:save|write|output|export)\b[\w\s"'“”「」《》-]{0,32}\b(?:as|to|into)\s*$/i.test(prefix);
}

function startsWithShortReference(text: string): boolean {
  const s = text.trim();
  if (!s) return false;
  return /^(?:(?:这个|那个)(?:内容|文件|PDF|笔记|文章|论文)?|(?:这篇|那篇)(?:论文|文章)?|(?:这份|那份)(?:文件|PDF|笔记)?|它|当前|上面|刚才|之前|内容)(?:\s|[，。,.!?、；;:：]|$)/.test(s)
    || /^(the content|this content|that content|this|that|it)(?:\s|[，。,.!?;:]|$)/i.test(s);
}

function isShortReferenceText(text: string): boolean {
  const s = text.replace(/\s+/g, ' ').trim();
  if (!s) return false;
  return /^(?:(?:这个|那个)(?:内容|文件|PDF|笔记|文章|论文)?|(?:这篇|那篇)(?:论文|文章)?|(?:这份|那份)(?:文件|PDF|笔记)?|它|当前|上面|刚才|之前|内容)$/.test(s)
    || /^(the content|this content|that content|this|that|it)$/i.test(s);
}
