#!/usr/bin/env node
/* Minimal in-tree test runner — no jest/vitest dependency.
 *
 * Each test file is a CJS module that imports the source via inline esbuild bundle.
 * It calls `t.eq(actual, expected, label)` / `t.ok(cond, label)` / `t.throws(fn, label)`.
 * The runner aggregates pass/fail counts and exits non-zero on any failure.
 */
const path = require('path');
const fs = require('fs');
const esbuild = require('esbuild');

function installBrowserGlobalsForNode() {
  const win = globalThis.window ?? {};
  win.setTimeout = globalThis.setTimeout.bind(globalThis);
  win.clearTimeout = globalThis.clearTimeout.bind(globalThis);
  win.setInterval = globalThis.setInterval.bind(globalThis);
  win.clearInterval = globalThis.clearInterval.bind(globalThis);
  win.requestAnimationFrame ??= (cb) => win.setTimeout(() => cb(Date.now()), 16);
  win.cancelAnimationFrame ??= (id) => win.clearTimeout(id);
  win.queueMicrotask ??= globalThis.queueMicrotask?.bind(globalThis);
  win.AbortController ??= globalThis.AbortController;
  win.AbortSignal ??= globalThis.AbortSignal;
  win.URL ??= globalThis.URL;
  win.URLSearchParams ??= globalThis.URLSearchParams;
  globalThis.window = win;
  globalThis.requestAnimationFrame ??= win.requestAnimationFrame;
  globalThis.cancelAnimationFrame ??= win.cancelAnimationFrame;
}

installBrowserGlobalsForNode();

let passed = 0, failed = 0;
const failures = [];

function makeT(file) {
  return {
    eq(actual, expected, label) {
      const a = typeof actual === 'object' ? JSON.stringify(actual) : String(actual);
      const e = typeof expected === 'object' ? JSON.stringify(expected) : String(expected);
      if (a === e) { passed++; process.stdout.write('.'); }
      else { failed++; failures.push(`${file} :: ${label}\n  expected: ${e}\n  actual:   ${a}`); process.stdout.write('F'); }
    },
    ok(cond, label) {
      if (cond) { passed++; process.stdout.write('.'); }
      else { failed++; failures.push(`${file} :: ${label}\n  condition false`); process.stdout.write('F'); }
    },
    throws(fn, label) {
      try { fn(); failed++; failures.push(`${file} :: ${label}\n  expected throw, none happened`); process.stdout.write('F'); }
      catch { passed++; process.stdout.write('.'); }
    },
  };
}

/** Bundle a TS source file into a CJS module and require it. */
async function loadModule(srcPath) {
  const r = await esbuild.build({
    entryPoints: [srcPath],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'es2020',
    write: false,
    sourcemap: false,
    external: ['obsidian'],          // we shim obsidian below
  });
  const code = r.outputFiles[0].text;
  // Provide a fake "obsidian" module so imports don't blow up
  const Module = require('module');
  const orig = Module.prototype.require;
  Module.prototype.require = function(req) {
    if (req === 'obsidian') return {
      TFile: class TFile {}, TFolder: class TFolder {},
      Modal: class Modal {
        constructor(app) {
          this.app = app;
          this.contentEl = { empty() {}, createEl() { return this; }, addClass() {}, removeClass() {}, appendText() {} };
          this.modalEl = { addClass() {}, removeClass() {} };
        }
        open() {}
        close() {}
      },
      Notice: class Notice {},
      loadPdfJs: async () => ({ getDocument: () => { throw new Error('loadPdfJs shim has no document'); } }),
      getAllTags: () => [], prepareSimpleSearch: () => null,
      requestUrl: () => ({ status: 200, text: '[]', json: [] }),
    };
    return orig.apply(this, arguments);
  };
  try {
    const wrap = `(function(module){${code}return module.exports;})({exports:{}})`;
    return eval(wrap);
  } finally {
    Module.prototype.require = orig;
  }
}

async function main() {
  const testsDir = path.resolve(__dirname);
  const requested = process.argv.slice(2).map(f => path.basename(f)).filter(Boolean);
  const requestedSet = new Set(requested);
  const files = fs.readdirSync(testsDir)
    .filter(f => f.endsWith('.test.cjs'))
    .filter(f => requestedSet.size === 0 || requestedSet.has(f))
    .sort();
  if (requestedSet.size > 0 && files.length === 0) {
    console.error(`No matching test files: ${requested.join(', ')}`);
    process.exit(1);
  }
  console.log(`Running ${files.length} test file${files.length === 1 ? '' : 's'}…\n`);
  for (const f of files) {
    const mod = require(path.join(testsDir, f));
    if (typeof mod.run !== 'function') {
      console.warn(`! ${f} has no run() export, skipping`);
      continue;
    }
    const t = makeT(f);
    try { await mod.run(t, loadModule); }
    catch (e) { failed++; failures.push(`${f} :: threw: ${e.stack ?? e}`); process.stdout.write('!'); }
  }
  console.log('\n');
  if (failures.length) {
    console.log('\nFailures:\n');
    for (const f of failures) console.log('  - ' + f + '\n');
  }
  console.log(`Result: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
