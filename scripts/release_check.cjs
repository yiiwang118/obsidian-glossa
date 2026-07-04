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
for (const requiredPath of ['README.md', 'LICENSE', 'PRIVACY.md', 'SECURITY.md', 'CHANGELOG.md', 'styles.css']) {
  if (!fs.existsSync(requiredPath)) fail(`${requiredPath} is missing.`);
}

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

if (!process.argv.includes('--allow-dirty')) {
  try {
    const status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
    if (status) fail('working tree is dirty. Commit or stash changes before tagging a release.');
  } catch (e) {
    fail(`git status failed: ${e.message}`);
  }
}

console.log(`release:check ok (${manifest.id} ${manifest.version})`);
