const path = require('path');

exports.run = async function(t, loadModule) {
  const mod = await loadModule(path.resolve(__dirname, '../src/features/update_check.ts'));

  t.eq(mod.OBSIDIAN_PLUGIN_URI, 'obsidian://show-plugin?id=glossa', 'update action uses in-app plugin page URI');

  const info = mod.releaseToUpdateInfo('0.6.6', {
    tag_name: '0.6.7',
    name: '0.6.7',
    html_url: 'https://github.com/yiiwang118/obsidian-glossa/releases/tag/0.6.7',
    body: '- Fix update flow\n- Improve web fallback',
  }, 12345);

  t.ok(info, 'newer GitHub release creates update info');
  t.eq(info.currentVersion, '0.6.6', 'update info stores normalized current version');
  t.eq(info.latestVersion, '0.6.7', 'update info stores normalized latest version');
  t.eq(info.obsidianUrl, 'obsidian://show-plugin?id=glossa', 'update info prefers in-app plugin page');
  t.eq(info.releaseUrl, 'https://github.com/yiiwang118/obsidian-glossa/releases/tag/0.6.7', 'GitHub release remains fallback URL');
  t.eq(info.checkedAt, 12345, 'update info uses supplied checked timestamp');
  t.eq(info.notes, ['Fix update flow', 'Improve web fallback'], 'release notes are compacted from bullets');

  t.eq(mod.releaseToUpdateInfo('0.6.7', { tag_name: '0.6.7' }, 1), null, 'same version does not create update info');
  t.eq(mod.releaseToUpdateInfo('0.6.7', { tag_name: '0.6.8', draft: true }, 1), null, 'draft releases are ignored');
  t.eq(mod.releaseToUpdateInfo('0.6.7', { tag_name: '0.6.8', prerelease: true }, 1), null, 'prereleases are ignored');
};
