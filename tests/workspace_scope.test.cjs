const path = require('path');

exports.run = async function(t, loadModule) {
  const mod = await loadModule(path.resolve(__dirname, '../src/agent/workspace_scope.ts'));
  t.eq(mod.normalizeWorkspaceFolders([' /Projects/ ', './Papers', 'Projects']), ['Papers', 'Projects'], 'workspace folders normalize and deduplicate');
  t.ok(mod.isPathInWorkspace('Projects/A.md', ['Projects']), 'child file is inside workspace');
  t.ok(!mod.isPathInWorkspace('Projects-old/A.md', ['Projects']), 'prefix lookalikes are outside workspace');
  t.eq(mod.workspaceScopeViolation('read_note', { path: 'Private/A.md' }, ['Projects']), 'Agent workspace blocks Private/A.md. Allowed folders: Projects', 'read outside workspace is blocked');
  t.eq(mod.workspaceScopeViolation('read_note', { path: 'Projects/A.md' }, ['Projects']), null, 'read inside workspace is allowed');
  t.ok(mod.workspaceScopeViolation('list_files', {}, ['Projects']).includes('must specify'), 'root enumeration requires an allowed folder');
  t.eq(mod.workspaceScopeViolation('list_files', { folder: 'Projects' }, ['Projects']), null, 'folder browsing works inside scope');
  t.ok(mod.workspaceScopeViolation('apply_patch', {
    patch: '*** Begin Patch\n*** Update File: Private/A.md\n@@\n-old\n+new\n*** End Patch',
  }, ['Projects']).includes('Private/A.md'), 'envelope paths are checked before approval');
  t.ok(mod.workspaceScopeViolation('get_active_file', {}, ['Projects'], 'Private/A.md').includes('Private/A.md'), 'active-file tools cannot bypass scope');
  t.ok(mod.workspaceScopeViolation('list_open_files', {}, ['Projects']), 'vault-wide workspace tools are disabled under a scope');
  t.ok(mod.workspaceScopeViolation('dataview_query', { query: 'TABLE file.path' }, ['Projects']), 'Dataview cannot enumerate outside a hard workspace');
  t.ok(mod.workspaceScopeViolation('get_backlinks', { path: 'Projects/A.md' }, ['Projects']), 'backlinks cannot reveal source paths outside a hard workspace');
  t.ok(mod.workspaceScopeViolation('templater_render', { mode: 'to_string', template_path: 'Projects/T.md' }, ['Projects']), 'template execution is disabled because templates can access unrelated vault state');
};
