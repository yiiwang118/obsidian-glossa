# Contributing to Glossa

Thanks for your interest. Issues, PRs, and Discussions are all welcome.

## Dev loop

```bash
git clone https://github.com/yiiwang118/obsidian-glossa.git
cd obsidian-glossa
npm install
npm run dev        # rebuilds main.js on save into the repo root
```

To test against a real vault, symlink the built artifacts into a test vault's plugins folder:

```bash
# example for macOS — adjust paths
ln -sf "$(pwd)/main.js"       "/path/to/your-vault/.obsidian/plugins/glossa/main.js"
ln -sf "$(pwd)/manifest.json" "/path/to/your-vault/.obsidian/plugins/glossa/manifest.json"
ln -sf "$(pwd)/styles.css"    "/path/to/your-vault/.obsidian/plugins/glossa/styles.css"
```

Then in the host app: Settings → Community plugins → reload (or use the [hot-reload helper](https://github.com/pjeby/hot-reload) for in-place refresh).

## Before opening a PR

- [ ] `npm test` clean (60 in-tree + 1181 stress-suite assertions)
- [ ] `npm run typecheck` clean
- [ ] `npm run build` succeeds
- [ ] No `console.log` / `console.error` left in production code paths (devtools-only is OK with a `// debug` comment)
- [ ] If touching a tool: assertion in `tests/A_unit/` or `tests/E_security/` covering the new behavior
- [ ] If touching UI: screenshot or short GIF in PR description
- [ ] If touching settings schema: migration in `src/main.ts:onload` + bump `manifest.json` minor version

## Code style

- TypeScript strict-null is OFF intentionally — we accept `any` at the edges (provider parsing, MCP) and tighten in `src/types.ts` instead.
- No comments that restate the code. Only comment WHY when the answer isn't obvious from the names.
- Prefer editing existing files over creating new ones.
- Tool implementations live in `src/agent/tools/<name>.ts`, one file per tool, exported via `src/agent/tools.ts`.

## Adding a new tool

1. Create `src/agent/tools/your_tool.ts` using `buildTool({...})` from `_shared.ts`
2. If it takes a path arg, MUST call `assertVaultPath(args.path)` at the top of `run`
3. Set `isReadOnly` / `isDestructive` / `isConcurrencySafe` honestly — fail-closed defaults assume the worst
4. Register in `src/agent/tools.ts:TOOLS`
5. Add an entry to `pathsTouchedByTool` in `src/agent/checkpoint.ts` if it mutates files
6. Add an entry to `tests/E_security/E2_path_traversal.test.cjs`'s `TOOL_PATHS` if it takes a path
7. If the tool is rarely needed (plugin bridge, legacy), set `shouldDefer: true` so it's hidden from the default tool surface and only reachable via `tool_search`

## Adding a provider

1. Create `src/providers/your_provider.ts` implementing the `LLMProvider` interface
2. Register in `src/providers/registry.ts:buildProvider`
3. Add a settings UI section in `src/settings.ts:renderEndpointCard` for any kind-specific fields
4. Add provider-parser tests in `tests/C_provider/` — at minimum: streaming basic / tool calls / errors

## Testing layers

| When | Run |
|---|---|
| Quick feedback during dev | `npm test` (A B C E, ~5s) |
| Full coverage | `npm run test:all` (A-G, ~10s + Puppeteer launch) |
| Adding a new vault tool | `node tests/run.cjs E_security/E2_path_traversal.test.cjs` |
| Adding a new provider | `node tests/run.cjs C` |

## Release process (maintainer)

1. Edit `manifest.json`, `package.json`, `versions.json` — bump version (no `v` prefix per Obsidian spec)
2. Update `CHANGELOG.md` with the new section
3. `git commit -am "release 0.X.Y" && git tag 0.X.Y && git push --tags`
4. GitHub Action auto-builds and creates a release with `main.js / manifest.json / styles.css` attached
5. For first community-plugin submission only: open PR to [obsidianmd/obsidian-releases](https://github.com/obsidianmd/obsidian-releases)
