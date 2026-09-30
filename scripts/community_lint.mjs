import { ESLint } from 'eslint';
import obsidianmd from 'eslint-plugin-obsidianmd';

// Independent of eslint.config.mjs and its local boundary exceptions.
// Public scanner configuration:
// https://github.com/obsidianmd/eslint-plugin/blob/master/docs/configuration.md#community-plugin-scanner-configuration
const securityRules = new Set([
  'no-eval', 'no-implied-eval', 'no-unsanitized/method',
  'no-unsanitized/property', 'obsidianmd/regex-lookbehind', 'obsidianmd/no-forbidden-elements',
]);
const skippedRules = [
  'no-undef', '@typescript-eslint/no-unsafe-member-access', '@typescript-eslint/no-unsafe-assignment',
  '@typescript-eslint/no-unsafe-argument', '@typescript-eslint/no-unsafe-call', '@typescript-eslint/no-unsafe-return',
  '@typescript-eslint/restrict-template-expressions', '@typescript-eslint/no-base-to-string', 'import/no-unresolved',
  'obsidianmd/validate-manifest', 'obsidianmd/validate-license',
  'obsidianmd/commands/no-command-in-command-id', 'obsidianmd/commands/no-plugin-id-in-command-id',
];
const recommended = obsidianmd.configs.recommended.map(config => ({
  ...config,
  ...(config.rules ? { rules: Object.fromEntries(Object.entries(config.rules).map(([name, value]) => {
    const options = Array.isArray(value) ? [...value] : [value];
    if (options[0] !== 'off' && options[0] !== 0 && !securityRules.has(name)) options[0] = 'warn';
    return [name, options];
  })) } : {}),
}));
const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: [
    { languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: process.cwd() } } },
    ...recommended,
    {
      files: ['**/*.{ts,tsx,js,jsx}'],
      rules: {
        ...Object.fromEntries([...securityRules].map(rule => [rule, 'error'])),
        ...Object.fromEntries(skippedRules.map(rule => [rule, 'off'])),
      },
    },
  ],
});
// Manifest and release assets have separate validation in release_check.cjs.
// All runtime source is in src; test/build scripts follow the scanner's exclusions.
const results = await eslint.lintFiles(['src/**/*.ts', 'package.json']);
const errors = results.reduce((sum, file) => sum + file.errorCount, 0);
const warnings = results.reduce((sum, file) => sum + file.warningCount, 0);
const formatted = (await eslint.loadFormatter('stylish')).format(results);
if (formatted) console.error(formatted);
console.log(`Community lint: ${errors} errors, ${warnings} warnings (${results.length} files).`);
if (errors || warnings) process.exitCode = 1;
