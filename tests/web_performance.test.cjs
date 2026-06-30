exports.run = async function(t, loadModule) {
  const mod = await loadModule(require('path').resolve(__dirname, '../src/utils/web_content.ts'));
  const items = [];
  for (let i = 0; i < 2000; i++) {
    items.push(`<section><h2>Section ${i}</h2><p>Alpha beta gamma ${i} <a href="/file-${i}.pdf">download ${i}</a></p></section>`);
  }
  const html = `<html><head><title>Perf</title><meta name="description" content="perf"></head><body>${items.join('\n')}</body></html>`;
  const started = Date.now();
  const parsed = mod.extractWebMarkdown(html, 'https://example.com/root/');
  const elapsed = Date.now() - started;
  t.eq(parsed.title, 'Perf', 'large title parsed');
  t.eq(parsed.links.length, 80, 'links capped for UI/model safety');
  t.ok(parsed.markdown.includes('Section 1999'), 'large body converted');
  t.ok(elapsed < 1500, `large HTML parse should stay fast (${elapsed}ms)`);

  const summaryStart = Date.now();
  const summary = mod.summarizeMarkdown(parsed.markdown, 'extract', 'gamma 1999', 4000);
  const summaryElapsed = Date.now() - summaryStart;
  t.ok(summary.includes('1999'), 'prompt-guided extraction finds relevant block');
  t.ok(summary.length <= 4012, 'summary cap respected');
  t.ok(summaryElapsed < 1000, `prompt extraction should stay fast (${summaryElapsed}ms)`);
};
