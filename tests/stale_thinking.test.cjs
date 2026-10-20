const path = require('path');

exports.run = async (t, load) => {
  const { withoutStaleThinking } = await load(path.resolve(__dirname, '../src/agent/loop.ts'));
  const block = name => [{ type: 'thinking', thinking: name, signature: `sig-${name}` }];
  const turn = () => [
    { role: 'user', content: 'earlier question' },
    { role: 'assistant', content: 'earlier answer' },
    { role: 'user', content: 'look at the picture' },
    { role: 'assistant', content: '', thinkingBlocks: block('one'), toolCalls: [{ id: 'c1', name: 'read_note', args: {} }] },
    { role: 'tool', toolCallId: 'c1', content: 'result one' },
    { role: 'assistant', content: '', thinkingBlocks: block('two'), toolCalls: [{ id: 'c2', name: 'read_note', args: {} }] },
    { role: 'tool', toolCallId: 'c2', content: 'result two' },
  ];
  const kept = list => list.map(m => m.thinkingBlocks?.[0]?.thinking ?? null).filter(Boolean);

  const untouched = turn();
  t.ok(withoutStaleThinking(untouched, () => false, false) === untouched, 'nothing changed: the messages are sent as they are');
  t.eq(kept(withoutStaleThinking(turn(), id => id === 'c1', false)), ['one'], 'blocks after a result pruned in this turn are left out');
  t.eq(kept(withoutStaleThinking(turn(), id => id === 'c2', false)), ['one', 'two'], 'a pruned last result leaves earlier blocks alone');
  t.eq(kept(withoutStaleThinking(turn(), () => false, true)), [], 'images no longer attached to the turn drop every block after them');
  const plain = [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }];
  t.ok(withoutStaleThinking(plain, () => true, true) === plain, 'messages without thinking blocks are untouched');
  const input = turn();
  withoutStaleThinking(input, () => false, true);
  t.eq(kept(input), ['one', 'two'], 'the stored messages are not changed');
};
