const path = require('path');

exports.run = async (t, loadModule) => {
  const types = await loadModule(path.resolve(__dirname, '../src/types.ts'));
  t.eq(types.DEFAULT_SETTINGS.permissionLevel, 'read-only', 'defaults: permission starts read-only');
  t.eq(types.DEFAULT_SETTINGS.runMode, 'plan', 'defaults: run mode starts plan');

  const diff = await loadModule(path.resolve(__dirname, '../src/utils/diff.ts'));
  const oldText = Array.from({ length: 3000 }, (_, i) => `old ${i}`).join('\n');
  const newText = Array.from({ length: 3000 }, (_, i) => `new ${i}`).join('\n');
  const ops = diff.lineDiff(oldText, newText);
  t.ok(ops.length < 400 && /diff too large/.test(ops[0]?.text ?? ''), 'large diff uses bounded preview');
};
