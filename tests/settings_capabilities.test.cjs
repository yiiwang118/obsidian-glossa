const fs = require('fs');
const path = require('path');

exports.run = async function run(t, loadModule) {
  const catalogModule = await loadModule(path.join(__dirname, '../src/ui/capability_catalog.ts'));
  const issues = catalogModule.toolCatalogIssues();
  t.eq(issues, [], 'every available tool has Chinese capability copy');

  const catalog = catalogModule.buildToolCapabilities(['read_note']);
  t.ok(catalog.length >= 25, 'catalog exposes the active local tool surface');
  t.ok(catalog.some(tool => !tool.deferred), 'catalog includes default tools');
  t.ok(catalog.some(tool => tool.deferred), 'catalog includes on-demand tools');
  t.ok(catalog.find(tool => tool.name === 'read_note')?.autoApproved, 'catalog reflects auto-approval state');
  t.ok(!catalog.some(tool => tool.name === 'run_skill'), 'deprecated compatibility tools stay hidden');
  t.ok(catalog.every(tool => tool.labelZh && tool.descriptionZh.length >= 8), 'Chinese tool copy is meaningful');

  const settingsSource = fs.readFileSync(path.join(__dirname, '../src/settings.ts'), 'utf8');
  t.ok(settingsSource.includes("type SettingsTab = 'general' | 'providers' | 'agent' | 'capabilities' | 'advanced'"), 'settings keeps five task-oriented tabs');
  t.ok(!settingsSource.includes("{ id: 'mcp'"), 'disabled MCP page is not exposed');
  t.ok(settingsSource.includes('renderCapabilities(containerEl, generation)'), 'settings renders the visual capability catalog');
  t.ok(settingsSource.includes('createAlignedSelect('), 'settings uses the aligned custom select control');
  t.ok(!settingsSource.includes('.addDropdown('), 'settings has no native Obsidian dropdowns');
  t.ok(!settingsSource.includes("createEl('select'"), 'endpoint modal has no native select menus');

  const viewSource = fs.readFileSync(path.join(__dirname, '../src/ui/view.ts'), 'utf8');
  t.ok(viewSource.includes("title: t('export_chat')"), 'header exposes export as a dedicated icon');
  t.ok(viewSource.includes("title: t('settings')"), 'header exposes settings as a dedicated icon');
  t.ok(!viewSource.includes('openMoreMenu'), 'legacy three-dot menu stays removed');

  const styles = fs.readFileSync(path.join(__dirname, '../styles.css'), 'utf8');
  t.ok(styles.includes('grid-template-columns: 16px minmax(0, 1fr) auto'), 'popup rows reserve a fixed checkmark column');
  t.ok(styles.includes('button.nc-aligned-select'), 'custom select trigger has stable geometry');
};
