#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.resolve(process.argv[2] || '.');

function fail(message) {
  console.error(`review:scan failed: ${message}`);
  process.exitCode = 1;
}

function readText(file) {
  try {
    return fs.readFileSync(path.join(ROOT, file), 'utf8');
  } catch (e) {
    fail(`cannot read ${file}: ${e.message}`);
    return '';
  }
}

function listFiles(dir, predicate) {
  const out = [];
  const absDir = path.join(ROOT, dir);
  for (const ent of fs.readdirSync(absDir, { withFileTypes: true })) {
    const rel = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listFiles(rel, predicate));
    else if (ent.isFile() && predicate(rel)) out.push(rel);
  }
  return out;
}

function lineForIndex(text, index) {
  return text.slice(0, index).split('\n').length;
}

function scanText(file, text, checks) {
  for (const check of checks) {
    const re = new RegExp(check.pattern.source, check.pattern.flags.includes('g') ? check.pattern.flags : `${check.pattern.flags}g`);
    for (const match of text.matchAll(re)) {
      fail(`${file}:${lineForIndex(text, match.index ?? 0)} contains ${check.label}`);
    }
  }
}

const bundleChecks = [
  { label: 'source map marker', pattern: /sourceMappingURL|sourcesContent/ },
  { label: 'clipboard access marker', pattern: /navigator\.clipboard|clipboardData|(?:electron|obsidian)\.clipboard|\bclipboard\.(?:read|write|readText|writeText)\b/i },
  { label: 'Node filesystem require marker', pattern: /require\(["'](?:node:)?fs["']\)/ },
  { label: 'Node child_process require marker', pattern: /child_process|spawn\(|execFile|execSync/ },
  { label: 'Node os/system identity marker', pattern: /require\(["'](?:node:)?os["']\)|os\.hostname|os\.userInfo|networkInterfaces/ },
  { label: 'process.env marker', pattern: /process\.env/ },
  { label: 'vault enumeration marker', pattern: /getMarkdownFiles|getFiles\(|vault\.getFiles/ },
  { label: 'command dispatch marker', pattern: /executeCommandById|commands\.executeCommand|Command palette ID/i },
  { label: 'MCP marketplace marker', pattern: /MCP_CATALOG|mcp_marketplace/ },
  { label: 'unsafe HTML sink marker', pattern: /\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML|createContextualFragment|document\.write|srcdoc/i },
  { label: 'dynamic code execution marker', pattern: /\beval\s*\(|new\s+Function\s*\(|\bFunction\s*\(/ },
  { label: 'string timer execution marker', pattern: /set(?:Timeout|Interval)\s*\(\s*["'`]/ },
];

const sourceChecks = [
  { label: 'selection preview quote icon marker', pattern: /nc-selection-preview-icon|ICON\.quote/ },
  { label: 'Node filesystem source marker', pattern: /(?:import\s+(?:type\s+)?[^;]*\s+from\s+["'](?:node:)?fs["']|require\s*\(\s*["'](?:node:)?fs["']\s*\))/ },
  { label: 'Node child_process source marker', pattern: /(?:import\s+(?:type\s+)?[^;]*\s+from\s+["'](?:node:)?child_process["']|require\s*\(\s*["'](?:node:)?child_process["']\s*\)|\bspawn\s*\(|\bexecFile\s*\(|\bexecSync\s*\()/ },
  { label: 'Node os/system identity source marker', pattern: /(?:import\s+(?:type\s+)?[^;]*\s+from\s+["'](?:node:)?os["']|require\s*\(\s*["'](?:node:)?os["']\s*\)|\bos\.(?:hostname|userInfo|networkInterfaces)\b|\bnetworkInterfaces\s*\()/ },
  { label: 'process.env source marker', pattern: /\bprocess\.env\b/ },
  { label: 'vault enumeration source marker', pattern: /\b(?:getMarkdownFiles|getFiles)\s*\(/ },
  { label: 'command dispatch source marker', pattern: /\bexecuteCommandById\b|\bcommands\.executeCommand\b|Command palette ID/i },
  { label: 'unsafe HTML sink marker', pattern: /\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML|createContextualFragment|document\.write|srcdoc/i },
  { label: 'dynamic code execution marker', pattern: /\beval\s*\(|new\s+Function\s*\(|\bFunction\s*\(/ },
  { label: 'string timer execution marker', pattern: /set(?:Timeout|Interval)\s*\(\s*["'`]/ },
];

const cssChecks = [
  { label: 'source map marker', pattern: /sourceMappingURL|sourcesContent/ },
  { label: '!important', pattern: /!important/ },
  { label: 'CSS :has() selector', pattern: /:has\(/ },
  { label: 'duplicate font-size declaration on one rule line', pattern: /font-size:[^;]+;[^\n]*font-size:/ },
  { label: 'selection preview icon style marker', pattern: /nc-selection-preview-icon/ },
];

scanText('main.js', readText('main.js'), bundleChecks);
scanText('styles.css', readText('styles.css'), cssChecks);
for (const file of listFiles('src', p => p.endsWith('.ts'))) {
  const source = readText(file);
  scanText(file, source, sourceChecks);
  scanTopTypeUnions(file, source);
}

if (process.exitCode) process.exit(process.exitCode);
console.log('review:scan ok');

function scanTopTypeUnions(file, source) {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  function visit(node) {
    if (ts.isUnionTypeNode(node) && node.types.length > 1) {
      for (const typeNode of node.types) {
        if (typeNode.kind === ts.SyntaxKind.UnknownKeyword || isAnyValueTypeRef(typeNode)) {
          const pos = sf.getLineAndCharacterOfPosition(typeNode.getStart(sf));
          fail(`${file}:${pos.line + 1} contains union with top type`);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
}

function isAnyValueTypeRef(node) {
  return ts.isTypeReferenceNode(node) && node.typeName.getText() === 'AnyValue';
}
