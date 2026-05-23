/**
 * Skill-scoped allow rules.
 *
 * When a skill is invoked, its `allowed-tools` frontmatter lists tool names
 * that should auto-approve while the skill is active in the current turn(s).
 * We store the active set here as a stack, so nested skill invocations don't
 * leak each other's allowlists. The agent loop consults `isAllowedForSkill`
 * BEFORE prompting the user for approval — a positive match short-circuits
 * the approval path the same way a persisted `allow` rule does.
 *
 * Lifetime: cleared between turns at the agent-loop level. Mirrors upstream
 * Claude Code's `contextModifier` that injects per-skill alwaysAllow rules.
 */

interface Frame {
  /** Skill name that pushed this frame. */
  skill: string;
  /** Tool names auto-allowed while this frame is on the stack. */
  tools: Set<string>;
}

const stack: Frame[] = [];

export function pushSkillFrame(skill: string, tools: string[] | undefined): void {
  if (!tools || tools.length === 0) {
    stack.push({ skill, tools: new Set() });
    return;
  }
  stack.push({ skill, tools: new Set(tools) });
}

export function popSkillFrame(skill: string): void {
  // Pop from the top until we find a matching frame (in case of skipped pops).
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].skill === skill) {
      stack.splice(i, 1);
      return;
    }
  }
}

/** True iff any active skill frame allows `toolName`. */
export function isAllowedForSkill(toolName: string): boolean {
  for (const f of stack) {
    if (f.tools.has(toolName)) return true;
  }
  return false;
}

/** Drop ALL skill frames. Call at session boundary.
 *
 *  Forks must NOT use this — see snapshotFrames/restoreFrames below.
 *  Calling clearSkillScopedAllowedTools() inside a forked sub-agent would
 *  wipe the parent's frames; the fork then returns but the parent has lost
 *  the protection that was active before it forked.
 *
 *  The bug was: sub_agent re-enters runAgentLoop, which at top calls
 *  clearSkillScopedAllowedTools(). Now main loop's `runAgentLoop` only calls
 *  it when entering a NEW user turn (not when re-entered by a fork), and
 *  fork callers use snapshot/restore explicitly.
 */
export function clearSkillScopedAllowedTools(): void {
  stack.length = 0;
}

/** Save the current frame stack to a returnable handle. The fork harness
 *  calls this just before entering the sub-agent loop, then `restoreFrames`
 *  after the fork returns — so the fork's clearSkillScopedAllowedTools()
 *  doesn't leak across the fork boundary. */
export function snapshotFrames(): readonly Frame[] {
  // Deep-copy the Sets so a later push in the parent doesn't mutate the
  // snapshot we'll restore.
  return stack.map(f => ({ skill: f.skill, tools: new Set(f.tools) }));
}

/** Restore a previously-snapshotted frame stack, replacing whatever the
 *  fork left behind. */
export function restoreFrames(snapshot: readonly Frame[]): void {
  stack.length = 0;
  for (const f of snapshot) stack.push({ skill: f.skill, tools: new Set(f.tools) });
}

/** Snapshot of currently-allowed tools (read-only). For UI / debug. */
export function activeSkillScopedTools(): readonly string[] {
  const out = new Set<string>();
  for (const f of stack) for (const t of f.tools) out.add(t);
  return [...out];
}
