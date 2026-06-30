exports.run = async function(t, loadModule) {
  const tools = await loadModule(require('path').resolve(__dirname, '../src/agent/tools.ts'));
  const specs = tools.listToolSpecs({ includeDeferred: true }).map(s => s.name);
  t.ok(specs.includes('web_search'), 'web_search is registered');
  t.ok(specs.includes('web_fetch'), 'web_fetch is registered');
  t.ok(specs.includes('web_research'), 'web_research is registered');
  t.ok(specs.includes('download_file'), 'download_file is registered');

  const webSearch = tools.TOOLS.web_search;
  t.ok(webSearch.isReadOnly({}), 'web_search is read-only for plan visibility');
  t.ok(webSearch.dangerous, 'web_search still asks for network approval');
  const askPerm = await webSearch.checkPermissions({ plugins: { plugins: { glossa: { settings: { webAutoApproveNetworkReads: false } } } } }, {});
  t.eq(askPerm.behavior, 'ask', 'web reads ask by default');
  const allowPerm = await webSearch.checkPermissions({ plugins: { plugins: { glossa: { settings: { webAutoApproveNetworkReads: true } } } } }, {});
  t.eq(allowPerm.behavior, 'allow', 'web reads can be auto-approved by setting');

  const download = tools.TOOLS.download_file;
  t.ok(!download.isReadOnly({}), 'download_file is write-side');
  t.ok(download.isDestructive({}), 'download_file is destructive');

  const searchMod = await loadModule(require('path').resolve(__dirname, '../src/agent/tools/web_search.ts'));
  const ranked = searchMod.rankSearchResults('glossa obsidian plugin download', [
    { title: 'Random blog', url: 'https://blog.example.com/post?utm_source=x', snippet: 'notes', domain: 'blog.example.com', source: 'test' },
    { title: 'Glossa release PDF', url: 'https://github.com/yiiwang118/obsidian-glossa/releases/download/0.5.3/main.js', snippet: 'plugin download', domain: 'github.com', source: 'test' },
    { title: 'Glossa release PDF duplicate', url: 'https://github.com/yiiwang118/obsidian-glossa/releases/download/0.5.3/main.js#frag', snippet: 'plugin download', domain: 'github.com', source: 'test' },
  ], { preferDownloads: true });
  t.eq(ranked[0].domain, 'github.com', 'ranking prefers trusted direct assets');
  t.eq(ranked.length, 2, 'ranking deduplicates equivalent URLs');
};
