const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

exports.run = async (t, loadModule) => {
  const { DeferredTasks } = await loadModule(path.resolve(__dirname, '../src/utils/deferred_tasks.ts'));
  const source = fs.readFileSync(path.resolve(__dirname, '../src/main.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const saved = [], notices = [], timers = new Map();
  let id = 0, storeWrites = 0, fetchCount = 0, resolveFetch;
  const originalSet = window.setTimeout, originalClear = window.clearTimeout;
  window.setTimeout = action => { timers.set(++id, action); return id; };
  window.clearTimeout = handle => timers.delete(handle);
  class Plugin {
    app = { workspace: { getLeavesOfType: () => [] } };
    manifest = { version: '0.8.0' };
    async saveData(value) { saved.push(value); }
  }
  const modules = {
    obsidian: { Plugin, Notice: class { constructor(text) { notices.push(text); } } },
    './utils/deferred_tasks': { DeferredTasks },
    './utils/i18n': { setLanguage() {}, bi: en => en },
    './utils/media_cache': { clearMediaCaches() {} },
    './utils/pdf_render': { clearRenderedPdfPageCache() {} },
    './agent/skills': { async flushPersistedNestedSkillDirs() {} },
    './features/update_check': {
      UPDATE_CHECK_INTERVAL_MS: 12 * 60 * 60 * 1000,
      fetchLatestUpdate: () => { fetchCount++; return new Promise(resolve => { resolveFetch = resolve; }); },
    },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => modules[name] ?? {}, window, console });
  const makePlugin = () => {
    const plugin = new exports.default();
    plugin.settings = { uiLanguage: 'en', updateCheckEnabled: true, updateLastCheckedAt: 0, updateLatestVersion: '', marker: 'initial' };
    plugin.store = { async persist() { storeWrites++; } };
    return plugin;
  };
  const drain = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  try {
    const plugin = makePlugin();
    plugin.settings.marker = 'first edit';
    await plugin.saveSettings();
    plugin.settings.marker = 'latest edit';
    await plugin.saveSettings();
    t.eq(timers.size, 1, 'multiple edits still coalesce into one delayed save');
    const queuedSave = [...timers.values()][0];
    plugin.onunload();
    await drain();
    t.eq(timers.size, 0, 'unload removes the delayed settings save');
    t.eq(saved.map(x => x.marker), ['latest edit'], 'unload persists the latest settings without losing them');
    t.eq(storeWrites, 1, 'unload also persists queued history');
    queuedSave();
    await drain();
    t.eq(saved.length, 1, 'already queued save callback cannot duplicate the unload flush');
    plugin.settings.marker = 'view close edit';
    await plugin.saveSettings();
    t.eq(saved.at(-1).marker, 'view close edit', 'a final view-close edit is saved immediately');
    t.eq(timers.size, 0, 'final view-close save does not leave another timer');

    const late = makePlugin();
    const request = late.checkForUpdates({ force: true, notify: true });
    t.eq(fetchCount, 1, 'update check starts normally');
    late.onunload();
    resolveFetch({ latestVersion: '0.9.0', releaseUrl: 'https://example.test/release' });
    t.eq(await request, null, 'response received after unload is discarded');
    t.eq(late.settings.updateLatestVersion, '', 'late response cannot mutate saved update settings');
    t.eq(notices.length, 0, 'late response cannot display an update notice');
    t.eq(await late.checkForUpdates({ force: true }), null, 'disabled plugin declines new checks');
    t.eq(fetchCount, 1, 'disabled plugin performs no new network request');

    const active = makePlugin();
    const normal = active.checkForUpdates({ force: true });
    resolveFetch({ latestVersion: '0.9.0', releaseUrl: 'https://example.test/release' });
    t.eq((await normal).latestVersion, '0.9.0', 'update checking remains functional while enabled');
    t.eq(notices.length, 1, 'active plugin retains update notifications');
    active.onunload();
    await drain();
  } finally {
    window.setTimeout = originalSet;
    window.clearTimeout = originalClear;
  }
};
