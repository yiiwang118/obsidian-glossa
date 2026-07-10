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

  const transcriptMessages = [
    {
      id: 'u-command',
      role: 'user',
      content: 'Long expanded English slash template that should not replace the visible request.',
      displayContent: '/explain BLIP2是什么方法',
      selectionEcho: { text: 'An English PDF excerpt about BLIP2.', source: 'pdf', file: 'Paper/BLIP2.pdf' },
      timestamp: 0,
    },
    {
      id: 'a-failed',
      role: 'assistant',
      content: 'The first answer was in English.',
      toolEvents: [{
        id: 'tool-1',
        name: 'web_fetch',
        args: { url: 'https://example.com/paper.pdf' },
        result: 'Failed to fetch: certificate error at https://example.com/paper.pdf',
        status: 'error',
        startedAt: 0,
      }],
      timestamp: 0,
    },
    { id: 'u-correction', role: 'user', content: '用中文', timestamp: 0 },
    { id: 'a-tail', role: 'assistant', content: '中文回答。', timestamp: 0 },
  ];
  const transcript = mod.buildCompactionTranscript(transcriptMessages, {
    keepRecent: 1,
    perMsgCap: 4000,
    maxTranscriptChars: 20000,
  });
  t.ok(transcript.transcript.includes('/explain BLIP2是什么方法'), 'compaction uses visible slash request instead of expanded template');
  t.ok(transcript.transcript.includes('Paper/BLIP2.pdf'), 'compaction preserves selection source path');
  t.ok(transcript.transcript.includes('Failed to fetch: certificate error'), 'compaction preserves concrete failed-tool evidence');
  t.ok(transcript.transcript.includes('[USER]\n用中文'), 'compaction preserves the language correction verbatim');

  const cappedMessages = [];
  for (let i = 0; i < 20; i++) {
    cappedMessages.push({
      id: `cap-${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `${i === 0 ? 'INITIAL-TARGET ' : ''}${i === 18 ? 'LATEST-CORRECTION ' : ''}${'x'.repeat(500)}`,
      timestamp: 0,
    });
  }
  const capped = mod.buildCompactionTranscript(cappedMessages, {
    keepRecent: 1,
    perMsgCap: 1000,
    maxTranscriptChars: 4000,
  });
  t.ok(capped.transcript.length <= 4000, 'compaction input obeys total transcript cap');
  t.ok(capped.transcript.includes('INITIAL-TARGET'), 'capped compaction preserves initial task anchor');
  t.ok(capped.transcript.includes('LATEST-CORRECTION'), 'capped compaction preserves recent corrections');
};
