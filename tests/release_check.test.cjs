const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const releaseCheckScript = path.join(repoRoot, 'scripts/release_check.cjs');
const reviewScanScript = path.join(repoRoot, 'scripts/review_scan.cjs');

function writeJson(root, rel, value) {
  writeFile(root, rel, JSON.stringify(value, null, 2) + '\n');
}

function writeFile(root, rel, text) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function workflowAssetBlock(key, extra = '') {
  return [
    `${key}: |`,
    '  main.js',
    '  manifest.json',
    '  styles.css',
    extra ? `  ${extra}` : '',
    '',
  ].filter(line => line !== '').join('\n');
}

function defaultScripts() {
  return {
    build: 'node esbuild.config.mjs production',
    test: 'node tests/run.cjs',
    typecheck: 'tsc --noEmit',
    'lint:review': 'eslint "src/**/*.ts" --max-warnings=0',
    'lint:strict': 'eslint "src/**/*.ts" --max-warnings=0 --rule \'@typescript-eslint/no-explicit-any:error\' --rule \'@typescript-eslint/no-unsafe-argument:error\' --rule \'@typescript-eslint/no-unsafe-return:error\' --rule \'@typescript-eslint/no-duplicate-type-constituents:error\' --rule \'@typescript-eslint/only-throw-error:error\' --rule \'@typescript-eslint/no-unused-vars:error\'',
    'lint:directives': 'eslint "src/**/*.ts" --report-unused-disable-directives --max-warnings=0 --rule \'@typescript-eslint/no-explicit-any:error\' --rule \'@typescript-eslint/no-unsafe-argument:error\' --rule \'@typescript-eslint/no-unsafe-return:error\' --rule \'@typescript-eslint/no-duplicate-type-constituents:error\' --rule \'@typescript-eslint/only-throw-error:error\' --rule \'@typescript-eslint/no-unused-vars:error\'',
    'review:scan': 'node scripts/review_scan.cjs',
    check: 'npm run typecheck && npm run lint:review && npm run lint:strict && npm run lint:directives && npm test && npm audit --omit=optional && npm run build && npm run release:check -- --allow-dirty',
    'release:check': 'node scripts/release_check.cjs',
  };
}

function makeFixture(mutator) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'glossa-release-check-'));
  const description = 'Local-first AI sidebar with context chat, note editing, web research, and approval-gated tools.';
  writeJson(root, 'manifest.json', {
    id: 'glossa',
    name: 'Glossa',
    version: '0.6.6',
    minAppVersion: '1.12.3',
    description,
    author: 'yiiwang',
    isDesktopOnly: true,
  });
  writeJson(root, 'package.json', {
    name: 'glossa',
    version: '0.6.6',
    description,
    main: 'main.js',
    license: 'MIT',
    scripts: defaultScripts(),
    devDependencies: { 'eslint-plugin-obsidianmd': '^0.4.1' },
  });
  writeJson(root, 'package-lock.json', {
    name: 'glossa',
    version: '0.6.6',
    lockfileVersion: 3,
    packages: { '': { version: '0.6.6' } },
  });
  writeJson(root, 'versions.json', { '0.6.6': '1.12.3' });
  writeFile(root, 'README.md', '# Glossa\n');
  writeFile(root, 'README.zh-CN.md', '# Glossa\n');
  writeFile(root, 'LICENSE', 'MIT\n');
  writeFile(root, 'PRIVACY.md', '# Privacy\n');
  writeFile(root, 'SECURITY.md', '# Security\n');
  writeFile(root, 'CHANGELOG.md', '# Changelog\n');
  writeFile(root, 'main.js', 'window.setTimeout(() => console.log("ok"), 1);\n');
  writeFile(root, 'styles.css', '.x { color: red; }\n');
  writeFile(root, 'src/clean.ts', 'export type Clean = { value: string };\n');
  writeFile(root, 'eslint.config.mjs', "import obsidianmd from 'eslint-plugin-obsidianmd';\nexport default [...obsidianmd.configs.recommended];\n");
  writeFile(root, 'scripts/review_scan.cjs', `require(${JSON.stringify(reviewScanScript)});\n`);
  writeFile(root, '.github/workflows/ci.yml', `name: CI\nsteps:\n  - name: Verify build output\n    run: |\n      test -s main.js\n      test -s manifest.json\n      test -s styles.css\n  - name: Upload\n    with:\n      ${workflowAssetBlock('path').replace(/\n/g, '\n      ')}\n`);
  writeFile(root, '.github/workflows/release.yml', [
    'name: Release',
    'permissions:',
    '  contents: write',
    '  id-token: write',
    '  attestations: write',
    'steps:',
    '  - name: Attest main.js',
    '    uses: actions/attest@v4',
    '    with:',
    '      subject-path: main.js',
    '  - name: Attest styles.css',
    '    uses: actions/attest@v4',
    '    with:',
    '      subject-path: styles.css',
    '  - name: Verify attestations',
    '    run: |',
    '      gh attestation verify main.js --repo "$GITHUB_REPOSITORY"',
    '      gh attestation verify styles.css --repo "$GITHUB_REPOSITORY"',
    '  - name: Release',
    '    with:',
    `      ${workflowAssetBlock('files').replace(/\n/g, '\n      ')}`,
    '',
  ].join('\n'));
  if (mutator) mutator(root);
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  return root;
}

function runReleaseCheck(root) {
  try {
    const stdout = execFileSync(process.execPath, [releaseCheckScript, '--allow-dirty'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, output: stdout };
  } catch (e) {
    return { ok: false, output: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

function withFixture(mutator, fn) {
  const root = makeFixture(mutator);
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

exports.run = async function(t) {
  withFixture(null, root => {
    const result = runReleaseCheck(root);
    t.ok(result.ok && result.output.includes('release:check ok'), 'clean release fixture passes');
  });

  withFixture(root => {
    writeFile(root, 'README.md', 'AI sidebar with multi-provider chat, @-context, semantic search (RAG), agent mode with sandboxed file edits, MCP bridge, encrypted keys, and Codex CLI integration.\n');
  }, root => {
    const result = runReleaseCheck(root);
    t.ok(!result.ok && result.output.includes('old marketplace description'), 'stale marketplace description is rejected');
  });

  withFixture(root => {
    writeFile(root, 'PRIVACY.md', 'Codex CLI endpoint reads your login shell ($SHELL -lic env) and tests CLI `--version`.\n');
  }, root => {
    const result = runReleaseCheck(root);
    t.ok(!result.ok && result.output.includes('removed local CLI endpoint claim'), 'removed local CLI endpoint docs are rejected');
  });

  withFixture(root => {
    writeFile(root, 'SECURITY.md', 'MCP child env leakage and Marketplace command injection are in scope.\n');
  }, root => {
    const result = runReleaseCheck(root);
    t.ok(!result.ok && result.output.includes('removed MCP runtime claim'), 'removed MCP runtime docs are rejected');
  });

  withFixture(root => {
    writeFile(root, 'README.md', 'RAG index build uploads every markdown file; auto-RAG uses it later.\n');
  }, root => {
    const result = runReleaseCheck(root);
    t.ok(!result.ok && result.output.includes('removed semantic index upload claim'), 'removed semantic index upload docs are rejected');
  });

  withFixture(root => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    manifest.description = 'Obsidian AI sidebar for notes.';
    pkg.description = manifest.description;
    writeJson(root, 'manifest.json', manifest);
    writeJson(root, 'package.json', pkg);
  }, root => {
    const result = runReleaseCheck(root);
    t.ok(!result.ok && result.output.includes('must not include "Obsidian"'), 'manifest description with Obsidian is rejected');
  });

  withFixture(root => {
    fs.rmSync(path.join(root, 'README.zh-CN.md'));
  }, root => {
    const result = runReleaseCheck(root);
    t.ok(!result.ok && result.output.includes('README.zh-CN.md is missing'), 'Chinese README is required');
  });

  withFixture(root => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    manifest.isDesktopOnly = false;
    writeJson(root, 'manifest.json', manifest);
  }, root => {
    const result = runReleaseCheck(root);
    t.ok(!result.ok && result.output.includes('manifest.isDesktopOnly must be true'), 'desktop-only manifest flag is required');
  });

  withFixture(root => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    pkg.name = 'not-glossa';
    writeJson(root, 'package.json', pkg);
  }, root => {
    const result = runReleaseCheck(root);
    t.ok(!result.ok && result.output.includes('package name (not-glossa) must match manifest.id (glossa)'), 'package name must match manifest id');
  });

  withFixture(root => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    pkg.main = 'dist/main.js';
    writeJson(root, 'package.json', pkg);
  }, root => {
    const result = runReleaseCheck(root);
    t.ok(!result.ok && result.output.includes('package main must be main.js'), 'package main must point at release asset');
  });

  withFixture(root => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    pkg.license = 'UNLICENSED';
    writeJson(root, 'package.json', pkg);
  }, root => {
    const result = runReleaseCheck(root);
    t.ok(!result.ok && result.output.includes('package license must be MIT'), 'package license must stay MIT');
  });

  withFixture(root => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    pkg.scripts.check = 'npm run typecheck && npm test';
    writeJson(root, 'package.json', pkg);
  }, root => {
    const result = runReleaseCheck(root);
    t.ok(!result.ok && result.output.includes('package script check must include npm run lint:review'), 'package check script must keep strict gate chain');
  });

  withFixture(root => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    pkg.scripts['review:scan'] = 'node scripts/old_scan.cjs';
    writeJson(root, 'package.json', pkg);
  }, root => {
    const result = runReleaseCheck(root);
    t.ok(!result.ok && result.output.includes('package script review:scan must be "node scripts/review_scan.cjs"'), 'package review scan script must point at review_scan');
  });

  withFixture(root => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    pkg.scripts.typecheck = 'tsc';
    writeJson(root, 'package.json', pkg);
  }, root => {
    const result = runReleaseCheck(root);
    t.ok(!result.ok && result.output.includes('package script typecheck must be "tsc --noEmit"'), 'package typecheck script must avoid emitting files');
  });

  withFixture(root => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    pkg.scripts.build = 'node esbuild.config.mjs';
    writeJson(root, 'package.json', pkg);
  }, root => {
    const result = runReleaseCheck(root);
    t.ok(!result.ok && result.output.includes('package script build must be "node esbuild.config.mjs production"'), 'package build script must use production mode');
  });

  withFixture(root => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    pkg.scripts['lint:review'] = 'eslint "src/**/*.ts"';
    writeJson(root, 'package.json', pkg);
  }, root => {
    const result = runReleaseCheck(root);
    t.ok(!result.ok && result.output.includes('package script lint:review must include --max-warnings=0'), 'package lint:review script must fail on warnings');
  });

  withFixture(root => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    delete pkg.devDependencies['eslint-plugin-obsidianmd'];
    writeJson(root, 'package.json', pkg);
  }, root => {
    const result = runReleaseCheck(root);
    t.ok(!result.ok && result.output.includes('devDependencies must include eslint-plugin-obsidianmd'), 'official Obsidian lint dependency is required');
  });

  withFixture(root => {
    writeFile(root, 'eslint.config.mjs', 'export default [];\n');
  }, root => {
    const result = runReleaseCheck(root);
    t.ok(!result.ok && result.output.includes('must enable the official obsidianmd recommended rules'), 'official Obsidian lint config is required');
  });

  withFixture(root => {
    fs.rmSync(path.join(root, 'main.js'));
  }, root => {
    const result = runReleaseCheck(root);
    t.ok(!result.ok && result.output.includes('release asset main.js is missing'), 'missing main.js release asset is rejected');
  });

  withFixture(root => {
    writeFile(root, 'styles.css', '');
  }, root => {
    const result = runReleaseCheck(root);
    t.ok(!result.ok && result.output.includes('release asset styles.css is empty'), 'empty styles.css release asset is rejected');
  });

  withFixture(root => {
    writeFile(root, '.github/workflows/ci.yml', `name: CI\nsteps:\n  - name: Verify build output\n    run: |\n      test -f main.js\n      test -s manifest.json\n      test -s styles.css\n  - name: Upload\n    with:\n      ${workflowAssetBlock('path').replace(/\n/g, '\n      ')}\n`);
  }, root => {
    const result = runReleaseCheck(root);
    t.ok(!result.ok && result.output.includes('must verify main.js with test -s'), 'CI must verify release assets are non-empty');
  });

  withFixture(root => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    pkg.version = '0.6.5';
    writeJson(root, 'package.json', pkg);
  }, root => {
    const result = runReleaseCheck(root);
    t.ok(!result.ok && result.output.includes('manifest version (0.6.6) does not match package version (0.6.5)'), 'manifest/package version mismatch is rejected');
  });

  withFixture(root => {
    const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
    lock.packages[''].version = '0.6.5';
    writeJson(root, 'package-lock.json', lock);
  }, root => {
    const result = runReleaseCheck(root);
    t.ok(!result.ok && result.output.includes('package-lock root package version (0.6.5) does not match package version (0.6.6)'), 'package-lock root version mismatch is rejected');
  });

  withFixture(root => {
    writeJson(root, 'versions.json', { '0.6.6': '1.11.0' });
  }, root => {
    const result = runReleaseCheck(root);
    t.ok(!result.ok && result.output.includes('versions.json 0.6.6 (1.11.0) does not match manifest.minAppVersion (1.12.3)'), 'versions minAppVersion mismatch is rejected');
  });

  withFixture(root => {
    writeFile(root, 'src/clean.ts', '/* eslint-disable @typescript-eslint/no-unsafe-assignment -- temporary */\nexport const value = "x";\n');
  }, root => {
    const result = runReleaseCheck(root);
    t.ok(!result.ok && result.output.includes('eslint-disable directive(s) but 0 eslint-enable directive'), 'unpaired eslint directive is rejected');
  });

  withFixture(root => {
    writeFile(root, 'src/clean.ts', '/* eslint-disable @typescript-eslint/no-explicit-any -- forbidden */\nexport const value = "x";\n/* eslint-enable @typescript-eslint/no-explicit-any -- forbidden */\n');
  }, root => {
    const result = runReleaseCheck(root);
    t.ok(!result.ok && result.output.includes('disables @typescript-eslint/no-explicit-any'), 'no-explicit-any directive disable is rejected');
  });

  withFixture(root => {
    writeFile(root, 'src/clean.ts', '/* eslint-disable @typescript-eslint/no-unsafe-call -- explained */\nfn();\n/* eslint-enable @typescript-eslint/no-unsafe-call */\n');
  }, root => {
    const result = runReleaseCheck(root);
    t.ok(!result.ok && result.output.includes('eslint-enable directive without a description'), 'undescribed eslint-enable directive is rejected');
  });

  withFixture(root => {
    writeFile(root, 'src/clean.ts', 'export const value: any = "x";\n');
  }, root => {
    const result = runReleaseCheck(root);
    t.ok(!result.ok && result.output.includes('explicit TypeScript any keyword'), 'explicit any keyword is rejected');
  });

  withFixture(root => {
    writeFile(root, 'src/clean.ts', 'export const value = globalThis.location;\n');
  }, root => {
    const result = runReleaseCheck(root);
    t.ok(!result.ok && result.output.includes('review-blocked source pattern: globalThis'), 'globalThis source pattern is rejected');
  });

  withFixture(root => {
    writeFile(root, 'src/clean.ts', 'export const ok = value instanceof HTMLElement;\n');
  }, root => {
    const result = runReleaseCheck(root);
    t.ok(!result.ok && result.output.includes('review-blocked source pattern: instanceof HTMLElement'), 'instanceof HTMLElement source pattern is rejected');
  });

  withFixture(root => {
    writeFile(root, 'src/clean.ts', 'navigator.clipboard.readText();\n');
  }, root => {
    const result = runReleaseCheck(root);
    t.ok(!result.ok && result.output.includes('review-blocked source pattern: navigator.clipboard'), 'navigator.clipboard source pattern is rejected');
  });

  withFixture(root => {
    writeFile(root, 'src/clean.ts', 'export const value = event.clipboardData;\n');
  }, root => {
    const result = runReleaseCheck(root);
    t.ok(result.ok, 'event-scoped ClipboardEvent data is allowed');
  });

  withFixture(root => {
    writeFile(root, '.github/workflows/release.yml', [
      'name: Release',
      'steps:',
      '  - name: Release',
      '    with:',
      `      ${workflowAssetBlock('files', 'src/main.ts').replace(/\n/g, '\n      ')}`,
      '',
    ].join('\n'));
  }, root => {
    const result = runReleaseCheck(root);
    t.ok(!result.ok && result.output.includes('must contain only main.js, manifest.json, styles.css'), 'extra release asset is rejected');
  });

  withFixture(root => {
    writeFile(root, '.github/workflows/release.yml', [
      'name: Release',
      'permissions:',
      '  contents: write',
      '  id-token: write',
      '  attestations: write',
      'steps:',
      '  - uses: actions/attest@v4',
      '    with:',
      `      ${workflowAssetBlock('subject-path').replace(/\n/g, '\n      ')}`,
      '  - name: Release',
      '    with:',
      `      ${workflowAssetBlock('files').replace(/\n/g, '\n      ')}`,
      '',
    ].join('\n'));
  }, root => {
    const result = runReleaseCheck(root);
    t.ok(
      !result.ok && result.output.includes('must attest each release asset independently'),
      'incompatible multi-asset attestations are rejected',
    );
  });

  withFixture(root => {
    const workflow = fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8');
    writeFile(root, '.github/workflows/release.yml', workflow.replace(
      /  - name: Attest styles\.css[\s\S]*?      subject-path: styles\.css\n/,
      '',
    ));
  }, root => {
    const result = runReleaseCheck(root);
    t.ok(
      !result.ok && result.output.includes('must independently attest exactly main.js, styles.css'),
      'a missing release asset attestation is rejected',
    );
  });

  withFixture(root => {
    const workflow = fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8');
    writeFile(root, '.github/workflows/release.yml', workflow.replace(
      '      gh attestation verify styles.css --repo "$GITHUB_REPOSITORY"\n',
      '',
    ));
  }, root => {
    const result = runReleaseCheck(root);
    t.ok(
      !result.ok && result.output.includes('must verify the styles.css attestation'),
      'an unverified release attestation is rejected',
    );
  });

  withFixture(root => {
    writeFile(root, '.env.local', 'OPENAI_API_KEY=placeholder\n');
  }, root => {
    const result = runReleaseCheck(root);
    t.ok(!result.ok && result.output.includes('.env.local is a runtime/secret file'), 'tracked local env file is rejected');
  });

  withFixture(root => {
    const fakeKey = 'sk-proj-' + 'A'.repeat(24);
    writeFile(root, 'README.md', `debug token: ${fakeKey}\n`);
  }, root => {
    const result = runReleaseCheck(root);
    t.ok(!result.ok && result.output.includes('live-looking provider API key'), 'live-looking provider key is rejected');
  });
};
