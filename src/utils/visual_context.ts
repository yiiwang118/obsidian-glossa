export function shouldReuseRecentVisualContext(userText: string, hasTaskContinuity: boolean): boolean {
  if (hasTaskContinuity) return true;
  const text = userText.trim();
  if (!text) return false;
  return /(?:这|那|上面|刚才)(?:张|幅|个)?(?:图|图片|图像|截图|照片)|(?:图|图片|图像|截图|照片)(?:中|里|上|显示)|(?:this|that|previous|above)\s+(?:image|screenshot|picture|figure)|(?:in|on)\s+(?:the\s+)?(?:image|screenshot|picture|figure)/i.test(text);
}

export function visualContinuityHint(imageNames: readonly string[]): string {
  if (!imageNames.length) return '';
  return [
    '<visual-context continuity="previous-turn">',
    `Reattached recent user image(s): ${imageNames.join('; ')}`,
    'These images belong to the immediately preceding task. Use them only because the current request continues or explicitly references that visual context.',
    '</visual-context>',
  ].join('\n');
}
