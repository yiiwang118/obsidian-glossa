exports.run = async function(t, loadModule) {
  if (process.env.GLOSSA_NETWORK_TESTS !== '1') {
    t.ok(true, 'real network tests skipped unless GLOSSA_NETWORK_TESTS=1');
    return;
  }

  global.window = {
    setTimeout,
    clearTimeout,
  };

  const web = await loadModule(require('path').resolve(__dirname, '../src/utils/web_content.ts'));
  const fetched = await web.fetchBytesWithCap(
    (url, signal) => fetch(url, { signal }),
    'https://example.com/',
    { timeoutMs: 15000, maxBytes: 128 * 1024 },
  );
  t.eq(fetched.status, 200, 'example.com fetch succeeds');
  const parsed = web.extractWebMarkdown(web.decodeUtf8(fetched.bytes), fetched.finalUrl);
  t.ok(parsed.markdown.toLowerCase().includes('example domain'), 'real HTML extraction works');

  const search = await loadModule(require('path').resolve(__dirname, '../src/agent/tools/web_search.ts'));
  try {
    const results = await search.runWebSearchProvider('duckduckgo', 'OpenAI', 5, '');
    t.ok(Array.isArray(results), 'duckduckgo returns an array');
    t.ok(results.length > 0, 'duckduckgo returns at least one structured result');
    const ranked = search.rankSearchResults('OpenAI', results);
    t.ok(ranked[0].score >= ranked[ranked.length - 1].score, 'real results are ranked');
  } catch (e) {
    t.ok(true, `duckduckgo live check skipped: ${e?.message ?? e}`);
  }

  const paperResults = await search.runWebSearchProvider('auto', 'Find the official PDF for Titans Learning to Memorize at Test Time', 5, '');
  t.ok(paperResults.some(r => /arxiv\.org\/pdf\/2501\.00663/i.test(r.url)), 'auto provider finds Titans arXiv PDF through academic fallback');
};
