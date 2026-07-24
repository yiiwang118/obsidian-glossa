export interface AgentToolCall {
  id: string;
  name: string;
  args: unknown;
}

export interface FileEditBatching {
  leaderArgs: Map<string, Record<string, unknown>>;
  followerToLeader: Map<string, string>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function comparablePath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/{2,}/g, '/');
}

/** Group sibling file_edit calls targeting the same file into one write. */
export function batchSameFileEdits(calls: readonly AgentToolCall[]): FileEditBatching {
  const groups = new Map<string, AgentToolCall[]>();
  for (const call of calls) {
    if (call.name !== 'file_edit') continue;
    const args = asRecord(call.args);
    if (!args || typeof args.file_path !== 'string') continue;
    if (typeof args.old_string !== 'string' || typeof args.new_string !== 'string') continue;
    if (args.old_string.length === 0) continue;
    const path = comparablePath(args.file_path);
    const list = groups.get(path) ?? [];
    list.push(call);
    groups.set(path, list);
  }

  const leaderArgs = new Map<string, Record<string, unknown>>();
  const followerToLeader = new Map<string, string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const leader = group[0];
    const leaderRecord = asRecord(leader.args);
    if (!leaderRecord) continue;
    leaderArgs.set(leader.id, {
      ...leaderRecord,
      edits: group.map(call => {
        const args = asRecord(call.args);
        if (!args || typeof args.old_string !== 'string' || typeof args.new_string !== 'string') {
          throw new Error('Invalid file_edit call reached a validated batch.');
        }
        return {
          old_string: args.old_string,
          new_string: args.new_string,
          replace_all: args.replace_all === true,
        };
      }),
    });
    for (const follower of group.slice(1)) followerToLeader.set(follower.id, leader.id);
  }
  return { leaderArgs, followerToLeader };
}
