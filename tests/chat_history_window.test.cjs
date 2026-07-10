const path = require('path');

exports.run = async function(t, loadModule) {
  const mod = await loadModule(path.resolve(__dirname, '../src/utils/chat_history_window.ts'));
  const messages = [];
  for (let turn = 0; turn < 24; turn++) {
    messages.push({ id: `u${turn}`, role: 'user', content: `question ${turn}`, timestamp: turn });
    messages.push({ id: `a${turn}-1`, role: 'assistant', content: `answer ${turn}`, timestamp: turn });
    messages.push({ id: `a${turn}-2`, role: 'assistant', content: `tool follow-up ${turn}`, timestamp: turn, turnId: `t${turn}` });
  }

  const latest = mod.latestHistoryWindow(messages);
  t.eq(latest, { startTurn: 18, endTurn: 23 }, 'latest window renders only six user turns');
  const latestSelection = mod.selectChatHistory(messages, latest);
  t.eq(latestSelection.messages[0].id, 'u18', 'latest window starts on a user-turn boundary');
  t.eq(latestSelection.messages.at(-1).id, 'a23-2', 'latest window keeps every assistant segment in the final turn');
  t.eq(latestSelection.messages.length, 18, 'six three-message turns are selected');
  t.eq(latestSelection.hasEarlier, true, 'latest long conversation exposes earlier navigation');
  t.eq(latestSelection.hasNewer, false, 'latest window has no newer navigation');

  const earlier = mod.earlierHistoryWindow(messages, latest);
  t.eq(earlier, { startTurn: 12, endTurn: 23 }, 'first earlier page expands to the twelve-turn cap');
  const oldest = mod.earlierHistoryWindow(messages, earlier);
  t.eq(oldest, { startTurn: 6, endTurn: 17 }, 'second earlier page slides the bounded window');
  const oldestSelection = mod.selectChatHistory(messages, oldest);
  t.eq(oldestSelection.hasEarlier, true, 'middle window can navigate earlier');
  t.eq(oldestSelection.hasNewer, true, 'middle window can navigate newer');
  t.eq(mod.newerHistoryWindow(messages, oldest), earlier, 'newer navigation returns to the overlapping recent window');

  const assistantOnly = [
    { id: 'summary', role: 'assistant', content: 'summary', timestamp: 0 },
    { id: 'tail', role: 'assistant', content: 'tail', timestamp: 1 },
  ];
  const assistantWindow = mod.latestHistoryWindow(assistantOnly);
  t.eq(mod.selectChatHistory(assistantOnly, assistantWindow).messages.length, 2, 'assistant-only legacy history remains visible as one turn');
};
