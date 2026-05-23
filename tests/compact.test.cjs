const path = require('path');

exports.run = async (t, loadModule) => {
  const mod = await loadModule(path.resolve(__dirname, '../src/agent/compact.ts'));

  // estimateMessageTokens: rough chars/4
  const m = { id: 'x', role: 'user', content: 'hello world', timestamp: 0 };
  t.ok(mod.estimateMessageTokens(m) > 0, 'estimate: non-zero for hello world');

  // estimateSessionTokens sums messages
  const session = { id: 's', title: 't', createdAt: 0, updatedAt: 0, mode: 'chat', endpointId: null,
    messages: [m, { id: 'y', role: 'assistant', content: 'a much longer response that uses more tokens', timestamp: 0 }] };
  t.ok(mod.estimateSessionTokens(session) > mod.estimateMessageTokens(m), 'session estimate > single msg');

  // applyCompact: replaces prefix, records snapshot
  const messages = [];
  for (let i = 0; i < 5; i++) messages.push({ id: 'm' + i, role: i % 2 ? 'assistant' : 'user', content: 'msg ' + i, timestamp: 0 });
  const sess = { id: 's2', title: 't', createdAt: 0, updatedAt: 0, mode: 'chat', endpointId: null, messages: [...messages] };
  const result = { summaryMsg: { id: 'sum', role: 'assistant', content: 'recap', timestamp: 0, compactSummary: true, summaryOfCount: 3, summaryTokensSaved: 100 }, summarisedCount: 3, tokensSaved: 100 };
  mod.applyCompact(sess, result, 2);
  t.eq(sess.messages.length, 3, 'applyCompact: summary + 2 kept');
  t.eq(sess.messages[0].id, 'sum', 'applyCompact: summary first');
  t.eq(sess.messages[1].id, 'm3', 'applyCompact: tail kept');
  t.eq(sess.compactHistory.length, 1, 'applyCompact: snapshot recorded');

  // undoCompact: restores
  const ok = mod.undoCompact(sess, 'sum');
  t.ok(ok, 'undoCompact: returns true');
  t.eq(sess.messages.length, 5, 'undoCompact: original count restored');
  t.eq(sess.messages[0].id, 'm0', 'undoCompact: ordering preserved');

  // undoCompact for unknown id is a no-op
  t.ok(!mod.undoCompact(sess, 'does-not-exist'), 'undoCompact: false for unknown');
};
