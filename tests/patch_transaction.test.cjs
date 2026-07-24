const path = require('path');

function memoryStore(initial, options = {}) {
  const files = new Map(Object.entries(initial));
  const calls = [];
  let writes = 0;
  let failed = false;
  return {
    files,
    calls,
    read: async filePath => files.has(filePath) ? files.get(filePath) : null,
    write: async (filePath, content) => {
      calls.push(`write:${filePath}`);
      writes += 1;
      if (!failed && options.failWriteNumber === writes) {
        failed = true;
        throw new Error(`injected write failure for ${filePath}`);
      }
      files.set(filePath, content);
    },
    remove: async filePath => {
      calls.push(`remove:${filePath}`);
      if (!files.has(filePath)) throw new Error(`${filePath} not found`);
      files.delete(filePath);
    },
    move: async (from, to) => {
      calls.push(`move:${from}:${to}`);
      if (!files.has(from)) throw new Error(`${from} not found`);
      if (files.has(to)) throw new Error(`${to} exists`);
      files.set(to, files.get(from));
      files.delete(from);
    },
  };
}

exports.run = async function(t, loadModule) {
  const patches = await loadModule(path.resolve(__dirname, '../src/agent/patch_envelope.ts'));
  const tx = await loadModule(path.resolve(__dirname, '../src/agent/patch_transaction.ts'));

  const ops = patches.parseEnvelope(`*** Begin Patch
*** Update File: A.md
@@
-alpha
+one
*** Update File: B.md
@@
-beta
+two
*** End Patch`);

  const store = memoryStore({ 'A.md': 'alpha\n', 'B.md': 'beta\n' });
  const plan = await tx.materializePatchTransaction(ops, store);
  t.eq(store.calls, [], 'multi-file preflight materializes all final content without writing');
  t.eq(plan.operations.map(operation => operation.after), ['one\n', 'two\n'], 'all after-states are available before commit');
  const committed = await tx.commitPatchTransaction(plan, store);
  t.ok(committed.ok, 'valid multi-file transaction commits');
  t.eq(Object.fromEntries(store.files), { 'A.md': 'one\n', 'B.md': 'two\n' }, 'transaction writes every planned file');

  const partial = memoryStore({ 'A.md': 'alpha\n', 'B.md': 'beta\n' }, { failWriteNumber: 2 });
  const partialPlan = await tx.materializePatchTransaction(ops, partial);
  const failed = await tx.commitPatchTransaction(partialPlan, partial);
  t.ok(!failed.ok && failed.rolledBack, 'a partial write failure triggers automatic rollback');
  t.eq(Object.fromEntries(partial.files), { 'A.md': 'alpha\n', 'B.md': 'beta\n' }, 'rollback restores every affected file exactly');

  const stale = memoryStore({ 'A.md': 'alpha\n', 'B.md': 'beta\n' });
  const stalePlan = await tx.materializePatchTransaction(ops, stale);
  stale.files.set('B.md', 'changed externally\n');
  const staleResult = await tx.commitPatchTransaction(stalePlan, stale);
  t.ok(!staleResult.ok && !staleResult.rolledBack, 'stale fingerprint aborts before the first write');
  t.eq(stale.calls, [], 'stale preflight performs no writes or rollback');

  const conflictOps = patches.parseEnvelope(`*** Begin Patch
*** Update File: A.md
@@
-alpha
+one
*** Delete File: A.md
*** End Patch`);
  let conflict = '';
  try { await tx.materializePatchTransaction(conflictOps, memoryStore({ 'A.md': 'alpha\n' })); }
  catch (error) { conflict = error.message; }
  t.ok(conflict.includes('path conflict'), 'duplicate source/target claims are rejected before reading or writing');

  const moveOps = patches.parseEnvelope(`*** Begin Patch
*** Update File: A.md
*** Move to: Existing.md
@@
-alpha
+one
*** End Patch`);
  let moveConflict = '';
  try { await tx.materializePatchTransaction(moveOps, memoryStore({ 'A.md': 'alpha\n', 'Existing.md': 'occupied' })); }
  catch (error) { moveConflict = error.message; }
  t.ok(moveConflict.includes('Move target already exists'), 'move destinations are checked during in-memory preflight');
};
