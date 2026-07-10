const path = require('path');

exports.run = async function(t, loadModule) {
  const mod = await loadModule(path.resolve(__dirname, '../src/utils/media_cache.ts'));

  let loads = 0;
  const cache = new mod.BoundedAsyncCache(2, 100, value => value.length);
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const first = cache.getOrCreate('same', async () => {
    loads++;
    await pending;
    return 'value';
  });
  const second = cache.getOrCreate('same', async () => {
    loads++;
    return 'duplicate';
  });
  release();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  t.eq(loads, 1, 'concurrent callers share one expensive loader');
  t.eq(firstResult.value, 'value', 'first cache caller receives loader value');
  t.eq(firstResult.cacheHit, false, 'first cache caller records a miss');
  t.eq(secondResult.cacheHit, true, 'concurrent follower records a cache hit');

  await cache.getOrCreate('b', async () => 'bbbb');
  await cache.getOrCreate('c', async () => 'cccc');
  t.eq(cache.stats().entries, 2, 'LRU respects entry bound');
  let reloaded = 0;
  await cache.getOrCreate('same', async () => { reloaded++; return 'again'; });
  t.eq(reloaded, 1, 'oldest entry is evicted when the cache is full');

  let attempts = 0;
  const retryCache = new mod.BoundedAsyncCache(2, 100, value => value.length);
  try {
    await retryCache.getOrCreate('failure', async () => { attempts++; throw new Error('boom'); });
  } catch {}
  const retry = await retryCache.getOrCreate('failure', async () => { attempts++; return 'ok'; });
  t.eq(attempts, 2, 'failed async entries are removed and can retry');
  t.eq(retry.value, 'ok', 'retry after failure returns the new value');

  const abortController = new AbortController();
  let finishShared;
  const sharedWork = new Promise(resolve => { finishShared = resolve; });
  const cancelledWaiter = mod.awaitWithAbortSignal(sharedWork, abortController.signal);
  const survivingWaiter = mod.awaitWithAbortSignal(sharedWork);
  abortController.abort();
  let abortName = '';
  try {
    await cancelledWaiter;
  } catch (error) {
    abortName = error.name;
  }
  finishShared('shared-result');
  t.eq(abortName, 'AbortError', 'caller abort stops only its own cache wait');
  t.eq(await survivingWaiter, 'shared-result', 'shared work remains available to other callers after one aborts');

  mod.clearMediaCaches();
  let binaryReads = 0;
  const app = { vault: { readBinary: async () => { binaryReads++; return new Uint8Array([65, 66, 67]).buffer; } } };
  const image = { path: 'img/test.png', stat: { mtime: 10, size: 3 } };
  const imageA = await mod.vaultImageDataUriCached(app, image, 'image/png');
  const imageB = await mod.vaultImageDataUriCached(app, image, 'image/png');
  t.eq(binaryReads, 1, 'unchanged vault image is read and encoded once');
  t.eq(imageA.value, 'data:image/png;base64,QUJD', 'image cache emits a valid data URI');
  t.eq(imageB.cacheHit, true, 'second unchanged image lookup is a hit');
  await mod.vaultImageDataUriCached(app, { ...image, stat: { mtime: 11, size: 3 } }, 'image/png');
  t.eq(binaryReads, 2, 'mtime change invalidates the vault image cache');
};
