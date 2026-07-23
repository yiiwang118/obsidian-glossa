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

  const png = new File([new Uint8Array([1, 2, 3])], 'image.png', {
    type: 'image/png',
    lastModified: 7,
  });
  const preparedPng = await mod.preparePastedImage(png, 'Screenshot-20260723-120000');
  t.eq({
    name: preparedPng.file.name,
    type: preparedPng.file.type,
    size: preparedPng.file.size,
    compressed: preparedPng.compressed,
    originalBytes: preparedPng.originalBytes,
  }, {
    name: 'Screenshot-20260723-120000.png',
    type: 'image/png',
    size: 3,
    compressed: false,
    originalBytes: 3,
  }, 'pasted image: supported images under the cap keep their bytes and format');

  const previousDocument = global.activeDocument;
  const previousWindow = global.activeWindow;
  let encodeAttempts = 0;
  global.activeDocument = {
    defaultView: {
      URL: {
        createObjectURL: () => 'blob:test',
        revokeObjectURL: () => {},
      },
    },
  };
  global.activeWindow = {
    createEl(tag) {
      if (tag === 'img') {
        const image = { naturalWidth: 8000, naturalHeight: 4000, width: 8000, height: 4000 };
        Object.defineProperty(image, 'src', { set: () => queueMicrotask(() => image.onload()) });
        return image;
      }
      return {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: () => {} }),
        toBlob(callback, mime) {
          encodeAttempts++;
          const size = this.width > 3500 ? 6 * 1024 * 1024 : 1024 * 1024;
          callback(new Blob([new Uint8Array(size)], { type: mime }));
        },
      };
    },
  };
  try {
    const bitmap = new File([new Uint8Array([1, 2, 3, 4])], 'clipboard.bmp', { type: 'image/bmp' });
    const preparedBitmap = await mod.preparePastedImage(bitmap, 'Screenshot-20260723-120001');
    t.eq(preparedBitmap.file.type, 'image/webp', 'pasted image: unsupported formats are converted to WebP');
    t.eq(preparedBitmap.file.name, 'Screenshot-20260723-120001.webp', 'pasted image: converted files receive a WebP name');
    t.eq(encodeAttempts, 2, 'pasted image: output above the cap triggers a smaller second encode');
    t.ok(preparedBitmap.file.size <= mod.MAX_ATTACHMENT_IMAGE_BYTES, 'pasted image: compressed output respects the attachment cap');
  } finally {
    global.activeDocument = previousDocument;
    global.activeWindow = previousWindow;
  }
};
