export interface SelectionRectBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export function clipSelectionRects(
  input: readonly SelectionRectBounds[],
  bounds: SelectionRectBounds,
): SelectionRectBounds[] {
  return input.flatMap((rect) => {
    const left = Math.max(bounds.left, rect.left);
    const top = Math.max(bounds.top, rect.top);
    const right = Math.min(bounds.right, rect.right);
    const bottom = Math.min(bounds.bottom, rect.bottom);
    if (right <= left || bottom <= top) return [];
    return [{ left, top, right, bottom, width: right - left, height: bottom - top }];
  });
}

interface SelectionLine {
  top: number;
  bottom: number;
  rects: SelectionRectBounds[];
}

function asBounds(rect: SelectionRectBounds): SelectionRectBounds {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.right - rect.left,
    height: rect.bottom - rect.top,
  };
}

export function mergeSelectionLineRects(
  input: readonly SelectionRectBounds[],
): SelectionRectBounds[] {
  const rects = input
    .filter(rect => rect.width > 0 && rect.height > 0)
    .map(asBounds)
    .sort((left, right) => left.top - right.top || left.left - right.left);
  const lines: SelectionLine[] = [];
  for (const rect of rects) {
    const line = lines.at(-1);
    const center = rect.top + rect.height / 2;
    const lineCenter = line ? (line.top + line.bottom) / 2 : 0;
    const lineHeight = line ? line.bottom - line.top : 0;
    const sameLine = line
      && Math.abs(center - lineCenter) <= Math.max(2, Math.min(rect.height, lineHeight) * 0.35);
    if (sameLine) {
      line.top = Math.min(line.top, rect.top);
      line.bottom = Math.max(line.bottom, rect.bottom);
      line.rects.push(rect);
    } else {
      lines.push({ top: rect.top, bottom: rect.bottom, rects: [rect] });
    }
  }

  for (let index = 0; index < lines.length - 1; index++) {
    const current = lines[index];
    const next = lines[index + 1];
    if (current.bottom < next.top) continue;
    const boundary = (current.bottom + next.top) / 2;
    current.bottom = Math.max(current.top + 1, boundary - 0.5);
    next.top = Math.min(next.bottom - 1, boundary + 0.5);
  }

  return lines.flatMap((line) => {
    const lineHeight = line.bottom - line.top;
    const segments: SelectionRectBounds[] = [];
    for (const rect of line.rects.sort((left, right) => left.left - right.left)) {
      const previous = segments.at(-1);
      const joinGap = Math.max(8, lineHeight * 0.8);
      if (previous && rect.left <= previous.right + joinGap) {
        previous.right = Math.max(previous.right, rect.right);
        previous.width = previous.right - previous.left;
        continue;
      }
      segments.push({
        left: rect.left,
        top: line.top,
        right: rect.right,
        bottom: line.bottom,
        width: rect.right - rect.left,
        height: lineHeight,
      });
    }
    return segments;
  });
}
