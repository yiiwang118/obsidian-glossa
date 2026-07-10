const ERROR_RESULT_PREFIX = /^(?:error|failed|failure):(?:\s|$)/i;

export function toolResultLooksLikeError(text: string): boolean {
  return ERROR_RESULT_PREFIX.test(text.trimStart());
}

/** Per-turn guard against repeatedly retrying a tool that keeps failing. */
export class ToolFailureGuard {
  private readonly failures = new Map<string, number>();

  blockReason(toolName: string): string | null {
    const count = this.failures.get(toolName) ?? 0;
    if (count < 3) return null;
    return `Refused: ${toolName} has already failed ${count} times in this turn. ` +
      'Do not retry it again; change strategy, use the available evidence, or explain the blocker.';
  }

  record(toolName: string, failed: boolean): string | null {
    if (!failed) {
      this.failures.delete(toolName);
      return null;
    }
    const count = (this.failures.get(toolName) ?? 0) + 1;
    this.failures.set(toolName, count);
    if (count === 2) {
      return `${toolName} has failed twice in this turn. Inspect the concrete error and change arguments or strategy; do not make a blind retry.`;
    }
    if (count === 3) {
      return `${toolName} has failed three times in this turn. Stop using this tool for the current request and finish with another approach or report the blocker.`;
    }
    return null;
  }

  failureCount(toolName: string): number {
    return this.failures.get(toolName) ?? 0;
  }
}
