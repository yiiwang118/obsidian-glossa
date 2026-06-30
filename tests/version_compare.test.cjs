const path = require('path');

exports.run = async function(t, loadModule) {
  const mod = await loadModule(path.resolve(__dirname, '../src/utils/version.ts'));

  t.eq(mod.compareSemver('0.5.10', '0.5.2'), 1, 'semantic numeric segments compare numerically');
  t.eq(mod.compareSemver('v0.5.2', '0.5.2'), 0, 'leading v is ignored');
  t.eq(mod.compareSemver('0.6.0', '0.5.99'), 1, 'minor version wins over patch');
  t.eq(mod.compareSemver('0.5.2', '0.5.3'), -1, 'older patch is lower');
};
