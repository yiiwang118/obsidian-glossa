/** Existing whole-file host/API boundary exceptions, moved from source comments.
 * Keep exact file/rule scopes: all other code retains the strict type checks.
 * The community scanner disables these rules itself; inline suppressions there
 * become unused-directive errors. No runtime source is changed by these overrides.
 */
export default [
  {
    files: [
      "src/agent/approval.ts",
      "src/agent/loop.ts",
      "src/agent/tools/apply_patch.ts",
      "src/agent/tools/download_file.ts",
      "src/agent/tools/edit_section.ts",
      "src/agent/tools/list_open_files.ts",
      "src/agent/tools/manage_tags.ts",
      "src/agent/tools/web_fetch.ts",
      "src/agent/tools/web_research.ts",
      "src/features/citation_hover.ts",
      "src/main.ts",
      "src/settings.ts",
      "src/utils/markdown.ts",
      "src/utils/pdf.ts",
      "src/utils/pdf_render.ts",
    ],
    rules: {
      "@typescript-eslint/no-unsafe-argument": 'off',
      "@typescript-eslint/no-unsafe-assignment": 'off',
      "@typescript-eslint/no-unsafe-call": 'off',
      "@typescript-eslint/no-unsafe-member-access": 'off',
    },
  },
  {
    files: [
      "src/agent/checkpoint.ts",
    ],
    rules: {
      "@typescript-eslint/no-unsafe-argument": 'off',
      "@typescript-eslint/no-unsafe-assignment": 'off',
      "@typescript-eslint/no-unsafe-member-access": 'off',
      "@typescript-eslint/no-unsafe-return": 'off',
    },
  },
  {
    files: [
      "src/agent/patch_envelope.ts",
      "src/agent/sub_agent.ts",
      "src/agent/tools/file_edit.ts",
      "src/agent/tools/get_periodic_note.ts",
      "src/agent/tools/read_canvas.ts",
      "src/agent/tools/read_pdf.ts",
      "src/agent/tools/todo_write.ts",
      "src/agent/tools/view_image.ts",
    ],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": 'off',
      "@typescript-eslint/no-unsafe-member-access": 'off',
    },
  },
  {
    files: [
      "src/agent/plugin_bridges.ts",
    ],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": 'off',
      "@typescript-eslint/no-unsafe-call": 'off',
      "@typescript-eslint/no-unsafe-member-access": 'off',
      "@typescript-eslint/no-unsafe-return": 'off',
    },
  },
  {
    files: [
      "src/agent/skills.ts",
    ],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": 'off',
    },
  },
  {
    files: [
      "src/agent/tool_meta.ts",
      "src/agent/tools/patch_note.ts",
      "src/agent/tools/web_search.ts",
      "src/providers/custom_api.ts",
      "src/ui/view.ts",
    ],
    rules: {
      "@typescript-eslint/no-unsafe-argument": 'off',
      "@typescript-eslint/no-unsafe-assignment": 'off',
      "@typescript-eslint/no-unsafe-call": 'off',
      "@typescript-eslint/no-unsafe-member-access": 'off',
      "@typescript-eslint/no-unsafe-return": 'off',
    },
  },
  {
    files: [
      "src/agent/tools/_shared.ts",
      "src/agent/tools/delete_note.ts",
      "src/agent/tools/get_outgoing_links.ts",
      "src/agent/tools/read_note.ts",
      "src/agent/tools/rename_note.ts",
      "src/agent/tools/run_skill.ts",
      "src/agent/tools/skill.ts",
      "src/agent/tools/templater_render.ts",
      "src/agent/tools/tool_search.ts",
      "src/chat_store.ts",
      "src/commands/inline_edit.ts",
      "src/providers/registry.ts",
      "src/ui/history_modal.ts",
      "src/utils/image.ts",
    ],
    rules: {
      "@typescript-eslint/no-unsafe-member-access": 'off',
    },
  },
  {
    files: [
      "src/agent/tools/append_to_note.ts",
      "src/agent/tools/create_note.ts",
      "src/agent/tools/list_files.ts",
      "src/agent/tools/patch_canvas.ts",
      "src/agent/tools/resolve_wikilink.ts",
      "src/agent/tools/write_note.ts",
      "src/context/sources.ts",
    ],
    rules: {
      "@typescript-eslint/no-unsafe-argument": 'off',
      "@typescript-eslint/no-unsafe-assignment": 'off',
      "@typescript-eslint/no-unsafe-member-access": 'off',
    },
  },
  {
    files: [
      "src/agent/tools/dataview_query.ts",
      "src/agent/tools/manage_frontmatter.ts",
      "src/agent/tools/open_in_editor.ts",
      "src/agent/tools/set_selection.ts",
      "src/citations/pdf_reference_index.ts",
      "src/utils/safe_write.ts",
    ],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": 'off',
      "@typescript-eslint/no-unsafe-call": 'off',
      "@typescript-eslint/no-unsafe-member-access": 'off',
    },
  },
  {
    files: [
      "src/agent/tools/get_backlinks.ts",
      "src/agent/tools/query_metadata.ts",
    ],
    rules: {
      "@typescript-eslint/no-unsafe-argument": 'off',
      "@typescript-eslint/no-unsafe-member-access": 'off',
    },
  },
  {
    files: [
      "src/agent/tools/tasks_query.ts",
      "src/ui/popup.ts",
    ],
    rules: {
      "@typescript-eslint/no-unsafe-call": 'off',
      "@typescript-eslint/no-unsafe-member-access": 'off',
    },
  },
  {
    files: [
      "src/agent/tools/web_common.ts",
    ],
    rules: {
      "@typescript-eslint/no-unsafe-member-access": 'off',
      "@typescript-eslint/no-unsafe-return": 'off',
    },
  },
  {
    files: [
      "src/commands/slash.ts",
    ],
    rules: {
      "@typescript-eslint/no-unsafe-return": 'off',
    },
  },
  {
    files: [
      "src/types.ts",
      "src/utils/web_content.ts",
    ],
    rules: {
      "@typescript-eslint/no-unsafe-argument": 'off',
    },
  },
  {
    files: [
      "src/utils/dom.ts",
    ],
    rules: {
      "@typescript-eslint/no-unsafe-argument": 'off',
      "@typescript-eslint/no-unsafe-member-access": 'off',
      "@typescript-eslint/no-unsafe-return": 'off',
    },
  },
];
