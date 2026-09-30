const path = require('node:path');
exports.run = async (t, load) => {
  const { modelPickerItems } = await load(path.resolve(__dirname, '../src/ui/model_picker.ts'));
  const { filterPopupItems } = await load(path.resolve(__dirname, '../src/ui/popup.ts'));
  const endpoints = [
    { id: 'alpha', label: 'Research', kind: 'custom-api', model: 'selected-old', availableModels: Array.from({ length: 80 }, (_, i) => `model-${i}`) },
    { id: 'beta', label: 'Writing', kind: 'openai', model: 'gpt-fixture', availableModels: ['gpt-fixture', 'gpt-fixture'] },
  ];
  let chosen;
  const items = modelPickerItems(endpoints, 'alpha', 'selected-old', (endpoint, model) => { chosen = [endpoint.id, model]; });
  t.eq(items.length, 82, 'all models remain available beyond the first 25, without duplicates');
  t.eq(items.filter(item => item.checked).map(item => item.label), ['selected-old'], 'current model remains checked even when absent from discovery');
  const matches = filterPopupItems(items, 'RESEARCH model-79');
  t.eq(matches.length, 1, 'search matches provider and model case-insensitively');
  matches[0].onSelect();
  t.eq(chosen, ['alpha', 'model-79'], 'late model selects its actual endpoint');
  t.eq(filterPopupItems(items, 'openai').map(item => item.label), ['gpt-fixture'], 'provider kind can be searched');
  const withActions = [{ label: 'Follow sidebar', alwaysVisible: true, onSelect() {} }, ...items];
  t.eq(filterPopupItems(withActions, 'gpt-fixture').map(item => item.label), ['gpt-fixture', 'Follow sidebar'], 'matching model precedes always-available actions');
  t.eq(filterPopupItems(withActions, 'nothing matches').length, 1, 'no match retains management without inventing model results');
  t.eq(modelPickerItems([{ id: 'empty', label: 'Local', kind: 'custom-api' }], 'empty', '', () => {})[0].checked, true, 'provider-default model remains selectable');
};
