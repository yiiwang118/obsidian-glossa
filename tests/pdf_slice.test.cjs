const path = require('path');
const { PDFDocument } = require('pdf-lib');

exports.run = async function(t, loadModule) {
  const mod = await loadModule(path.resolve(__dirname, '../src/utils/pdf_slice.ts'));
  const source = await PDFDocument.create();
  source.addPage([200, 300]);
  source.addPage([210, 310]);
  source.addPage([220, 320]);
  const bytes = await source.save();
  const sliced = await mod.slicePdfPages(bytes, '2-3', 10);
  t.eq(sliced.totalPages, 3, 'native PDF slicing reports the source page count');
  t.eq(sliced.pages, [2, 3], 'native PDF slicing keeps the requested source pages');
  const output = await PDFDocument.load(sliced.bytes);
  t.eq(output.getPageCount(), 2, 'native PDF output contains only selected pages');
  t.eq(Math.round(output.getPage(0).getWidth()), 210, 'cropped PDF preserves selected page content/order');

  let invalid = '';
  try { await mod.slicePdfPages(bytes, '9', 10); }
  catch (error) { invalid = error.message; }
  t.ok(invalid.includes('No valid pages'), 'invalid native PDF page ranges fail clearly');
};
