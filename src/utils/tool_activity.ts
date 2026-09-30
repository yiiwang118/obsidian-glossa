import type { ToolEvent } from '../types';
import { TOOL_META } from '../agent/tool_meta';
import { pathsTouchedByTool } from '../agent/checkpoint';
import { bi } from './i18n';

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

/** Count known files once; do not describe failed or pending calls as completed work. */
export function summarizeToolActivity(events: ToolEvent[]): string {
  const reads = new Set<string>(), writes = new Set<string>();
  const counts = { read: 0, write: 0, search: 0, web: 0, other: 0, error: 0, denied: 0, pending: 0 };
  for (const ev of new Map(events.map(event => [event.id, event])).values()) {
    if (ev.status !== 'success') {
      counts[ev.status === 'running' ? 'pending' : ev.status]++;
      continue;
    }
    const category = TOOL_META[ev.name]?.category;
    const args = record(ev.args);
    if (category === 'read') {
      const paths = ev.name === 'read_files' && Array.isArray(args.requests)
        ? args.requests.map(item => record(item).path)
        : ['read_note', 'read_pdf', 'view_image', 'read_canvas'].includes(ev.name) ? [args.path] : [];
      const known = paths.filter((path): path is string => typeof path === 'string' && !!path.trim());
      if (known.length) known.forEach(path => reads.add(path));
      else counts.read++;
    } else if (category === 'write') {
      const paths = pathsTouchedByTool(ev.name, args);
      if (paths.length) paths.forEach(path => writes.add(path));
      else counts.write++;
    } else if (category === 'search' || category === 'web') counts[category]++;
    else if (ev.name !== 'attempt_completion') counts.other++;
  }
  const parts: string[] = [];
  if (reads.size) parts.push(bi(`Read ${reads.size} files`, `读取 ${reads.size} 个文件`));
  if (counts.read) parts.push(bi(`${counts.read} read actions`, `读取 ${counts.read} 次`));
  if (counts.search) parts.push(bi(`${counts.search} searches`, `搜索 ${counts.search} 次`));
  if (counts.web) parts.push(bi(`${counts.web} web actions`, `联网 ${counts.web} 次`));
  if (writes.size) parts.push(bi(`Changed ${writes.size} files`, `变更 ${writes.size} 个文件`));
  if (counts.write) parts.push(bi(`${counts.write} write actions`, `写入 ${counts.write} 次`));
  if (counts.other) parts.push(bi(`${counts.other} other actions`, `其他操作 ${counts.other} 次`));
  if (counts.pending) parts.push(bi(`${counts.pending} unfinished`, `${counts.pending} 项待完成`));
  if (counts.error) parts.push(bi(`${counts.error} failed`, `${counts.error} 项失败`));
  if (counts.denied) parts.push(bi(`${counts.denied} not executed`, `${counts.denied} 项未执行`));
  return parts.join(' · ');
}
