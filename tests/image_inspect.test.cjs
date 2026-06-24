const path = require('path');

exports.run = async (t, loadModule) => {
  const mod = await loadModule(path.resolve(__dirname, '../src/utils/image.ts'));

  t.eq(mod.normalizeImageInspectMode('read_text'), 'ocr', 'image mode: read_text maps to ocr');
  t.eq(mod.normalizeImageInspectMode('plot'), 'chart', 'image mode: plot maps to chart');
  t.eq(mod.normalizeImageInspectMode('pixels'), 'color', 'image mode: pixels maps to color');
  t.eq(mod.normalizeImageInspectMode('unknown'), 'auto', 'image mode: unknown falls back to auto');

  const region = mod.normalizeImageRegion({ x: 90, y: 45, width: 30, height: 20 }, 100, 50);
  t.eq(region, { x: 90, y: 45, width: 10, height: 5 }, 'image region: clamps to image bounds');

  const invalid = mod.normalizeImageRegion({ x: 0, y: 0, width: -1, height: 20 }, 100, 50);
  t.eq(invalid, undefined, 'image region: rejects negative dimensions');

  const points = mod.normalizeImageSamplePoints([
    { x: 1.2, y: 2.8, label: 'a' },
    { x: 500, y: -5, label: 'b' },
    { x: 'bad', y: 2 },
  ], 100, 50);
  t.eq(points, [
    { x: 1, y: 3, label: 'a' },
    { x: 99, y: 0, label: 'b' },
  ], 'image samples: rounds, clamps, and filters points');
};
