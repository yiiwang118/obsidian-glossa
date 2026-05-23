import { TFile } from 'obsidian';
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
    description: 'Read an image file from the vault (png/jpeg/gif/webp) and return its visual content to you as an image block. Use this when you need to actually SEE the image to answer the user. For Obsidian markdown images and attachments stored as files. Path is vault-relative.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Vault-relative path to an image file.' } },
      required: ['path'],
    },
  },
  run: async (app, { path }): Promise<ToolRunResult> => {
    if (typeof path !== 'string' || !path) return { text: 'Error: path is required.' };
    // Same path-traversal guard every other vault tool already uses. Without
    // this, the model could pass "../etc/passwd" or "/var/log/..." and we'd
    // happily try to read it — Obsidian's getAbstractFileByPath does not
    // refuse `..`-bearing paths on its own.
    let safe: string;
    try { safe = assertVaultPath(path, 'path'); }
    catch (e: any) { return { text: `Error: ${e.message}` }; }
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
      const u8 = new Uint8Array(bin);
      let s = '';
      const CHUNK = 0x8000;
      for (let i = 0; i < u8.length; i += CHUNK) {
        s += String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + CHUNK)) as any);
      }
      const data = btoa(s);
      if (data.length > 6_500_000) {
        return { text: `Error: image "${path}" is ${(data.length / 1024 / 1024).toFixed(1)} MB after base64 encoding — exceeds Anthropic's ~5 MB limit. Resize or compress first.` };
      }
      return {
        text: `Loaded image ${path} (${mime}, ${(bin.byteLength / 1024).toFixed(1)} KB).`,
        contentBlocks: [{ type: 'image', source: { type: 'base64', media_type: mime, data } }],
      };
    } catch (e: any) {
      return { text: `Error reading image: ${e.message ?? e}` };
    }
  },
});
