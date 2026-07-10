
/**
 * Approximate token count. For English ~ chars/4, CJK ~ chars*1.3, code in between.
 * Good enough for context budgeting; not a substitute for tiktoken.
 */
export function estimateTokens(text: string | undefined | null): number {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if ((code >= 0x4e00 && code <= 0x9fff) ||      // CJK Unified
        (code >= 0x3000 && code <= 0x30ff) ||      // CJK symbols + hiragana/katakana
        (code >= 0xac00 && code <= 0xd7af)) {       // hangul
      cjk += 1;
    } else {
      other += 1;
    }
  }
  return Math.ceil(cjk * 1.0 + other / 4);
}

export function formatTokenCount(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}
