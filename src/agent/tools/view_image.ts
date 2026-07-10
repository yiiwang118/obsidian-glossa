/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- Dynamic plugin and host-app boundaries validate these values at runtime. */
import { TFile } from 'obsidian';
import { formatImageInspectionMarkdown } from '../../utils/image';
import { inspectVaultImageCached } from '../../utils/media_cache';
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
    description: 'Inspect one vault image as visual model input. Choose describe, ocr, ui, chart, detail, or color according to the question. Start with the full image when layout matters; use a source-pixel region for small details and sample_points only for exact colors.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Vault-relative path to an image file.' },
        mode: { type: 'string', enum: ['auto', 'describe', 'ocr', 'ui', 'chart', 'detail', 'color'], description: 'Inspection intent. Default auto.' },
        region: {
          type: 'object',
          description: 'Optional crop rectangle in source image pixels. Use for small text, crowded UI, chart details, or local visual defects.',
          properties: {
            x: { type: 'number', minimum: 0, description: 'Left coordinate in source pixels.' },
            y: { type: 'number', minimum: 0, description: 'Top coordinate in source pixels.' },
            width: { type: 'number', minimum: 1, description: 'Crop width in source pixels.' },
            height: { type: 'number', minimum: 1, description: 'Crop height in source pixels.' },
          },
          required: ['x', 'y', 'width', 'height'],
          additionalProperties: false,
        },
        sample_points: {
          type: 'array',
          maxItems: 32,
          description: 'Optional pixel points in source image coordinates for exact color checks.',
          items: {
            type: 'object',
            properties: {
              x: { type: 'number', minimum: 0, description: 'Horizontal source-pixel coordinate.' },
              y: { type: 'number', minimum: 0, description: 'Vertical source-pixel coordinate.' },
              label: { type: 'string', description: 'Optional human-readable name for this sample.' },
            },
            required: ['x', 'y'],
            additionalProperties: false,
          },
        },
      },
      required: ['path'],
      additionalProperties: false,
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
      const { value: inspection } = await inspectVaultImageCached(app, f, mime, {
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
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- Re-enable review lint rules after dynamic boundary module. */
