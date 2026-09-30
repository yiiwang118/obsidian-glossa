const path = require('path');

exports.run = async (t, loadModule) => {
  const { DeferredTasks } = await loadModule(path.resolve(__dirname, '../src/utils/deferred_tasks.ts'));
  const originalSet = window.setTimeout, originalClear = window.clearTimeout;
  const pending = new Map();
  let nextId = 0;
  window.setTimeout = action => { const id = nextId++; pending.set(id, action); return id; };
  window.clearTimeout = id => pending.delete(id);
  const fire = id => { const action = pending.get(id); pending.delete(id); action?.(); };
  try {
    const tasks = new DeferredTasks();
    let calls = 0;
    const first = tasks.schedule(() => calls++, 300);
    tasks.cancel(first);
    fire(first);
    t.eq(calls, 0, 'cancellation works even when the host returns timer id zero');
    const normal = tasks.schedule(() => calls++, 300);
    fire(normal);
    t.eq(calls, 1, 'normal delayed work still executes while active');
    tasks.schedule(() => calls++, 8000);
    const skill = tasks.schedule(() => calls++, 300);
    const alreadyQueued = pending.get(skill);
    tasks.dispose();
    t.eq(pending.size, 0, 'unload clears every remaining timer');
    alreadyQueued();
    t.eq(calls, 1, 'a callback already queued by the host does nothing after unload');
    t.eq(tasks.active, false, 'unloaded task owner stays inactive');
    t.eq(tasks.schedule(() => calls++, 1), undefined, 'late layout-ready callback cannot schedule work');
    t.eq(pending.size, 0, 'no new host timers after disposal');
    tasks.dispose();
    tasks.cancel(undefined);
    tasks.cancel(null);
    t.eq(calls, 1, 'cleanup is idempotent');
  } finally {
    window.setTimeout = originalSet;
    window.clearTimeout = originalClear;
  }
};
