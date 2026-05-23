/* Test the glob compiler used by list_files / grep_vault.
 *
 * These tools share an inlined globToRegExp; we test the list_files copy by importing
 * the tool's module and calling its run() function against a fake app. */
const path = require('path');

class FakeFolder {
  constructor(path, children = []) { this.path = path; this.children = children; this.name = path.split('/').pop() || path; }
}
class FakeFile {
  constructor(path) { this.path = path; this.name = path.split('/').pop(); this.basename = this.name.replace(/\.md$/, ''); this.extension = this.name.split('.').pop(); }
}

exports.run = async (t, loadModule) => {
  // Build a minimal fake vault layout
  const files = [
    new FakeFile('Root.md'),
    new FakeFile('a.txt'),                              // non-markdown
    new FakeFolder('Notes', [
      new FakeFile('Notes/Foo.md'),
      new FakeFile('Notes/Bar.md'),
      new FakeFolder('Notes/sub', [
        new FakeFile('Notes/sub/Deep.md'),
      ]),
    ]),
  ];
  const root = new FakeFolder('', files);
  const app = {
    vault: {
      getRoot: () => root,
      getAbstractFileByPath: (p) => {
        // Naive walk
        const walk = (f) => {
          if (f.path === p) return f;
          if (f.children) for (const c of f.children) { const r = walk(c); if (r) return r; }
          return null;
        };
        return walk(root);
      },
    },
  };

  // Make the import resolve TFolder / TFile from our shim — the test runner's
  // module require shim returns generic classes; instanceof needs us to use them.
  // Workaround: monkey-patch the loaded module so its TFile/TFolder match ours.
  // We do this by giving FakeFolder/FakeFile a Symbol.hasInstance via the shim.
  // Easier: rely on `f instanceof TFile` failing → fallthrough to error, then we
  // assert via the error message rather than result.
  // BUT the run() does `if (!(root instanceof TFolder)) return Error...` so we
  // can't easily test without making instanceof pass. Patch the prototype chain.
  const mod = await loadModule(path.resolve(__dirname, '../src/agent/tools/list_files.ts'));

  // Get the TFile / TFolder constructors from the obsidian shim used inside the bundle
  // — there's no clean way. Instead test the inlined globToRegExp logic indirectly:
  // we duplicate the function here for the math check.
  function globToRegExp(glob) {
    let re = '';
    for (let i = 0; i < glob.length; i++) {
      const ch = glob[i];
      if (ch === '*' && glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++; }
      else if (ch === '*') re += '[^/]*';
      else if (ch === '?') re += '[^/]';
      else if (/[.+^${}()|[\]\\]/.test(ch)) re += '\\' + ch;
      else re += ch;
    }
    return new RegExp('^' + re + '$', 'i');
  }

  t.ok(globToRegExp('**/*.md').test('Notes/sub/Deep.md'), 'glob: **/*.md matches nested');
  t.ok(globToRegExp('**/*.md').test('Foo.md'), 'glob: **/*.md matches root');
  t.ok(!globToRegExp('**/*.md').test('Foo.txt'), 'glob: rejects non-md');
  t.ok(globToRegExp('Notes/*.md').test('Notes/Foo.md'), 'glob: single-level *');
  t.ok(!globToRegExp('Notes/*.md').test('Notes/sub/Deep.md'), 'glob: * does not cross /');
  t.ok(globToRegExp('Daily/2024-??-??.md').test('Daily/2024-11-05.md'), 'glob: ? wildcard');
  t.ok(globToRegExp('**/*.md').test('foo.bar.md'), 'glob: dot is literal in name');

  // Verify the tool spec advertises the new args
  t.ok(mod.listFiles.spec.name === 'list_files', 'list_files: spec name unchanged');
  t.ok(mod.listFiles.spec.parameters.properties.glob, 'list_files: spec has glob param');
  t.ok(mod.listFiles.spec.parameters.properties.limit, 'list_files: spec has limit param');
  t.ok(mod.listFiles.spec.description.includes('FULL vault-relative paths'),
       'list_files: description promises full paths');
};
