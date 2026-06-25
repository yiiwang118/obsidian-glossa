exports.run = async function(t, loadModule) {
  const mod = await loadModule('src/citations/pdf_reference_index.ts');

  const numeric = mod.parseCitationText('Prior work shows this clearly [12, 14-15].');
  t.eq(numeric.numbers, [12, 14, 15], 'parse numeric citation ranges');
  t.eq(mod.parseCitationText('25').numbers, [25], 'parse bare numeric citation labels');
  t.eq(mod.parseCitationText('2023'), null, 'do not parse bare years as numeric citations');

  const authorYear = mod.parseCitationText('(Chowdhery et al., 2022; Brown, 2020)');
  t.eq(authorYear.years, ['2022', '2020'], 'parse author-year years');
  t.ok(authorYear.surnames.includes('Chowdhery'), 'parse author-year surname');

  const index = {
    fileKey: 'paper.pdf:1:1',
    pageCount: 10,
    pagesRead: [9, 10],
    hasReferenceHeading: true,
    entries: [
      { text: 'Chowdhery, A., Narang, S., Devlin, J. PaLM: Scaling language modeling with pathways. arXiv, 2022.', page: 9 },
    ],
    entriesByNumber: new Map([
      [12, { number: 12, text: 'Brown, T. et al. Language models are few-shot learners. NeurIPS, 2020.', page: 10 }],
    ]),
    rawReferenceText: 'Chowdhery, A., Narang, S., Devlin, J. PaLM: Scaling language modeling with pathways. arXiv, 2022.',
  };

  const byNumber = mod.lookupCitation(index, mod.parseCitationText('[12]'));
  t.eq(byNumber.status, 'matched', 'lookup numbered reference');
  t.ok(byNumber.entries[0].text.includes('Language models'), 'numbered reference text');

  const byAuthor = mod.lookupCitation(index, mod.parseCitationText('(Chowdhery et al., 2022)'));
  t.eq(byAuthor.status, 'matched', 'lookup author-year reference');
  t.ok(byAuthor.entries[0].text.includes('PaLM'), 'author-year snippet text');

  const mixedTailIndex = {
    fileKey: 'paper.pdf:1:1',
    pageCount: 12,
    pagesRead: [10, 11, 12],
    hasReferenceHeading: false,
    entries: [
      {
        text: 'URL https://lmsys.org/blog/2023-11-21-lookahead-decoding/. Gale, T., Elsen, E., and Hooker, S. The state of sparsity in deep neural networks. Gu, A. and Dao, T. Mamba: Linear-time sequence modeling. He, Z., Zhong, Z., Cai, T., Lee, J. D., and He, D. Rest: Retrieval-based speculative decoding. arXiv preprint arXiv:2311.08252, 2023. Hinton, G., Vinyals, O., and Dean, J. Distilling the knowledge in a neural network.',
        page: 12,
      },
    ],
    entriesByNumber: new Map(),
    rawReferenceText: '',
  };
  const falsePositive = mod.lookupCitation(mixedTailIndex, mod.parseCitationText('(Cai et al., 2023)'));
  t.eq(falsePositive.status, 'not-found', 'do not match mixed PDF tail chunks as author-year references');
};
