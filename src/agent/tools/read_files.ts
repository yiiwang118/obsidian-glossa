import { TFile } from 'obsidian';
import { formatNoteRead, type NoteReadOptions } from '../../utils/note_read';
import { assertVaultPath, buildTool, type ToolImpl } from './_shared';

const MAX_FILES = 8;
const MAX_BATCH_CHARS = 80_000;
const BATCH_LIMITS = { maxChars: 20_000, maxLines: 2_000, defaultRangeLines: 200 };
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif']);

interface ReadRequest extends NoteReadOptions {
  path: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function parseRequests(value: unknown): ReadRequest[] {
  if (!Array.isArray(value)) return [];
  return value.map(item => {
    const entry = asRecord(item);
    return {
      path: typeof entry.path === 'string' ? entry.path : '',
      startLine: optionalNumber(entry.start_line),
      endLine: optionalNumber(entry.end_line),
      maxLines: optionalNumber(entry.max_lines),
    };
  });
}

export const readFiles: ToolImpl = buildTool({
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  isDestructive: () => false,
  shouldDefer: true,
  searchHint: 'batch read known vault files and line ranges',
  searchTags: ['multiple notes', 'parallel file read', '批量读取', '多文件', '分段读取'],
  maxResultSizeChars: Infinity,
  describe: args => `read ${parseRequests(asRecord(args).requests).length} files`,
  spec: {
    name: 'read_files',
    description: 'Read up to 8 explicitly known text files in one call, with an independent optional line range per file. Use instead of repeated read_note calls when paths are already known. Each file is capped at 20,000 characters and failures are isolated; use read_pdf or view_image for media.',
    parameters: {
      type: 'object',
      properties: {
        requests: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_FILES,
          description: 'Files and optional 1-based inclusive ranges to read in parallel.',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', minLength: 1, description: 'Explicit vault-relative file path.' },
              start_line: { type: 'integer', minimum: 1, description: 'Optional 1-based first line. Defaults to 1 when another range field is set.' },
              end_line: { type: 'integer', minimum: 1, description: 'Optional inclusive last line. Takes precedence over max_lines.' },
              max_lines: { type: 'integer', minimum: 1, maximum: 2_000, description: 'Lines to return when end_line is omitted. Default 200.' },
            },
            required: ['path'],
            additionalProperties: false,
          },
        },
      },
      required: ['requests'],
      additionalProperties: false,
    },
  },
  run: async (app, args) => {
    const requests = parseRequests(asRecord(args).requests);
    if (requests.length === 0 || requests.length > MAX_FILES) {
      return `Error: requests must contain 1-${MAX_FILES} files.`;
    }
    const unique = new Map<string, ReadRequest>();
    for (const request of requests) {
      try {
        const path = assertVaultPath(request.path);
        const key = JSON.stringify({ path, startLine: request.startLine, endLine: request.endLine, maxLines: request.maxLines });
        if (!unique.has(key)) unique.set(key, { ...request, path });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        unique.set(`invalid:${unique.size}`, { ...request, path: `Error: ${message}` });
      }
    }

    const sections = await Promise.all([...unique.values()].map(async request => {
      if (request.path.startsWith('Error: ')) return request.path;
      const file = app.vault.getAbstractFileByPath(request.path);
      if (!(file instanceof TFile)) return `Error: file not found: ${request.path}`;
      const extension = file.extension.toLowerCase();
      if (extension === 'pdf') return `Error: ${request.path}: use read_pdf for page-aware PDF extraction.`;
      if (IMAGE_EXTENSIONS.has(extension)) return `Error: ${request.path}: use view_image for visual inspection.`;
      try {
        const text = await app.vault.read(file);
        return formatNoteRead(request.path, text, request, BATCH_LIMITS);
      } catch (error) {
        return `Error: ${request.path}: ${error instanceof Error ? error.message : String(error)}`;
      }
    }));

    const out: string[] = [];
    let used = 0;
    for (const section of sections) {
      const separator = out.length > 0 ? '\n\n=====\n\n' : '';
      if (used + separator.length + section.length > MAX_BATCH_CHARS) {
        out.push(`\n\n[batch output capped at ${MAX_BATCH_CHARS.toLocaleString()} chars; narrow ranges for remaining files]`);
        break;
      }
      out.push(separator + section);
      used += separator.length + section.length;
    }
    return out.join('');
  },
});
