const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function writeFixture(root, files) {
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
}

function runScan(root) {
  try {
    const stdout = execFileSync(process.execPath, [path.resolve(__dirname, '../scripts/review_scan.cjs'), root], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, output: stdout };
  } catch (e) {
    return { ok: false, output: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

exports.run = async function(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'glossa-review-scan-'));
  try {
    writeFixture(root, {
      'main.js': 'window.setTimeout(() => console.log("ok"), 1);\n',
      'styles.css': '.x { color: red; }\n',
      'src/clean.ts': 'export type Clean = { value: string };\n',
    });
    const clean = runScan(root);
    t.ok(clean.ok && clean.output.includes('review:scan ok'), 'clean fixture passes review scan');

    fs.writeFileSync(path.join(root, 'main.js'), 'document.write("x");\n');
    const unsafeHtml = runScan(root);
    t.ok(!unsafeHtml.ok && unsafeHtml.output.includes('unsafe HTML sink marker'), 'bundle unsafe HTML sink is rejected');

    fs.writeFileSync(path.join(root, 'main.js'), 'window.setTimeout(() => console.log("ok"), 1);\n');
    fs.writeFileSync(path.join(root, 'styles.css'), '.x:has(.y) { color: red; }\n');
    const cssHas = runScan(root);
    t.ok(!cssHas.ok && cssHas.output.includes('CSS :has() selector'), 'CSS :has selector is rejected');

    fs.writeFileSync(path.join(root, 'styles.css'), '.x { display: grid; column-gap: 8px; }\n');
    const cssMulticolumn = runScan(root);
    t.ok(!cssMulticolumn.ok && cssMulticolumn.output.includes('CSS multicolumn property'), 'CSS multicolumn properties are rejected');

    fs.writeFileSync(path.join(root, 'styles.css'), '.x { color: red; }\n');
    fs.writeFileSync(path.join(root, 'src/clean.ts'), 'export type Bad = unknown | string;\n');
    const topType = runScan(root);
    t.ok(!topType.ok && topType.output.includes('union with top type'), 'top-type union is rejected');

    fs.writeFileSync(path.join(root, 'src/clean.ts'), 'window.setTimeout("alert(1)", 1);\n');
    const stringTimer = runScan(root);
    t.ok(!stringTimer.ok && stringTimer.output.includes('string timer execution marker'), 'string timer execution is rejected');

    fs.writeFileSync(path.join(root, 'src/clean.ts'), 'import * as fs from "fs";\nexport const exists = fs.existsSync("x");\n');
    const sourceFs = runScan(root);
    t.ok(!sourceFs.ok && sourceFs.output.includes('Node filesystem source marker'), 'source filesystem import is rejected');

    fs.writeFileSync(path.join(root, 'src/clean.ts'), 'import { spawn } from "child_process";\nexport const run = spawn;\n');
    const sourceChildProcess = runScan(root);
    t.ok(!sourceChildProcess.ok && sourceChildProcess.output.includes('Node child_process source marker'), 'source child_process import is rejected');

    fs.writeFileSync(path.join(root, 'src/clean.ts'), 'import * as os from "os";\nexport const host = os.hostname();\n');
    const sourceOs = runScan(root);
    t.ok(!sourceOs.ok && sourceOs.output.includes('Node os/system identity source marker'), 'source system identity import is rejected');

    fs.writeFileSync(path.join(root, 'src/clean.ts'), 'export const home = process.env.HOME;\n');
    const sourceProcessEnv = runScan(root);
    t.ok(!sourceProcessEnv.ok && sourceProcessEnv.output.includes('process.env source marker'), 'source process.env access is rejected');

    fs.writeFileSync(path.join(root, 'src/clean.ts'), 'export function all(app) { return app.vault.getMarkdownFiles(); }\n');
    const sourceVaultEnumeration = runScan(root);
    t.ok(!sourceVaultEnumeration.ok && sourceVaultEnumeration.output.includes('vault enumeration source marker'), 'source vault enumeration is rejected');

    fs.writeFileSync(path.join(root, 'src/clean.ts'), 'export function run(app, id) { return app.commands.executeCommandById(id); }\n');
    const sourceCommandDispatch = runScan(root);
    t.ok(!sourceCommandDispatch.ok && sourceCommandDispatch.output.includes('command dispatch source marker'), 'source command dispatch is rejected');

    fs.writeFileSync(path.join(root, 'src/clean.ts'), 'export type Clean = { value: string };\n');
    fs.writeFileSync(path.join(root, 'main.js'), 'navigator.clipboard.readText();\n');
    const clipboard = runScan(root);
    t.ok(!clipboard.ok && clipboard.output.includes('clipboard access marker'), 'bundle clipboard access is rejected');

    fs.writeFileSync(path.join(root, 'main.js'), 'require("fs");\n');
    const fsRequire = runScan(root);
    t.ok(!fsRequire.ok && fsRequire.output.includes('Node filesystem require marker'), 'bundle filesystem require is rejected');

    fs.writeFileSync(path.join(root, 'main.js'), 'require("child_process");\n');
    const childProcess = runScan(root);
    t.ok(!childProcess.ok && childProcess.output.includes('Node child_process require marker'), 'bundle child_process require is rejected');

    fs.writeFileSync(path.join(root, 'main.js'), 'console.log(process.env.HOME);\n');
    const processEnv = runScan(root);
    t.ok(!processEnv.ok && processEnv.output.includes('process.env marker'), 'bundle process.env access is rejected');

    fs.writeFileSync(path.join(root, 'main.js'), 'app.vault.getMarkdownFiles();\n');
    const vaultEnumeration = runScan(root);
    t.ok(!vaultEnumeration.ok && vaultEnumeration.output.includes('vault enumeration marker'), 'bundle vault enumeration is rejected');

    fs.writeFileSync(path.join(root, 'main.js'), 'app.commands.executeCommandById("x");\n');
    const commandDispatch = runScan(root);
    t.ok(!commandDispatch.ok && commandDispatch.output.includes('command dispatch marker'), 'bundle command dispatch is rejected');

    fs.writeFileSync(path.join(root, 'main.js'), 'console.log("ok");\n//# sourceMappingURL=main.js.map\n');
    const sourceMap = runScan(root);
    t.ok(!sourceMap.ok && sourceMap.output.includes('source map marker'), 'bundle sourcemap marker is rejected');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};
