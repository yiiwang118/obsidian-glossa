/* stableStringify is inlined in agent/loop.ts (not exported). We re-implement
 * the same algorithm here and assert reordered objects produce identical
 * strings — guards against the repetition-detection bypass where a model
 * shuffles arg keys to evade the 3-strike refusal. */
exports.run = async (t /*, loadModule */) => {
  function stableStringify(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
    const keys = Object.keys(v).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
  }
  t.eq(stableStringify({ a: 1, b: 2 }), stableStringify({ b: 2, a: 1 }), 'key order ignored');
  t.eq(stableStringify({ a: { b: 1, c: 2 } }), stableStringify({ a: { c: 2, b: 1 } }), 'nested key order ignored');
  t.eq(stableStringify([{ a: 1 }, { b: 2 }]), stableStringify([{ a: 1 }, { b: 2 }]), 'array order PRESERVED');
  t.ok(stableStringify({ a: 1, b: 2 }) !== stableStringify({ a: 1, b: 3 }), 'value diff distinguished');
};
