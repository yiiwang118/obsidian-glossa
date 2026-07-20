const path = require('path');

exports.run = async function(t, loadModule) {
  const mod = await loadModule(path.resolve(__dirname, '../src/utils/pdf_selection.ts'));

  t.eq(
    mod.refinePdfSelectionText('e trainin', 'Test-time tim', 'g lowers cost.'),
    'training',
    'a shifted PDF word selection drops the grazed previous word and restores the missing suffix',
  );
  t.eq(
    mod.refinePdfSelectionText('time trainin', 'The method uses ', 'g to lower cost.'),
    'time training',
    'a phrase selection only repairs its incomplete final word',
  );
  t.eq(
    mod.refinePdfSelectionText('training', 'Test-time ', ' lowers cost.'),
    'training',
    'an already aligned word selection remains unchanged',
  );
  t.eq(
    mod.refinePdfSelectionText('e', 'tim', ' training'),
    'e',
    'a tiny ambiguous fragment is not expanded into a different word',
  );
  t.eq(
    mod.refinePdfSelectionText('测试时训练', '这里介绍', '方法。'),
    '测试时训练',
    'non-Latin selections are not changed by the Latin PDF boundary repair',
  );
  t.eq(
    mod.refinePdfSelectionText('raining', 't', ' is useful'),
    'training',
    'a nearly complete word can be repaired within the strict edge limit',
  );
  t.eq(
    mod.refinePdfSelectionText('rai', 't', 'ning is useful'),
    'rai',
    'the repair does not expand a short fragment across a distant boundary',
  );
};
