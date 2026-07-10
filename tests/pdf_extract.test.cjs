const path = require('path');

function fakePdfJs(pages, metadata = {}) {
  return {
    getDocument() {
      return {
        promise: Promise.resolve({
          numPages: pages.length,
          getMetadata: async () => ({ info: metadata }),
          getPage: async (n) => ({
            getTextContent: async () => ({ items: pages[n - 1] }),
            cleanup() {},
          }),
          destroy() {},
        }),
        destroy() {},
      };
    },
  };
}

exports.run = async (t, loadModule) => {
  const mod = await loadModule(path.resolve(__dirname, '../src/utils/pdf.ts'));

  const sel = mod.parsePdfPageSelection('3,1-2,9', 5, 10);
  t.eq(sel.label, '1-3', 'pdf pages: sorts and merges selected pages');
  t.eq(sel.pages.join(','), '1,2,3', 'pdf pages: drops out-of-range pages');

  const capped = mod.parsePdfPageSelection('', 6, 3);
  t.eq(capped.pages.join(','), '1,2,3', 'pdf pages: default starts at page 1');
  t.ok(capped.truncatedByMaxPages, 'pdf pages: default reports max page truncation');

  const renameSel = mod.selectPdfPagesForTask('', 20, 10, 'rename');
  t.eq(renameSel.pages.join(','), '1', 'pdf task: rename only inspects first page by default');

  const summarySel = mod.selectPdfPagesForTask('', 20, 20, 'summarize');
  t.eq(summarySel.pages.join(','), '1,2,3,4,5,6,7,8,19,20', 'pdf task: summarize samples front matter and ending pages');

  const text = mod.textItemsToString([
    { str: 'Hello', transform: [1, 0, 0, 1, 10, 100], width: 20, height: 10 },
    { str: 'world', transform: [1, 0, 0, 1, 40, 100], width: 24, height: 10 },
    { str: '你', transform: [1, 0, 0, 1, 10, 80], width: 10, height: 10 },
    { str: '好', transform: [1, 0, 0, 1, 21, 80], width: 10, height: 10 },
  ]);
  t.eq(text, 'Hello world\n你好', 'pdf text: inserts word spaces but not CJK spaces');

  const res = await mod.extractPdfTextWithPdfJs(fakePdfJs([
    [{ str: 'Page one', transform: [1, 0, 0, 1, 10, 100], width: 40, height: 10 }],
    [{ str: 'Page two', transform: [1, 0, 0, 1, 10, 100], width: 40, height: 10 }],
  ], { Title: 'Metadata Title' }), new Uint8Array([1, 2, 3]), { pages: '2', maxPages: 10, maxChars: 1000, query: 'Page two' });
  t.eq(res.pageCount, 2, 'pdf extract: reports page count');
  t.eq(res.pageLabel, '2', 'pdf extract: reports selected page label');
  t.ok(res.text.includes('### Page 2'), 'pdf extract: includes page heading');
  t.ok(res.text.includes('Page two'), 'pdf extract: includes selected page text');
  t.ok(!res.text.includes('Page one'), 'pdf extract: skips unselected page');
  t.eq(res.diagnostic.metadataTitle, 'Metadata Title', 'pdf extract: reports metadata title');
  t.eq(res.searchHits[0].page, 2, 'pdf search: reports hit page');

  const scanned = await mod.extractPdfTextWithPdfJs(fakePdfJs([
    [],
    [],
  ]), new Uint8Array([1, 2, 3]), { maxPages: 10, maxChars: 1000 });
  t.eq(scanned.diagnostic.documentKind, 'scanned', 'pdf diagnostic: empty text layer is scanned');
  t.ok(scanned.warnings.some(w => /No extractable text/.test(w)), 'pdf diagnostic: scanned PDF warns about missing text');

  const readPdfMod = await loadModule(path.resolve(__dirname, '../src/agent/tools/read_pdf.ts'));
  t.ok(readPdfMod.readPdf.spec.description.includes('visual renders up to 4'), 'read_pdf advertises bounded visual page rendering');
  const visual = readPdfMod.visualPdfToolResult('paper.pdf', {
    totalPages: 10,
    pageLabel: '2',
    pages: [{ page: 2, mime: 'image/jpeg', data: 'AAAA', width: 1200, height: 1600 }],
  });
  t.ok(visual.text.includes('rendered 2'), 'visual PDF result names the rendered page');
  t.eq(visual.contentBlocks[0].text, 'PDF page 2 (1200 x 1600px)', 'visual PDF result includes page dimensions');
  t.eq(visual.contentBlocks[1].source.media_type, 'image/jpeg', 'visual PDF result emits provider-compatible image block');
};
