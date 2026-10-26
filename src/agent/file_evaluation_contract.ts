export interface FileExample {
  name: string;
  request: string;
  files: Record<string, string>;
  /** Exact final contents; null means the path must no longer exist. Unlisted files must stay unchanged. */
  expectedFiles: Record<string, string | null>;
  repeat?: boolean;
}

export function fixturePath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 160 || !value.endsWith('.md') || /[\\:*?"<>|]/.test(value) || [...value].some(char => char.charCodeAt(0) < 32)
    || value.split('/').some(part => !part || part.startsWith('.') || part.trim() !== part || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(part))) {
    throw new Error('Use a relative Markdown fixture path without hidden, reserved, or parent directories.');
  }
  return value;
}

export function parseFileExamples(value: unknown): FileExample[] {
  if (!Array.isArray(value) || value.length > 5) throw new Error('Use up to five file examples.');
  const names = new Set<string>();
  const examples = value.map(raw => {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid file example.');
    const item = raw as Record<string, unknown>;
    if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 100 || names.has(item.name)) throw new Error('File example names must be unique.');
    names.add(item.name);
    if (typeof item.request !== 'string' || !item.request.trim() || item.request.length > 4000) throw new Error('File example needs a task (up to 4000 characters).');
    const readFiles = (value: unknown, nullable: boolean): Record<string, string | null> => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a fixture path-to-text object.');
      const entries = Object.entries(value);
      if (!entries.length || entries.length > 8) throw new Error('Use 1–8 fixture files.');
      const paths = new Set<string>();
      let size = 0;
      for (const [path, text] of entries) {
        fixturePath(path);
        if (paths.has(path.toLowerCase())) throw new Error('Fixture paths must be unique regardless of letter case.');
        paths.add(path.toLowerCase());
        if (nullable && text === null) continue;
        if (typeof text !== 'string' || text.length > 12000) throw new Error('Fixture text must be at most 12000 characters.');
        size += text.length;
      }
      if (size > 24000) throw new Error('Fixture contents exceed 24000 characters.');
      return Object.fromEntries(entries);
    };
    return { name: item.name, request: item.request, files: readFiles(item.files, false),
      expectedFiles: readFiles(item.expectedFiles, true), repeat: item.repeat === true };
  });
  if (JSON.stringify(examples).length > 80000) throw new Error('File examples exceed the 80000-character limit.');
  for (const example of examples) {
    const paths = [...new Set([...Object.keys(example.files), ...Object.keys(example.expectedFiles)])].sort();
    const lower = paths.map(path => path.toLowerCase());
    if (new Set(lower).size !== paths.length || lower.some(path => lower.some(other => other.startsWith(path + '/')))) {
      throw new Error('Fixture paths have conflicting case or file/directory names.');
    }
  }
  return examples;
}
