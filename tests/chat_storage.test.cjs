const path = require('path');

exports.run = async function(t, loadModule) {
  const mod = await loadModule(path.resolve(__dirname, '../src/utils/chat_storage.ts'));
  const original = [{
    id: 'a1',
    role: 'assistant',
    content: 'I inspected the image.',
    timestamp: 1,
    toolEvents: [{
      id: 'tool-1',
      name: 'view_image',
      args: { path: 'image.png' },
      result: 'Image: image.png',
      status: 'success',
      startedAt: 1,
      contentBlocks: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'A'.repeat(1000) } }],
      _modelBoundResult: 'internal preview',
    }],
  }];
  const stored = mod.chatMessagesForStorage(original);
  t.eq(stored[0].toolEvents[0].contentBlocks, undefined, 'chat storage omits transient base64 tool images');
  t.eq(stored[0].toolEvents[0]._modelBoundResult, undefined, 'chat storage omits duplicate model-bound preview');
  t.eq(stored[0].toolEvents[0].result, 'Image: image.png', 'chat storage keeps human-readable tool evidence');
  t.ok(original[0].toolEvents[0].contentBlocks.length === 1, 'storage projection does not mutate live session images');

  const migrated = JSON.parse(JSON.stringify(original));
  t.eq(mod.purgeTransientChatPayloads(migrated), 2, 'legacy migration reports both removed transient payloads');
  t.eq(migrated[0].toolEvents[0].contentBlocks, undefined, 'legacy migration removes base64 image payload');
  t.eq(mod.purgeTransientChatPayloads(migrated), 0, 'legacy migration is idempotent');
};
