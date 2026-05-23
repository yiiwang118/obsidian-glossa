const path = require('path');

exports.run = async (t, loadModule) => {
  const mod = await loadModule(path.resolve(__dirname, '../src/agent/patch_envelope.ts'));

  // Basic update parse
  const ops1 = mod.parseEnvelope(`*** Begin Patch
*** Update File: foo.md
@@ section
 line a
-old
+new
 line b
*** End Patch`);
  t.eq(ops1.length, 1, 'parse: 1 op');
  t.eq(ops1[0].kind, 'update', 'parse: kind=update');
  t.eq(ops1[0].chunks.length, 1, 'parse: 1 chunk');

  // Apply
  const src = ['prefix','line a','old','line b','suffix'].join('\n');
  const out = mod.applyUpdate(src, ops1[0].chunks);
  t.eq(out, ['prefix','line a','new','line b','suffix'].join('\n'), 'apply: replaces old with new');

  // Add File
  const ops2 = mod.parseEnvelope(`*** Begin Patch
*** Add File: hello.txt
+hi
+second
*** End Patch`);
  t.eq(ops2[0].kind, 'add', 'parse: add op');
  t.eq(ops2[0].contents, 'hi\nsecond', 'parse: add contents');

  // Multi-file
  const ops3 = mod.parseEnvelope(`*** Begin Patch
*** Update File: a.md
@@
-foo
+bar
*** Delete File: b.md
*** End Patch`);
  t.eq(ops3.length, 2, 'parse: multi-file count');
  t.eq(ops3[1].kind, 'delete', 'parse: delete op');

  // Lenient whitespace match
  const src4 = 'a\nfoo   \nb';
  const ops4 = mod.parseEnvelope(`*** Begin Patch
*** Update File: x
@@
 a
-foo
+baz
 b
*** End Patch`);
  const out4 = mod.applyUpdate(src4, ops4[0].chunks);
  t.eq(out4, 'a\nbaz\nb', 'apply: rstrip-tolerant match');

  // looksLikeEnvelope
  t.ok(mod.looksLikeEnvelope('*** Begin Patch\nfoo'), 'looksLikeEnvelope: true');
  t.ok(!mod.looksLikeEnvelope('regular text'), 'looksLikeEnvelope: false');

  // Empty patch raises
  t.throws(() => mod.parseEnvelope(''), 'parse: empty patch throws');

  // No Begin marker raises
  t.throws(() => mod.parseEnvelope('*** Update File: x\n@@\n+a\n'), 'parse: missing begin throws');

  // seekSequence: exact + rstrip + trim + unicode
  t.eq(mod.seekSequence(['a','b','c'], ['b','c'], 0, false), 1, 'seek: exact');
  t.eq(mod.seekSequence(['a   ', 'b\t'], ['a', 'b'], 0, false), 0, 'seek: rstrip');
  t.eq(mod.seekSequence(['  a  ', '  b  '], ['a', 'b'], 0, false), 0, 'seek: trim');
  // Unicode em-dash normalisation
  t.eq(mod.seekSequence(['foo—bar'], ['foo-bar'], 0, false), 0, 'seek: unicode dash');
};
