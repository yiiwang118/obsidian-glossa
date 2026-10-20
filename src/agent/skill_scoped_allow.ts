/**
 * Skill-scoped allow rules.
 *
 * When a skill is invoked, its `allowed-tools` frontmatter lists tool names
 * that auto-approve for the rest of that turn. Each agent run (one chat turn,
 * or one forked skill) owns its own scope: chats running at the same time
 * never see each other's skills, and a new turn starts empty. Frames form a
 * stack so nested skill invocations don't leak each other's allowlists. The
 * agent loop consults `allows` BEFORE prompting the user for approval — a
 * positive match short-circuits the approval path the same way a persisted
 * `allow` rule does. Mirrors upstream Claude Code's `contextModifier` that
 * injects per-skill alwaysAllow rules.
 */

interface Frame {
  /** Skill name that pushed this frame. */
  skill: string;
  /** Tool names auto-allowed while this frame is on the stack. */
  tools: Set<string>;
}

export class SkillAllowScope {
  private frames: Frame[] = [];

  push(skill: string, tools: string[] | undefined): void {
    this.frames.push({ skill, tools: new Set(tools ?? []) });
  }

  pop(skill: string): void {
    // Pop from the top until we find a matching frame (in case of skipped pops).
    for (let i = this.frames.length - 1; i >= 0; i--) {
      if (this.frames[i].skill === skill) {
        this.frames.splice(i, 1);
        return;
      }
    }
  }

  /** True iff any active skill frame allows `toolName`. */
  allows(toolName: string): boolean {
    return this.frames.some(frame => frame.tools.has(toolName));
  }

  /** Currently allowed tools (read-only). For UI / debug. */
  tools(): readonly string[] {
    const out = new Set<string>();
    for (const frame of this.frames) for (const tool of frame.tools) out.add(tool);
    return [...out];
  }
}
