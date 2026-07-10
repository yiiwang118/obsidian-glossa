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

  const ddgHtml = [
    '<div class="result results_links results_links_deep web-result">',
    '<div class="result__body">',
    '<h2><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.edu%2Fpapers%2Ftarget%255B0%255D.pdf&amp;rut=abc"><span>PDF</span> Target Paper</a></h2>',
    '<a class="result__snippet">A public author manuscript.</a>',
    '<div class="clear"></div>',
    '</div></div>',
  ].join('');
  const parsedDdg = searchMod.parseDuckDuckGoHtml(ddgHtml);
  t.eq(parsedDdg.length, 1, 'DuckDuckGo HTML parser extracts organic results');
  t.eq(parsedDdg[0].url, 'https://example.edu/papers/target%5B0%5D.pdf', 'DuckDuckGo redirect is unwrapped to direct asset URL');
  t.eq(parsedDdg[0].title, 'PDF Target Paper', 'DuckDuckGo result title is cleaned');
  const yahooHtml = [
    '<a target="_blank" href="https://r.search.yahoo.com/_ylt=x/RV=2/RE=1/RO=10/RU=https%3a%2f%2fexample.edu%2fpapers%2ftarget%255B0%255D.pdf/RK=2/RS=x">',
    '<div class="source">example.edu</div>',
    '<h3 class="title"><span>Reinforcement learning of motor skills with policy gradients</span></h3>',
    '</a>',
  ].join('');
  const parsedYahoo = searchMod.parseYahooHtml(yahooHtml);
  t.eq(parsedYahoo.length, 1, 'Yahoo HTML parser extracts organic results');
  t.eq(parsedYahoo[0].url, 'https://example.edu/papers/target%5B0%5D.pdf', 'Yahoo redirect is unwrapped to direct asset URL');
  t.eq(parsedYahoo[0].title, 'Reinforcement learning of motor skills with policy gradients', 'Yahoo result title is cleaned');
  t.ok(
    searchMod.titleIdentityScore(
      'Reinforcement learning of motor skills with policy gradients',
      'PDF Reinforcement learning of motor skills with policy gradients',
    ) > 0.9,
    'exact paper title has high identity score',
  );
  t.ok(
    searchMod.titleIdentityScore(
      'Reinforcement learning of motor skills with policy gradients',
      'Policy search for motor primitives in robotics',
    ) < 0.4,
    'keyword-overlapping but different paper has low identity score',
  );

  const commonMod = await loadModule(require('path').resolve(__dirname, '../src/agent/tools/web_common.ts'));
  t.eq(
    commonMod.httpFallbackUrl('https://example.com/a/b?x=1#frag', new TypeError('Failed to fetch')),
    'http://example.com/a/b?x=1#frag',
    'HTTPS network failures can fall back to same-host HTTP',
  );
  t.eq(
    commonMod.httpFallbackUrl('http://example.com/a/b', new TypeError('Failed to fetch')),
    '',
    'HTTP URLs do not fall back again',
  );
  const abortError = new Error('aborted');
  abortError.name = 'AbortError';
  t.eq(
    commonMod.httpFallbackUrl('https://example.com/a/b', abortError),
    '',
    'user cancellation or timeout does not trigger HTTP fallback',
  );
  t.eq(
    commonMod.httpFallbackUrl('https://localhost/a/b', new Error('refused: localhost is reserved')),
    '',
    'policy refusal does not trigger HTTP fallback',
  );

  const fetchMod = await loadModule(require('path').resolve(__dirname, '../src/agent/tools/web_fetch.ts'));
  const calls = [];
  const fakeFetcher = async (url) => {
    calls.push(url);
    if (url.startsWith('https:')) throw new TypeError('Failed to fetch');
    return new Response('fallback body', {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'text/plain' },
    });
  };
  const fetched = await fetchMod.fetchBytesWithHttpFallback(fakeFetcher, 'https://example.com/a/b', {
    timeoutMs: 1000,
    maxBytes: 1000,
  });
  t.eq(calls, ['https://example.com/a/b', 'http://example.com/a/b'], 'fetch fallback retries the same host/path over HTTP');
  t.eq(fetched.finalUrl, 'http://example.com/a/b', 'fallback result reports the HTTP URL that succeeded');
  t.eq(fetched.fallbackFrom, 'https://example.com/a/b', 'fallback result preserves the original HTTPS URL');
  t.eq(fetched.fallbackError, 'Failed to fetch', 'fallback result preserves the initial fetch error');

  const researchMod = await loadModule(require('path').resolve(__dirname, '../src/agent/tools/web_research.ts'));
  const researchCalls = [];
  const fakeResearchFetcher = async (url) => {
    researchCalls.push(url);
    if (url.startsWith('https:')) throw new TypeError('Failed to fetch');
    return new Response('<html><title>Bitter Lesson</title><p>The bitter lesson is about general methods.</p></html>', {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'text/html' },
    });
  };
  const excerpt = await researchMod.fetchSourceExcerpt(
    {
      title: 'The Bitter Lesson',
      url: 'https://incompleteideas.net/IncIdeas/BitterLesson.html',
      snippet: '',
      domain: 'incompleteideas.net',
      source: 'test',
    },
    'bitter lesson',
    undefined,
    fakeResearchFetcher,
  );
  t.eq(
    researchCalls,
    ['https://incompleteideas.net/IncIdeas/BitterLesson.html', 'http://incompleteideas.net/IncIdeas/BitterLesson.html'],
    'web_research source fetch reuses HTTP fallback',
  );
  t.ok(excerpt.includes('Fallback from URL: https://incompleteideas.net/IncIdeas/BitterLesson.html'), 'web_research excerpt reports fallback source');
  t.ok(excerpt.includes('Initial fetch error: Failed to fetch'), 'web_research excerpt reports initial fetch failure');
  t.ok(excerpt.includes('The bitter lesson is about general methods.'), 'web_research excerpt includes fallback page content');

  const downloadMod = await loadModule(require('path').resolve(__dirname, '../src/agent/tools/download_file.ts'));
  const validPdf = {
    url: 'https://example.edu/target.pdf',
    finalUrl: 'https://example.edu/target.pdf',
    status: 200,
    statusText: 'OK',
    contentType: 'application/octet-stream',
    bytes: new TextEncoder().encode('%PDF-1.7\nvalid body'),
    truncated: false,
  };
  t.eq(downloadMod.validateFetchedCandidate(validPdf, ['pdf'], true), 'pdf', 'download validation recognizes PDF magic bytes');
  t.throws(
    () => downloadMod.validateFetchedCandidate({
      ...validPdf,
      contentType: 'text/html',
      bytes: new TextEncoder().encode('<html>access denied</html>'),
    }, [], true),
    'query download rejects HTML landing page disguised by a .pdf URL',
  );
  t.throws(
    () => downloadMod.validateFetchedCandidate({ ...validPdf, status: 404, statusText: 'Not Found' }, ['pdf'], true),
    'download validation rejects non-success HTTP status',
  );
  const downloadHint = downloadMod.downloadHttpFallbackHint(
    'https://incompleteideas.net/IncIdeas/BitterLesson.html',
    new TypeError('Failed to fetch'),
  );
  t.ok(downloadHint.includes('web_fetch or web_research'), 'download HTTPS failure hint points to read-only extraction fallback');
  t.ok(downloadHint.includes('url="http://incompleteideas.net/IncIdeas/BitterLesson.html"'), 'download HTTPS failure hint exposes explicit HTTP retry URL');
  t.eq(
    downloadMod.downloadHttpFallbackHint('http://incompleteideas.net/IncIdeas/BitterLesson.html', new TypeError('Failed to fetch')),
    '',
    'download hint does not suggest fallback for HTTP URLs',
  );
};
