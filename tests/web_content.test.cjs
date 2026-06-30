exports.run = async function(t, loadModule) {
  const mod = await loadModule(require('path').resolve(__dirname, '../src/utils/web_content.ts'));

  const html = `
    <html><head>
      <title>Example Page</title>
      <meta name="description" content="A compact description">
      <script>bad()</script>
    </head><body>
      <h1>Hello</h1>
      <p>Install with <a href="/download/file.pdf">the PDF</a>.</p>
      <ul><li>First item</li><li>Second item</li></ul>
    </body></html>`;
  const parsed = mod.extractWebMarkdown(html, 'https://example.com/docs/page');
  t.eq(parsed.title, 'Example Page', 'extract title');
  t.eq(parsed.description, 'A compact description', 'extract description');
  t.ok(parsed.markdown.includes('# Hello'), 'heading becomes markdown');
  t.ok(parsed.markdown.includes('[the PDF](https://example.com/download/file.pdf)'), 'relative link resolved');
  t.eq(parsed.links[0].url, 'https://example.com/download/file.pdf', 'link list resolved');

  t.eq(mod.inferExtension('application/pdf', 'https://x.test/a'), 'pdf', 'infer pdf extension');
  t.eq(mod.inferExtension('text/html', 'https://x.test/a'), 'html', 'infer html extension');
  t.eq(mod.inferExtension('', 'https://x.test/a/report.PDF?download=1'), 'pdf', 'path extension wins');
  t.eq(mod.sanitizeFilename('../bad:name?.pdf'), '-bad-name-.pdf', 'sanitize filename');
  t.eq(mod.sha256Hex(new Uint8Array([97, 98, 99])), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'sha256');
};
