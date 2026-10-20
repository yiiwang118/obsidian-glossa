const path = require('path');

exports.run = async (t, load) => {
  const { acquireFileLocks, lockedPathCount } = await load(path.resolve(__dirname, '../src/agent/file_locks.ts'));
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  const order = [];

  const first = await acquireFileLocks(['Notes/A.md']);
  let secondHeld = false;
  const second = acquireFileLocks(['notes/a.md', 'B.md']).then(release => { secondHeld = true; order.push('second'); return release; });
  await settle();
  t.ok(!secondHeld, 'a second chat writing the same note waits, whatever the letter case');
  const unrelated = await acquireFileLocks(['C.md']);
  t.ok(!!unrelated, 'other notes are not held up');
  order.push('first done');
  first();
  const releaseSecond = await second;
  t.eq(order, ['first done', 'second'], 'writers of one note take turns in order');

  let thirdHeld = false;
  const third = acquireFileLocks(['B.md']).then(release => { thirdHeld = true; return release; });
  await settle();
  t.ok(!thirdHeld, 'every note a call holds stays held until it is released');
  releaseSecond();
  releaseSecond();
  (await third)();
  unrelated();

  // Opposite orders over the same notes cannot deadlock.
  const x = await acquireFileLocks(['X.md']);
  const both = acquireFileLocks(['X.md', 'Y.md']);
  const reversed = acquireFileLocks(['Y.md', 'X.md']);
  let reversedHeld = false;
  void reversed.then(() => { reversedHeld = true; });
  x();
  const releaseBoth = await both;
  await settle();
  t.ok(!reversedHeld, 'the later call waits for the earlier one');
  releaseBoth();
  (await reversed)();

  (await acquireFileLocks([]))();
  await settle();
  t.eq(lockedPathCount(), 0, 'released locks are forgotten');
};
