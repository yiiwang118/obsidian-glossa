export interface HistoricalToolResultOptions {
  toolName: string;
  result: string;
  status: string;
  isRecent: boolean;
  maxChars?: number;
}

const SALIENT_LINE = /(?:^|\b)(?:error|failed|failure|denied|downloaded|saved|created|modified|deleted|source|final url|sha256|path|file|target|results?|matches?|next|warning|timeout|not found)\b|(?:错误|失败|拒绝|已下载|已保存|已创建|已修改|已删除|来源|路径|文件|目标|结果|匹配|下一步|警告|超时|未找到)/i;

/** Keep recent tool evidence verbatim while compacting older bulky results to
 * an auditable head/key-lines/tail record. */
export function compactHistoricalToolResult(options: HistoricalToolResultOptions): string {
  const result = options.result.trim();
  if (!result || options.isRecent) return options.result;
  const defaultLimit = options.status === 'error' || options.status === 'denied' ? 1_800 : 1_100;
  const maxChars = Math.max(300, options.maxChars ?? defaultLimit);
  if (result.length <= maxChars) return options.result;

  const lines = result.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const salient = unique(lines.filter(line => SALIENT_LINE.test(line))).slice(0, 12);
  const headLimit = Math.max(180, Math.floor(maxChars * 0.45));
  const tailLimit = Math.max(120, Math.floor(maxChars * 0.2));
  const head = result.slice(0, headLimit).trimEnd();
  const tail = result.slice(-tailLimit).trimStart();
  const record = [
    `[older ${options.toolName} result compacted: ${result.length.toLocaleString()} chars; status=${options.status}]`,
    head,
    salient.length ? `\nKey lines:\n${salient.map(line => `- ${line}`).join('\n')}` : '',
    `\n[...older result elided...]\n${tail}`,
  ].filter(Boolean).join('\n');
  if (record.length <= maxChars + 240) return record;
  return `${record.slice(0, maxChars + 220).trimEnd()}\n[compacted preview capped]`;
}

export function compactHistoricalToolArgs(value: unknown, isRecent: boolean): unknown {
  if (isRecent) return value;
  return compactValue(value, 0);
}

function compactValue(value: unknown, depth: number): unknown {
  if (typeof value === 'string') {
    if (value.length <= 700) return value;
    return `${value.slice(0, 420)}\n[...${value.length - 620} argument chars elided...]\n${value.slice(-200)}`;
  }
  if (typeof value !== 'object' || value === null) return value;
  if (depth >= 4) return '[nested argument elided]';
  if (Array.isArray(value)) {
    const kept = value.slice(0, 20).map(item => compactValue(item, depth + 1));
    if (value.length > kept.length) kept.push(`[...${value.length - kept.length} items elided...]`);
    return kept;
  }
  const out: Record<string, unknown> = {};
  const entries = Object.entries(value);
  for (const [key, item] of entries.slice(0, 40)) out[key] = compactValue(item, depth + 1);
  if (entries.length > 40) out._elided = `${entries.length - 40} keys`;
  return out;
}

function unique(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}
