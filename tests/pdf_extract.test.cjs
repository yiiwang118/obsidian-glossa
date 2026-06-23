const path = require('path');

function fakePdfJs(pages) {
  return {
    getDocument() {
      return {
        promise: Promise.resolve({
          numPages: pages.length,
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
  ]), new Uint8Array([1, 2, 3]), { pages: '2', maxPages: 10, maxChars: 1000 });
  t.eq(res.pageCount, 2, 'pdf extract: reports page count');
  t.eq(res.pageLabel, '2', 'pdf extract: reports selected page label');
  t.ok(res.text.includes('### Page 2'), 'pdf extract: includes page heading');
  t.ok(res.text.includes('Page two'), 'pdf extract: includes selected page text');
  t.ok(!res.text.includes('Page one'), 'pdf extract: skips unselected page');
};
