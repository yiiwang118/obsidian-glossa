const path = require('path');

exports.run = async (t, loadModule) => {
  const mod = await loadModule(path.resolve(__dirname, '../src/types.ts'));

  const ruleGlobal = { tool: 'file_edit', scope: 'global', behavior: 'allow', addedAt: 0 };
  t.ok(mod.matchPermissionRule(ruleGlobal, 'file_edit', { file_path: 'anything' }), 'global allow matches');
  t.ok(!mod.matchPermissionRule(ruleGlobal, 'other_tool', {}), 'global rule does not cross tools');

  const ruleFolder = { tool: 'file_edit', scope: 'folder', value: 'Notes', behavior: 'allow', addedAt: 0 };
  t.ok(mod.matchPermissionRule(ruleFolder, 'file_edit', { file_path: 'Notes/Foo.md' }), 'folder match: direct child');
  t.ok(mod.matchPermissionRule(ruleFolder, 'file_edit', { file_path: 'Notes/sub/Bar.md' }), 'folder match: nested');
  t.ok(!mod.matchPermissionRule(ruleFolder, 'file_edit', { file_path: 'Other/x.md' }), 'folder match: outside fails');

  const rulePath = { tool: 'file_edit', scope: 'path', value: 'Foo.md', behavior: 'allow', addedAt: 0 };
  t.ok(mod.matchPermissionRule(rulePath, 'file_edit', { file_path: 'Foo.md' }), 'path match: exact');
  t.ok(!mod.matchPermissionRule(rulePath, 'file_edit', { file_path: 'Foo.md.bak' }), 'path match: rejects prefix');

  // Args might use `path` instead of `file_path`
  t.ok(mod.matchPermissionRule(rulePath, 'file_edit', { path: 'Foo.md' }), 'path match: reads .path fallback');

  // Session-scoped rule
  const ruleSession = { tool: 'file_edit', scope: 'global', behavior: 'allow', addedAt: 0, scopedToSessionId: 'abc' };
  t.ok(mod.matchPermissionRule(ruleSession, 'file_edit', {}, 'abc'), 'session: matches when in session');
  t.ok(!mod.matchPermissionRule(ruleSession, 'file_edit', {}, 'xyz'), 'session: rejects other session');
  t.ok(!mod.matchPermissionRule(ruleSession, 'file_edit', {}, undefined), 'session: rejects when no session id');

  // MCP wildcard
  const ruleMcpAll = { tool: 'mcp:*', scope: 'global', behavior: 'allow', addedAt: 0 };
  t.ok(mod.matchPermissionRule(ruleMcpAll, 'weather__forecast', {}), 'mcp:*: namespaced tool');
  t.ok(!mod.matchPermissionRule(ruleMcpAll, 'file_edit', {}), 'mcp:*: rejects builtin');

  const ruleMcpServer = { tool: 'mcp:weather:*', scope: 'global', behavior: 'allow', addedAt: 0 };
  t.ok(mod.matchPermissionRule(ruleMcpServer, 'weather__forecast', {}), 'mcp:server:*: matches its server');
  t.ok(!mod.matchPermissionRule(ruleMcpServer, 'github__create_issue', {}), 'mcp:server:*: rejects other server');
};
