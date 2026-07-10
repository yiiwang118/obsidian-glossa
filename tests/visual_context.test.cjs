const path = require('path');

exports.run = async function(t, loadModule) {
  const mod = await loadModule(path.resolve(__dirname, '../src/utils/visual_context.ts'));
  t.eq(mod.shouldReuseRecentVisualContext('再详细一点', true), true, 'task continuation reuses recent visual context');
  t.eq(mod.shouldReuseRecentVisualContext('图中右上角是什么', false), true, 'explicit Chinese image reference reuses recent visual context');
  t.eq(mod.shouldReuseRecentVisualContext('what is shown in the screenshot?', false), true, 'explicit English screenshot reference reuses recent visual context');
  t.eq(mod.shouldReuseRecentVisualContext('换个话题，解释 MoE', false), false, 'unrelated new task releases recent visual context');
  const hint = mod.visualContinuityHint(['screen.png']);
  t.ok(hint.includes('previous-turn'), 'visual continuity hint declares its scope');
  t.ok(hint.includes('screen.png'), 'visual continuity hint names the reattached image');
};
