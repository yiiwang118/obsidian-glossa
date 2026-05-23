/**
 * templater_render — bridge to the Templater plugin.
 *
 * Two modes:
 *   to_file        — render template into a NEW file at `target_path`.
 *                    Fails if target exists (so we don\'t silently overwrite).
 *   to_string      — render template and return the result as a string,
 *                    without writing to vault. The model can then decide
 *                    where the rendered text goes (e.g. inject via
 *                    patch_note).
 *
 * Requires the user-approved templater context for `tp.file.*` accessors
 * to work; for `to_string`, we use Templater\'s `parseTemplate` against a
 * temporary in-memory frame.
 */
import { TFile } from 'obsidian';
import { assertVaultPath, buildTool, normalizePathFields, type ToolImpl } from './_shared';

function getTemplater(app: any): any | null {
  return app?.plugins?.plugins?.['templater-obsidian']?.templater ?? null;
}

export const templaterRender: ToolImpl = buildTool({
  isReadOnly: a => a?.mode === 'to_string',
  isConcurrencySafe: () => false,
  isDestructive: a => a?.mode !== 'to_string',
  searchHint: 'render templater template to file or string',
  backfillObservableInput: normalizePathFields(['template_path', 'target_path']),
  describe: a => `templater ${a.mode ?? 'to_file'}: ${a.template_path}`,
  spec: {
    name: 'templater_render',
    description: [
      'Render a Templater template. Requires the Templater plugin to be installed and enabled.',
      '',
      'Modes:',
      '  to_file    — render template into target_path (new file). Fails if target exists.',
      '  to_string  — render template and return the result as a string, no vault write.',
      '',
      'Templater syntax is preserved: <% tp.date.now("YYYY-MM-DD") %>, <% tp.file.title %>, etc.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['to_file', 'to_string'] },
        template_path: { type: 'string', description: 'Vault-relative path to the .md template.' },
        target_path: { type: 'string', description: 'Required for mode=to_file. Vault-relative path of the new file.' },
      },
      required: ['mode', 'template_path'],
    },
  },
  preview: async (a) => `Templater ${a.mode}\n  template: ${a.template_path}\n  ${a.mode === 'to_file' ? `target:   ${a.target_path}` : '(no write — string output)'}`,
  run: async (app, args, ctx) => {
    if (ctx?.signal?.aborted) return 'Error: cancelled before start.';
    const t = getTemplater(app);
    if (!t) return 'Error: Templater plugin not installed or not enabled.';
    const mode = args.mode as 'to_file' | 'to_string';
    let templatePath: string;
    try { templatePath = assertVaultPath(args.template_path, 'template_path'); }
    catch (e: any) { return `Error: ${e.message}`; }
    const tplFile = app.vault.getAbstractFileByPath(templatePath);
    if (!(tplFile instanceof TFile)) return `Error: template not found: ${templatePath}`;

    if (mode === 'to_file') {
      let targetPath: string;
      try { targetPath = assertVaultPath(args.target_path ?? '', 'target_path'); }
      catch (e: any) { return `Error: ${e.message}`; }
      if (app.vault.getAbstractFileByPath(targetPath)) return `Error: target already exists: ${targetPath}`;
      try {
        // Use Templater\'s "create new note from template" path so all tp.* accessors
        // resolve relative to the new file. API surface has shifted between versions;
        // probe for the right entry point.
        if (typeof t.create_new_note_from_template === 'function') {
          const folder = targetPath.includes('/') ? targetPath.slice(0, targetPath.lastIndexOf('/')) : '';
          const fileName = (targetPath.split('/').pop() ?? '').replace(/\.md$/, '');
          await t.create_new_note_from_template(tplFile, folder || '/', fileName, true);
          return `Rendered ${templatePath} → ${targetPath}.`;
        }
        // Fallback: read template, parseTemplate, write directly. Loses some tp.* context
        // (tp.file.title may not resolve perfectly) but works on older Templater.
        const raw = await app.vault.read(tplFile);
        const rendered = await t.parseTemplate?.(raw, tplFile) ?? raw;
        const folder = targetPath.includes('/') ? targetPath.slice(0, targetPath.lastIndexOf('/')) : '';
        if (folder) try { await app.vault.createFolder(folder); } catch {}
        await app.vault.create(targetPath, rendered);
        return `Rendered ${templatePath} → ${targetPath} (fallback path).`;
      } catch (e: any) {
        return `Templater error: ${e?.message ?? e}`;
      }
    }

    // to_string
    try {
      const raw = await app.vault.read(tplFile);
      // Templater 2.x: parseTemplate(content, tFile?). Some versions: parser.parseTemplate.
      const parser = t.parser ?? t;
      const rendered = await (parser.parseTemplate?.(raw, tplFile) ?? raw);
      return rendered;
    } catch (e: any) {
      return `Templater error: ${e?.message ?? e}`;
    }
  },
});
