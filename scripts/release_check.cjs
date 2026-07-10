#!/usr/bin/env node
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function fail(message) {
  console.error(`release:check failed: ${message}`);
  process.exit(1);
}

function readJson(path) {
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch (e) {
    fail(`cannot read ${path}: ${e.message}`);
  }
}

const manifest = readJson('manifest.json');
const pkg = readJson('package.json');
const lock = readJson('package-lock.json');
const versions = readJson('versions.json');

if (!manifest.id || !/^[a-z0-9-]+$/.test(manifest.id)) fail('manifest.id must be lowercase letters, numbers, and hyphens.');
if (pkg.name !== manifest.id) fail(`package name (${pkg.name}) must match manifest.id (${manifest.id}).`);
if (pkg.main !== 'main.js') fail('package main must be main.js.');
if (pkg.license !== 'MIT') fail('package license must be MIT.');
expectPackageScripts(pkg.scripts ?? {});
if (manifest.isDesktopOnly !== true) fail('manifest.isDesktopOnly must be true for this desktop-only plugin.');
if (manifest.version !== pkg.version) fail(`manifest version (${manifest.version}) does not match package version (${pkg.version}).`);
if (lock.version && lock.version !== pkg.version) fail(`package-lock version (${lock.version}) does not match package version (${pkg.version}).`);
if (lock.packages?.['']?.version && lock.packages[''].version !== pkg.version) {
  fail(`package-lock root package version (${lock.packages[''].version}) does not match package version (${pkg.version}).`);
}
if (!versions[manifest.version]) fail(`versions.json is missing ${manifest.version}.`);
if (versions[manifest.version] !== manifest.minAppVersion) {
  fail(`versions.json ${manifest.version} (${versions[manifest.version]}) does not match manifest.minAppVersion (${manifest.minAppVersion}).`);
}
const description = typeof manifest.description === 'string' ? manifest.description.trim() : '';
if (!description.endsWith('.')) {
  fail('manifest.description must end with a period.');
}
if (description.length > 250) {
  fail(`manifest.description must be 250 characters or fewer (${description.length}).`);
}
if (/\bobsidian\b/i.test(description)) {
  fail('manifest.description must not include "Obsidian"; the plugin directory context already implies it.');
}
if (/[\r\n]/.test(description)) {
  fail('manifest.description must be a single line.');
}
if (pkg.description !== manifest.description) {
  fail('package description must match manifest.description.');
}
for (const requiredPath of ['README.md', 'README.zh-CN.md', 'LICENSE', 'PRIVACY.md', 'SECURITY.md', 'CHANGELOG.md', 'styles.css']) {
  if (!fs.existsSync(requiredPath)) fail(`${requiredPath} is missing.`);
}

for (const docPath of ['README.md', 'README.zh-CN.md', 'CHANGELOG.md', 'manifest.json', 'package.json']) {
  const text = fs.readFileSync(docPath, 'utf8');
  for (const [label, pattern] of [
    ['old marketplace description', /AI sidebar with multi-provider chat, @-context, semantic search \(RAG\), agent mode with sandboxed file edits, MCP bridge, encrypted keys, and Codex CLI integration/i],
    ['old unreviewed marketplace suffix', /This plugin has not been manually/i],
  ]) {
    if (pattern.test(text)) fail(`${docPath} contains ${label}.`);
  }
}
for (const docPath of ['README.md', 'README.zh-CN.md', 'PRIVACY.md', 'SECURITY.md']) {
  const text = fs.readFileSync(docPath, 'utf8');
  for (const [label, pattern] of [
    ['removed local CLI endpoint claim', /\b(?:Codex CLI endpoint|Claude Code CLI endpoint|CLI `--version`|login shell\s*\(\$SHELL)\b/i],
    ['removed MCP runtime claim', /\b(?:MCP child env|MCP server child process|MCP catalog refresh|Marketplace command injection)\b/i],
    ['removed semantic index upload claim', /\b(?:RAG index build|auto-RAG|build the embedding index)\b/i],
  ]) {
    if (pattern.test(text)) fail(`${docPath} contains ${label}.`);
  }
}

const releaseAssets = ['main.js', 'manifest.json', 'styles.css'];
requireReleaseAssets(releaseAssets);
expectCiNonEmptyAssetChecks('.github/workflows/ci.yml', releaseAssets);
expectWorkflowAssetBlock('.github/workflows/ci.yml', 'path', releaseAssets);
expectWorkflowAssetBlock('.github/workflows/release.yml', 'subject-path', releaseAssets);
expectWorkflowAssetBlock('.github/workflows/release.yml', 'files', releaseAssets);
scanTrackedFilesForSecrets();

function listTsFiles(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listTsFiles(p));
    else if (ent.isFile() && p.endsWith('.ts')) out.push(p);
  }
  return out;
}

function hasExplicitAnyKeyword(file, source) {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let found = false;
  function visit(node) {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return found;
}

function expectPackageScripts(scripts) {
  expectScriptEquals(scripts, 'typecheck', 'tsc --noEmit');
  expectScriptEquals(scripts, 'test', 'node tests/run.cjs');
  expectScriptEquals(scripts, 'build', 'node esbuild.config.mjs production');
  expectScriptEquals(scripts, 'release:check', 'node scripts/release_check.cjs');
  expectScriptEquals(scripts, 'review:scan', 'node scripts/review_scan.cjs');
  expectScriptIncludes(scripts, 'lint:review', ['eslint "src/**/*.ts"', '--max-warnings=0']);
  expectScriptIncludes(scripts, 'lint:directives', [
    'eslint "src/**/*.ts"',
    '--report-unused-disable-directives',
    '--max-warnings=0',
    '@typescript-eslint/no-explicit-any:error',
    '@typescript-eslint/no-unsafe-argument:error',
    '@typescript-eslint/no-unsafe-return:error',
    '@typescript-eslint/no-duplicate-type-constituents:error',
    '@typescript-eslint/only-throw-error:error',
    '@typescript-eslint/no-unused-vars:error',
  ]);
  expectScriptIncludes(scripts, 'check', [
    'npm run typecheck',
    'npm run lint:review',
    'npm run lint:strict',
    'npm run lint:directives',
    'npm test',
    'npm audit --omit=optional',
    'npm run build',
    'npm run release:check -- --allow-dirty',
  ]);
  expectScriptIncludes(scripts, 'lint:strict', [
    '--max-warnings=0',
    '@typescript-eslint/no-explicit-any:error',
    '@typescript-eslint/no-unsafe-argument:error',
    '@typescript-eslint/no-unsafe-return:error',
    '@typescript-eslint/no-duplicate-type-constituents:error',
    '@typescript-eslint/only-throw-error:error',
    '@typescript-eslint/no-unused-vars:error',
  ]);
}

function expectScriptEquals(scripts, name, expected) {
  if (scripts[name] !== expected) {
    fail(`package script ${name} must be ${JSON.stringify(expected)}.`);
  }
}

function expectScriptIncludes(scripts, name, fragments) {
  const script = typeof scripts[name] === 'string' ? scripts[name] : '';
  if (!script) fail(`package script ${name} is missing.`);
  for (const fragment of fragments) {
    if (!script.includes(fragment)) fail(`package script ${name} must include ${fragment}.`);
  }
}

function requireReleaseAssets(files) {
  for (const file of files) {
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      fail(`release asset ${file} is missing.`);
    }
    if (!stat.isFile()) fail(`release asset ${file} is not a file.`);
    if (stat.size <= 0) fail(`release asset ${file} is empty.`);
  }
}

function expectCiNonEmptyAssetChecks(file, assets) {
  const text = fs.readFileSync(file, 'utf8');
  for (const asset of assets) {
    if (!new RegExp(`test\\s+-s\\s+${escapeRegExp(asset)}\\b`).test(text)) {
      fail(`${file} must verify ${asset} with test -s.`);
    }
    if (new RegExp(`test\\s+-f\\s+${escapeRegExp(asset)}\\b`).test(text)) {
      fail(`${file} must not verify ${asset} with test -f; use test -s.`);
    }
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function expectWorkflowAssetBlock(file, key, expected) {
  const blocks = workflowLiteralBlocks(file, key);
  if (!blocks.length) fail(`${file} is missing ${key}: | asset block.`);
  for (const block of blocks) {
    const actual = block.filter(line => line && !line.startsWith('#'));
    if (actual.length !== expected.length || actual.some((line, index) => line !== expected[index])) {
      fail(`${file} ${key}: | must contain only ${expected.join(', ')}.`);
    }
  }
}

function workflowLiteralBlocks(file, key) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const match = new RegExp(`^(\\s*)${key}:\\s*\\|\\s*$`).exec(lines[i]);
    if (!match) continue;
    const parentIndent = match[1].length;
    const block = [];
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (!line.trim()) {
        block.push('');
        continue;
      }
      const indent = line.match(/^\s*/)?.[0].length ?? 0;
      if (indent <= parentIndent) break;
      block.push(line.trim());
    }
    blocks.push(block);
  }
  return blocks;
}

function scanTrackedFilesForSecrets() {
  const files = trackedFiles();
  const forbiddenNames = new Set([
    '.env',
    '.env.local',
    'data.json',
    'chats.json',
    'chats.deleted.json',
    'checkpoints.json',
    'embeddings.json',
  ]);
  const secretFilePattern = /\.(?:key|pem|p12|pfx)$/i;
  const secretValuePatterns = [
    ['provider API key', /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}\b/],
    ['GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/],
    ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
    ['private key block', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ];

  for (const file of files) {
    const base = path.basename(file);
    if (forbiddenNames.has(base) || secretFilePattern.test(base)) {
      fail(`${file} is a runtime/secret file and must not be tracked.`);
    }
    const text = readSmallTextFile(file);
    if (!text) continue;
    for (const [label, pattern] of secretValuePatterns) {
      if (pattern.test(text)) fail(`${file} contains a live-looking ${label}.`);
    }
  }
}

function trackedFiles() {
  try {
    return execFileSync('git', ['ls-files'], { encoding: 'utf8' })
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
  } catch (e) {
    fail(`git ls-files failed: ${e.message}`);
  }
}

function readSmallTextFile(file) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 1024 * 1024) return '';
    const buf = fs.readFileSync(file);
    if (buf.includes(0)) return '';
    return buf.toString('utf8');
  } catch {
    return '';
  }
}

for (const file of listTsFiles('src')) {
  const source = fs.readFileSync(file, 'utf8');
  const disableCount = (source.match(/\/\* eslint-disable /g) || []).length;
  const enableCount = (source.match(/\/\* eslint-enable /g) || []).length;
  if (disableCount !== enableCount) {
    fail(`${file} has ${disableCount} eslint-disable directive(s) but ${enableCount} eslint-enable directive(s).`);
  }
  if (/eslint-(?:disable|enable)[\s\S]*?@typescript-eslint\/no-explicit-any/.test(source)) {
    fail(`${file} disables @typescript-eslint/no-explicit-any, which Obsidian review rejects.`);
  }
  for (const directive of source.matchAll(/\/\* eslint-enable ([\s\S]*?) \*\//g)) {
    if (!/\s--\s/.test(directive[1])) {
      fail(`${file} has an eslint-enable directive without a description.`);
    }
  }
  if (hasExplicitAnyKeyword(file, source)) {
    fail(`${file} contains an explicit TypeScript any keyword.`);
  }
  for (const [label, pattern] of [
    ['globalThis', /\bglobalThis\b/],
    ['instanceof HTMLElement', /\binstanceof\s+HTMLElement\b/],
    ['navigator.clipboard', /\bnavigator\.clipboard\b/],
    ['clipboardData', /\bclipboardData\b/],
  ]) {
    if (pattern.test(source)) fail(`${file} contains review-blocked source pattern: ${label}.`);
  }
}

try {
  execFileSync(process.execPath, ['scripts/review_scan.cjs'], { stdio: 'inherit' });
} catch (e) {
  fail(`review scan failed: ${e.message}`);
}

if (!process.argv.includes('--allow-dirty')) {
  try {
    const status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
    if (status) fail('working tree is dirty. Commit or stash changes before tagging a release.');
  } catch (e) {
    fail(`git status failed: ${e.message}`);
  }
}

console.log(`release:check ok (${manifest.id} ${manifest.version})`);
