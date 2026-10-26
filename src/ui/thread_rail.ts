/** A question owns the following answer, until the next question reaches the reading line. */
export function activeQuestionIndex(tops: readonly number[], viewport: { top: number; height: number; scrollTop: number; scrollHeight: number }): number {
  if (!tops.length) return -1;
  const maxScroll = Math.max(0, viewport.scrollHeight - viewport.height);
  if (maxScroll > 2 && viewport.scrollTop >= maxScroll - 2) return tops.length - 1;
  const readingLine = viewport.top + Math.min(36, viewport.height / 4);
  let active = 0;
  for (let index = 0; index < tops.length; index++) {
    if (tops[index] > readingLine) break;
    active = index;
  }
  return active;
}
