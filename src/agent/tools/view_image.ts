/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-duplicate-type-constituents, @typescript-eslint/only-throw-error, @typescript-eslint/no-unused-vars -- Dynamic plugin and host-app boundaries validate these values at runtime. */
import { TFile } from 'obsidian';
import { formatImageInspectionMarkdown, inspectImageArrayBuffer } from '../../utils/image';
import { assertVaultPath, buildTool, normalizePathFields, type ToolImpl, type ToolRunResult } from './_shared';

export const viewImage: ToolImpl = buildTool({
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  isDestructive: () => false,
  // Images are inherently large after base64 — bump the cap (read_note's
  // pattern of Infinity isn't appropriate since we don't self-cap binary data).
  maxResultSizeChars: 10_000_000,
  searchHint: 'load image file as multimodal block',
  describe: a => `view image ${a.path}`,
  backfillObservableInput: normalizePathFields(['path']),
  spec: {
    name: 'view_image',
    description: [
      'Read an image file from the vault (png/jpeg/gif/webp) and return its visual content to you as an image block.',
      'Use this when you need to actually SEE an image. Choose mode by task: describe for ordinary understanding, ocr for reading text, ui for screenshots/layout bugs, chart for plots/figures, detail for local crop/zoom, color for pixel checks.',
      'For precision, pass region {x,y,width,height} in source image pixels to crop before viewing. For exact colors, pass sample_points [{x,y,label?}].',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Vault-relative path to an image file.' },
        mode: { type: 'string', description: 'Optional mode: auto, describe, ocr, ui, chart, detail, or color.' },
        region: {
          type: 'object',
          description: 'Optional crop rectangle in source image pixels. Use for small text, crowded UI, chart details, or local visual defects.',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            width: { type: 'number' },
            height: { type: 'number' },
          },
        },
        sample_points: {
          type: 'array',
          description: 'Optional pixel points in source image coordinates for exact color checks.',
          items: {
            type: 'object',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              label: { type: 'string' },
            },
          },
        },
      },
      required: ['path'],
    },
  },
  run: async (app, args): Promise<ToolRunResult> => {
    const { path } = args;
    if (typeof path !== 'string' || !path) return { text: 'Error: path is required.' };
    // Same path-traversal guard every other vault tool already uses. Without
    // this, the model could pass "../etc/passwd" or "/var/log/..." and we'd
    // happily try to read it — Obsidian's getAbstractFileByPath does not
    // refuse `..`-bearing paths on its own.
    let safe: string;
    try { safe = assertVaultPath(path, 'path'); }
    catch (e) { return { text: `Error: ${e.message}` }; }
    const f = app.vault.getAbstractFileByPath(safe);
    if (!(f instanceof TFile)) return { text: `Error: image not found: ${safe}` };
    const extToMime: Record<string, string> = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      gif: 'image/gif', webp: 'image/webp',
    };
    const mime = extToMime[(f.extension || '').toLowerCase()];
    if (!mime) return { text: `Error: unsupported image type ".${f.extension}" — supported: png, jpg, jpeg, gif, webp.` };
    try {
      const bin = await app.vault.readBinary(f);
      const inspection = await inspectImageArrayBuffer(bin, mime, {
        mode: args.mode,
        region: args.region,
        samplePoints: args.sample_points,
      });
      if (inspection.image.data.length > 6_500_000) {
        return {
          text: [
            `Error: image "${path}" is ${(inspection.image.data.length / 1024 / 1024).toFixed(1)} MB after base64 encoding — exceeds provider image limits.`,
            inspection.width && inspection.height ? `Source dimensions: ${inspection.width} x ${inspection.height}px.` : '',
            'Retry with a smaller image, or pass region {x,y,width,height} to crop the relevant area first.',
          ].filter(Boolean).join('\n'),
        };
      }
      return {
        text: formatImageInspectionMarkdown(path, inspection),
        contentBlocks: [{ type: 'image', source: { type: 'base64', media_type: inspection.image.mime, data: inspection.image.data } }],
      };
    } catch (e) {
      return { text: `Error reading image: ${e.message ?? e}` };
    }
  },
});
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-duplicate-type-constituents, @typescript-eslint/only-throw-error, @typescript-eslint/no-unused-vars -- Re-enable review lint rules after dynamic boundary module. */
