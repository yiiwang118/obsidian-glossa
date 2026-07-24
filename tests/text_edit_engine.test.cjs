const path = require('path');

exports.run = async function(t, loadModule) {
  const mod = await loadModule(path.resolve(__dirname, '../src/agent/text_edit_engine.ts'));

  const formatted = '\uFEFFＣａｆｅ “test”   \r\nnext\r\n';
  const normalized = mod.applyTextEdits(formatted, [{
    oldText: 'Cafe "test"\nnext',
    newText: 'Done\nline',
  }]);
  t.ok(normalized.ok, 'NFKC, smart punctuation, and trailing whitespace match safely');
  t.eq(normalized.content, '\uFEFFDone\r\nline\r\n', 'BOM, CRLF, and trailing newline are preserved');
  t.eq(normalized.edits[0].mode, 'normalized', 'normalization mode is disclosed');

  const composed = mod.applyTextEdits('Cafe\u0301 noir\n', [{ oldText: 'Café noir', newText: 'Coffee' }]);
  t.ok(composed.ok, 'NFKC matching composes a base character and following combining mark');
  t.eq(composed.content, 'Coffee\n', 'normalized match maps back to the complete source character span');

  const batch = mod.applyTextEdits('alpha\nbeta\ngamma\n', [
    { oldText: 'alpha', newText: 'one' },
    { oldText: 'gamma', newText: 'three' },
  ]);
  t.ok(batch.ok, 'multiple non-overlapping edits materialize together');
  t.eq(batch.content, 'one\nbeta\nthree\n', 'batched edits are applied to one snapshot');

  const overlap = mod.applyTextEdits('abcdef', [
    { oldText: 'abc', newText: 'x' },
    { oldText: 'bcd', newText: 'y' },
  ]);
  t.ok(!overlap.ok && overlap.error.includes('overlaps'), 'overlapping edits fail atomically');

  const ambiguous = mod.applyTextEdits('same and same', [{ oldText: 'same', newText: 'new' }]);
  t.ok(!ambiguous.ok && ambiguous.candidates === 2, 'ambiguous exact matches require more context');

  const fuzzySource = [
    'A completely unrelated line that should never be selected by the matcher.',
    'The transformer updates its weights during test time using one gradient step.',
    'Another unrelated paragraph with sufficiently different wording for confidence.',
  ].join('\n');
  const fuzzy = mod.applyTextEdits(fuzzySource, [{
    oldText: 'The transformer updates its weight during test time using one gradient step.',
    newText: 'The model adapts at test time.',
  }]);
  t.ok(fuzzy.ok, 'a unique high-confidence fuzzy match is accepted as the last tier');
  t.eq(fuzzy.edits[0].mode, 'fuzzy', 'fuzzy use is explicit in the result');
  t.ok(fuzzy.edits[0].confidence >= 0.965, 'fuzzy match meets the high-confidence threshold');

  const duplicatedFuzzyLine = 'The transformer updates its weights during test time using one gradient step.';
  const fuzzyAmbiguous = mod.applyTextEdits(`${duplicatedFuzzyLine}\n${duplicatedFuzzyLine}`, [{
    oldText: 'The transformer updates its weight during test time using one gradient step.',
    newText: 'unsafe',
  }]);
  t.ok(!fuzzyAmbiguous.ok, 'fuzzy matching refuses equally plausible candidates');

  const withTrailingBlankLines = mod.applyTextEdits('a\n\n', [{ oldText: 'a', newText: 'b\n\n\n' }]);
  t.eq(withTrailingBlankLines.content, 'b\n\n', 'replacement cannot silently change the source trailing-newline contract');

  t.eq(mod.textFingerprint('stable'), mod.textFingerprint('stable'), 'fingerprints are deterministic');
  t.ok(mod.textFingerprint('stable') !== mod.textFingerprint('changed'), 'fingerprints detect stale content');
};
