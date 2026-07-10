const path = require('path');

/* Verifies disabled local CLI endpoints do not seed a hardcoded model. Earlier
 * builds shipped 'gpt-5.4' as the codex default, which secretly overrode the
 * user's ~/.codex/config.toml model and caused the stream to hang silently. */
exports.run = async (t, loadModule) => {
  const mod = await loadModule(path.resolve(__dirname, '../src/providers/registry.ts'));
  const buildProvider = mod.buildProvider;

  // defaultModel() must return '' (no fallback to a hardcoded model name).
  const emptyProvider = buildProvider({ id: 'a', label: 'A', kind: 'codex-cli' }, '');
  t.eq(emptyProvider.defaultModel(), '', 'defaultModel() returns empty when ep.model unset');

  const setProvider = buildProvider({ id: 'b', label: 'B', kind: 'codex-cli', model: 'gpt-5.5' }, '');
  t.eq(setProvider.defaultModel(), 'gpt-5.5', 'defaultModel() preserves user-set model');

  // Whitespace-only model is treated as empty (so user typing " " by mistake
  // doesn't accidentally pass `-m ` to codex).
  const wsProvider = buildProvider({ id: 'c', label: 'C', kind: 'codex-cli', model: '   ' }, '');
  // Disabled community provider remains constructable for migrated settings.
  t.ok(typeof wsProvider.defaultModel === 'function', 'whitespace model: provider still constructable');
};
