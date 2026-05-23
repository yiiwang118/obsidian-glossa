<!-- Thanks for the PR! Please fill in the sections that apply. -->

## Summary

<!-- One-paragraph "what & why". Link the issue if there is one. -->

## Type

- [ ] Bug fix (non-breaking)
- [ ] New feature
- [ ] Breaking change (config / saved-data migration)
- [ ] Refactor / cleanup
- [ ] Docs / tests only

## Checklist

- [ ] `npm test` passes locally
- [ ] `npm run typecheck` passes
- [ ] `npm run build` produces a working `main.js`
- [ ] Added or updated tests in `tests/` (A/B/C/D/E/F/G as appropriate)
- [ ] No `console.log` / `console.error` left in production paths
- [ ] If UI changed: screenshot or GIF in the PR description
- [ ] If new tool added: registered in `src/agent/tools.ts`, has `assertVaultPath` guard for any path arg, has an entry in `tests/A_unit/` or `tests/E_security/`
- [ ] If `manifest.json.version` changed: `versions.json` updated too
- [ ] If config schema changed: added a migration in `src/main.ts:onload`

## Screenshots / before-after

<!-- For UI-visible changes. Drop GIFs or PNGs here. -->

## Notes for the reviewer

<!-- Anything subtle, follow-up work, known-unknowns. Keep it short. -->
