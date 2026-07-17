const path = require('path');

exports.run = async function(t, loadModule) {
  const mod = await loadModule(path.resolve(__dirname, '../src/utils/selection_rects.ts'));

  const merged = mod.mergeSelectionLineRects([
    { left: 10, top: 10, right: 80, bottom: 30, width: 70, height: 20 },
    { left: 82, top: 10, right: 140, bottom: 30, width: 58, height: 20 },
    { left: 12, top: 28, right: 120, bottom: 48, width: 108, height: 20 },
  ]);
  t.eq(merged.length, 2, 'selection fragments are merged into visual lines');
  t.ok(merged[0].bottom < merged[1].top, 'adjacent highlight lines do not overlap');
  t.eq(merged[0].left, 10, 'merged line keeps its left edge');
  t.eq(merged[0].right, 140, 'nearby fragments on one line are joined');

  const separate = mod.mergeSelectionLineRects([
    { left: 10, top: 10, right: 40, bottom: 30, width: 30, height: 20 },
    { left: 120, top: 10, right: 160, bottom: 30, width: 40, height: 20 },
  ]);
  t.eq(separate.length, 2, 'widely separated fragments remain separate highlights');

  const clipped = mod.clipSelectionRects(
    [
      { left: 70, top: 40, right: 220, bottom: 70, width: 150, height: 30 },
      { left: -100, top: 200, right: -20, bottom: 230, width: 80, height: 30 },
    ],
    { left: 50, top: 20, right: 180, bottom: 300, width: 130, height: 280 },
  );
  t.eq(clipped.length, 1, 'rectangles outside the visible PDF page are discarded');
  t.eq(clipped[0].right, 180, 'highlight rectangles are clipped to the page boundary');
};
