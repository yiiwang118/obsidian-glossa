const path = require('path');

exports.run = async function(t, loadModule) {
  const mod = await loadModule(path.resolve(__dirname, '../src/utils/markdown.ts'));

  const md = 'before ![diagram](upload://abc123.png) after';
  t.eq(
    mod.sanitizeMarkdownResourceUrls(md),
    'before [image omitted: diagram] after',
    'markdown upload image is replaced before render',
  );

  const html = '<p>x</p><img src="upload://abc123.png" alt="bad"><p>y</p>';
  t.eq(
    mod.sanitizeMarkdownResourceUrls(html),
    '<p>x</p>[image omitted: abc123.png]<p>y</p>',
    'html upload image is replaced before render',
  );

  const ok = '![diagram](https://example.com/a.png) and ![[local.png]]';
  t.eq(
    mod.sanitizeMarkdownResourceUrls(ok),
    ok,
    'normal markdown image sources are preserved',
  );

  const formulas = String.raw`参数 \(n\) 与风险：
\[
L(W^*)-L_{\mathrm{TT}}(W_{\mathrm{TT}}) \approx \frac{k}{k+d}.
\]`;
  t.eq(
    mod.normalizeObsidianMathDelimiters(formulas),
    String.raw`参数 $n$ 与风险：
$$
L(W^*)-L_{\mathrm{TT}}(W_{\mathrm{TT}}) \approx \frac{k}{k+d}.
$$`,
    'LaTeX parenthesis and bracket delimiters normalize to Obsidian math syntax',
  );

  const code = '正文 \\(x\\)。\n\n```tex\n\\[code_block\\]\n```\n\n行内 `\\(literal\\)`。';
  t.eq(
    mod.normalizeObsidianMathDelimiters(code),
    '正文 $x$。\n\n```tex\n\\[code_block\\]\n```\n\n行内 `\\(literal\\)`。',
    'math normalization leaves fenced and inline code untouched',
  );

  const htmlCode = String.raw`<code>\(literal\)</code> but \(math\)`;
  t.eq(
    mod.normalizeObsidianMathDelimiters(htmlCode),
    String.raw`<code>\(literal\)</code> but $math$`,
    'math normalization leaves HTML code untouched',
  );

  const alternateCode = '~~\u007etex\n\\[fenced\\]\n~~\u007e\nand ``\\(inline\\)`` plus \\(x\\)';
  t.eq(
    mod.normalizeObsidianMathDelimiters(alternateCode),
    '~~\u007etex\n\\[fenced\\]\n~~\u007e\nand ``\\(inline\\)`` plus $x$',
    'math normalization preserves tilde fences and multi-backtick spans',
  );

  const nestedFence = '> ```tex\n> \\[fenced\\]\n> ```\n> outside \\(x\\)';
  t.eq(
    mod.normalizeObsidianMathDelimiters(nestedFence),
    '> ```tex\n> \\[fenced\\]\n> ```\n> outside $x$',
    'math normalization preserves code fences nested in Markdown containers',
  );

  const escaped = String.raw`Literal \\[not math\\] and incomplete \(x`;
  t.eq(
    mod.normalizeObsidianMathDelimiters(escaped),
    escaped,
    'escaped and incomplete delimiter sequences remain literal',
  );

  t.eq(
    mod.trimIncompleteMath('before \\[\nW_{\\mathrm{TT}}'),
    'before ',
    'streaming renderer trims an incomplete bracket-delimited formula',
  );
  const complete = 'before \\[\nW_{\\mathrm{TT}}\n\\] after';
  t.eq(
    mod.trimIncompleteMath(complete),
    complete,
    'streaming renderer preserves a complete bracket-delimited formula',
  );

  const markerCollision = '\uE000GLOSSA_CODE_0\uE001 `\\(code\\)` \\(math\\)';
  t.eq(
    mod.normalizeObsidianMathDelimiters(markerCollision),
    '\uE000GLOSSA_CODE_0\uE001 `\\(code\\)` $math$',
    'internal code markers cannot collide with model output',
  );

  const screenshotRegression = '- **Proposition 3.1**：\n  \\[\n  W_{\\mathrm{TT}}=W+2\\eta X_{\\mathrm{train}}^\\top\n  \\]\n  其中 \\(u_{\\mathrm{context}}\\)。';
  const screenshotNormalized = mod.normalizeObsidianMathDelimiters(screenshotRegression);
  t.ok(
    screenshotNormalized.includes('  $$\n  W_{\\mathrm{TT}}')
      && screenshotNormalized.includes('$u_{\\mathrm{context}}$')
      && !screenshotNormalized.includes('\\[')
      && !screenshotNormalized.includes('\\('),
    'regression: formula-heavy PDF summary renders instead of showing raw brackets and LaTeX',
  );
};
