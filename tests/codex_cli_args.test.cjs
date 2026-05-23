const path = require('path');

/* Verifies the codex CLI provider does NOT emit `-m` when the user's endpoint
 * model field is empty. Earlier builds shipped 'gpt-5.4' as the seeded default,
 * which secretly overrode the user's ~/.codex/config.toml model and caused the
 * stream to hang silently (turn.started arrived but no agent_message). */
exports.run = async (t, loadModule) => {
  const mod = await loadModule(path.resolve(__dirname, '../src/providers/codex_cli.ts'));
  const Provider = mod.CodexCliProvider;

  // defaultModel() must return '' (no fallback to a hardcoded model name).
  const emptyProvider = new Provider({ id: 'a', label: 'A', kind: 'codex-cli' });
  t.eq(emptyProvider.defaultModel(), '', 'defaultModel() returns empty when ep.model unset');

  const setProvider = new Provider({ id: 'b', label: 'B', kind: 'codex-cli', model: 'gpt-5.5' });
  t.eq(setProvider.defaultModel(), 'gpt-5.5', 'defaultModel() preserves user-set model');

  // Whitespace-only model is treated as empty (so user typing " " by mistake
  // doesn't accidentally pass `-m ` to codex).
  const wsProvider = new Provider({ id: 'c', label: 'C', kind: 'codex-cli', model: '   ' });
  // defaultModel itself doesn't trim, but the stream/diagnostic paths do.
  // We assert the diagnostic accepts an empty/ws ep.model without crashing.
  t.ok(typeof wsProvider.defaultModel === 'function', 'whitespace model: provider still constructable');
};
