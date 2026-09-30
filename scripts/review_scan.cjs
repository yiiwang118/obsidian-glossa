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

const DESKTOP_CLI = 'src/providers/local_cli.ts';
const DESKTOP_LABELS = new Set(['Node filesystem require marker', 'Node filesystem source marker', 'Node child_process require marker', 'Node child_process source marker', 'Node os/system identity marker', 'Node os/system identity source marker', 'process.env marker', 'process.env source marker']);

function scanText(file, text, checks) {
  const start = file === 'main.js' ? text.indexOf(`// ${DESKTOP_CLI}\n`) : -1;
  const end = start < 0 ? -1 : text.indexOf('\n// src/', start + 1);
  for (const check of checks) {
    const re = new RegExp(check.pattern.source, check.pattern.flags.includes('g') ? check.pattern.flags : `${check.pattern.flags}g`);
    for (const match of text.matchAll(re)) {
      // Desktop CLI is an explicit, reviewed capability. All other modules
      // retain the original ban. The boundary receives additional AST checks.
      if (DESKTOP_LABELS.has(check.label) && (file === DESKTOP_CLI || (start >= 0 && match.index > start && end > match.index))) continue;
      fail(`${file}:${lineForIndex(text, match.index ?? 0)} contains ${check.label}`);
    }
  }
}

const bundleChecks = [
  { label: 'source map marker', pattern: /sourceMappingURL|sourcesContent/ },
  { label: 'ambient clipboard access marker', pattern: /navigator\.clipboard|(?:electron|obsidian)\.clipboard|\bclipboard\.(?:read|write|readText|writeText)\b/i },
  { label: 'Node filesystem require marker', pattern: /require\(["'](?:node:)?fs["']\)/ },
  { label: 'Node child_process require marker', pattern: /child_process|spawn\(|execFile|execSync/ },
  { label: 'Node os/system identity marker', pattern: /require\(["'](?:node:)?os["']\)|os\.hostname|os\.userInfo|networkInterfaces/ },
  { label: 'process.env marker', pattern: /(?:process|processApi)\.env/ },
  { label: 'vault enumeration marker', pattern: /getMarkdownFiles|getFiles\(|vault\.getFiles/ },
  { label: 'command dispatch marker', pattern: /executeCommandById|commands\.executeCommand|Command palette ID/i },
  { label: 'MCP marketplace marker', pattern: /MCP_CATALOG|mcp_marketplace/ },
  { label: 'unsafe HTML sink marker', pattern: /\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML|createContextualFragment|document\.write|\.srcdoc\b|\bsrcdoc\s*=/ },
  { label: 'dynamic code execution marker', pattern: /\beval\s*\(|new\s+Function\s*\(|\bFunction\s*\(/ },
  { label: 'string timer execution marker', pattern: /set(?:Timeout|Interval)\s*\(\s*["'`]/ },
];

const sourceChecks = [
  { label: 'selection preview quote icon marker', pattern: /nc-selection-preview-icon|ICON\.quote/ },
  { label: 'Node filesystem source marker', pattern: /(?:import\s+(?:type\s+)?[^;]*\s+from\s+["'](?:node:)?fs["']|require\s*\(\s*["'](?:node:)?fs["']\s*\))/ },
  { label: 'Node child_process source marker', pattern: /(?:import\s+(?:type\s+)?[^;]*\s+from\s+["'](?:node:)?child_process["']|require\s*\(\s*["'](?:node:)?child_process["']\s*\)|\bspawn\s*\(|\bexecFile\s*\(|\bexecSync\s*\()/ },
  { label: 'Node os/system identity source marker', pattern: /(?:import\s+(?:type\s+)?[^;]*\s+from\s+["'](?:node:)?os["']|require\s*\(\s*["'](?:node:)?os["']\s*\)|\bos\.(?:hostname|userInfo|networkInterfaces)\b|\bnetworkInterfaces\s*\()/ },
  { label: 'process.env source marker', pattern: /\b(?:process|processApi)\.env\b/ },
  { label: 'dynamic Node import outside desktop boundary', pattern: /\bimport\s*\(\s*["']node:(?:child_process|os|process)["']\s*\)/ },
  { label: 'vault enumeration source marker', pattern: /\b(?:getMarkdownFiles|getFiles)\s*\(/ },
  { label: 'command dispatch source marker', pattern: /\bexecuteCommandById\b|\bcommands\.executeCommand\b|Command palette ID/i },
  { label: 'unsafe HTML sink marker', pattern: /\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML|createContextualFragment|document\.write|\.srcdoc\b|\bsrcdoc\s*=/ },
  { label: 'dynamic code execution marker', pattern: /\beval\s*\(|new\s+Function\s*\(|\bFunction\s*\(/ },
  { label: 'string timer execution marker', pattern: /set(?:Timeout|Interval)\s*\(\s*["'`]/ },
];

const cssChecks = [
  { label: 'source map marker', pattern: /sourceMappingURL|sourcesContent/ },
  { label: '!important', pattern: /!important/ },
  { label: 'CSS :has() selector', pattern: /:has\(/ },
  { label: 'CSS multicolumn property', pattern: /(?:^|[;{\n]\s*)(?:columns|column-(?:count|fill|gap|rule(?:-color|-style|-width)?|span|width))\s*:/m },
  { label: 'duplicate font-size declaration on one rule line', pattern: /font-size:[^;]+;[^\n]*font-size:/ },
  { label: 'selection preview icon style marker', pattern: /nc-selection-preview-icon/ },
];

scanText('main.js', readText('main.js'), bundleChecks);
scanText('styles.css', readText('styles.css'), cssChecks);
for (const file of listFiles('src', p => p.endsWith('.ts'))) {
  const source = readText(file);
  scanText(file, source, file === DESKTOP_CLI ? sourceChecks.filter(c => c.label !== 'dynamic Node import outside desktop boundary') : sourceChecks);
  scanTopTypeUnions(file, source);
}
scanDesktopBoundary();

if (process.exitCode) process.exit(process.exitCode);
console.log('review:scan ok');

function scanDesktopBoundary() {
  if (!fs.existsSync(path.join(ROOT, DESKTOP_CLI))) return;
  const manifest = JSON.parse(readText('manifest.json'));
  if (manifest.isDesktopOnly !== true) fail('Local CLI requires manifest.isDesktopOnly=true');
  const source = readText(DESKTOP_CLI);
  if (!source.includes('if (!Platform.isDesktopApp) throw new Error(')) fail('CLI boundary must guard desktop access');
  if (/\b(?:exec|execFile|execSync|eval)\s*\(|shell:\s*true|hostname|userInfo|networkInterfaces|readFile/.test(source)) fail('CLI boundary contains an unapproved host capability');
  const tree = ts.createSourceFile(DESKTOP_CLI, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let launches = 0;
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'spawn') {
      launches++;
      const options = node.arguments[2];
      const noShell = options && ts.isObjectLiteralExpression(options) && options.properties.some(p => ts.isPropertyAssignment(p) && p.name.getText(tree) === 'shell' && p.initializer.kind === ts.SyntaxKind.FalseKeyword);
      if (!noShell) fail('Every CLI launch must explicitly set shell:false');
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  if (launches !== 4) fail('CLI launch boundaries changed; review detection, model metadata, execution and owned-process cleanup');
}

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
