import type { ChatMessage } from '../types';

export interface ChatHistoryWindow {
  startTurn: number;
  endTurn: number;
}

export interface SelectedChatHistory {
  messages: ChatMessage[];
  totalTurns: number;
  window: ChatHistoryWindow;
  hasEarlier: boolean;
  hasNewer: boolean;
}

export const INITIAL_HISTORY_TURNS = 6;
export const HISTORY_PAGE_TURNS = 6;
export const MAX_HISTORY_TURNS = 12;

interface TurnRange {
  startMessage: number;
  endMessage: number;
}

export function latestHistoryWindow(messages: readonly ChatMessage[]): ChatHistoryWindow {
  const total = buildTurnRanges(messages).length;
  return total === 0
    ? { startTurn: 0, endTurn: -1 }
    : { startTurn: Math.max(0, total - INITIAL_HISTORY_TURNS), endTurn: total - 1 };
}

export function earlierHistoryWindow(
  messages: readonly ChatMessage[],
  current: ChatHistoryWindow,
): ChatHistoryWindow {
  const total = buildTurnRanges(messages).length;
  const window = normalizeWindow(current, total);
  if (total === 0 || window.startTurn === 0) return window;
  const startTurn = Math.max(0, window.startTurn - HISTORY_PAGE_TURNS);
  return {
    startTurn,
    endTurn: Math.min(window.endTurn, startTurn + MAX_HISTORY_TURNS - 1),
  };
}

export function newerHistoryWindow(
  messages: readonly ChatMessage[],
  current: ChatHistoryWindow,
): ChatHistoryWindow {
  const total = buildTurnRanges(messages).length;
  const window = normalizeWindow(current, total);
  if (total === 0 || window.endTurn >= total - 1) return window;
  const endTurn = Math.min(total - 1, window.endTurn + HISTORY_PAGE_TURNS);
  return {
    startTurn: Math.max(0, endTurn - MAX_HISTORY_TURNS + 1),
    endTurn,
  };
}

export function selectChatHistory(
  messages: readonly ChatMessage[],
  requested: ChatHistoryWindow,
): SelectedChatHistory {
  const ranges = buildTurnRanges(messages);
  const totalTurns = ranges.length;
  const window = normalizeWindow(requested, totalTurns);
  if (totalTurns === 0 || window.endTurn < 0) {
    return { messages: [], totalTurns, window, hasEarlier: false, hasNewer: false };
  }
  const startMessage = ranges[window.startTurn]?.startMessage ?? 0;
  const endMessage = ranges[window.endTurn]?.endMessage ?? messages.length - 1;
  return {
    messages: messages.slice(startMessage, endMessage + 1),
    totalTurns,
    window,
    hasEarlier: window.startTurn > 0,
    hasNewer: window.endTurn < totalTurns - 1,
  };
}

function buildTurnRanges(messages: readonly ChatMessage[]): TurnRange[] {
  if (!messages.length) return [];
  const ranges: TurnRange[] = [];
  let startMessage = 0;
  let hasUserTurn = false;
  for (let index = 0; index < messages.length; index++) {
    if (messages[index].role !== 'user') continue;
    if (hasUserTurn || index > 0) ranges.push({ startMessage, endMessage: index - 1 });
    startMessage = index;
    hasUserTurn = true;
  }
  ranges.push({ startMessage: hasUserTurn ? startMessage : 0, endMessage: messages.length - 1 });
  return ranges;
}

function normalizeWindow(window: ChatHistoryWindow, totalTurns: number): ChatHistoryWindow {
  if (totalTurns === 0) return { startTurn: 0, endTurn: -1 };
  const endTurn = Math.max(0, Math.min(totalTurns - 1, window.endTurn));
  return {
    startTurn: Math.max(0, Math.min(endTurn, window.startTurn)),
    endTurn,
  };
}
