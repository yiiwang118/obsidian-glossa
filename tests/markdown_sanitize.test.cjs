const path = require('path');

exports.run = async function(t, loadModule) {
  const mod = await loadModule(path.resolve(__dirname, '../src/utils/markdown.ts'));

  const md = 'before ![diagram](upload://abc123.png) after';
  t.eq(
    mod.sanitizeMarkdownResourceUrls(md),
    'before [image omitted: diagram] after',
    'markdown upload image is replaced before render',
  );

  const html = '<p>x</p><img src="upload://abc123.png" alt="bad"><p>y</p>';
  t.eq(
    mod.sanitizeMarkdownResourceUrls(html),
    '<p>x</p>[image omitted: abc123.png]<p>y</p>',
    'html upload image is replaced before render',
  );

  const ok = '![diagram](https://example.com/a.png) and ![[local.png]]';
  t.eq(
    mod.sanitizeMarkdownResourceUrls(ok),
    ok,
    'normal markdown image sources are preserved',
  );
};
