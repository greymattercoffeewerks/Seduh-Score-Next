import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';
import seduhNext from './eslint-rules/index.js';

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'eslint-rules/**',
      // The config wires up 'seduh-next/no-trio-vocabulary' by name, which
      // trips its own rule (\btrio\b matches inside the kebab-case id).
      'eslint.config.js',
      'supabase/.branches/**',
      'supabase/.temp/**',
      'test-results/**',
      'playwright-report/**',
      // Agent worktrees (Agent tool, isolation:"worktree") are checked-out repo
      // copies, not this project's own source — a cleanup that fails to fully
      // remove one (e.g. a Windows file-lock) should never be able to break
      // lint here.
      '.claude/worktrees/**',
    ],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node, ...globals.es2021 },
    },
    plugins: { 'seduh-next': seduhNext },
    rules: {
      'seduh-next/no-trio-vocabulary': 'error',
      'seduh-next/no-derived-storage': 'error',
      'seduh-next/no-core-format-import': 'error',
      'seduh-next/no-raw-elapsed-write': 'error',
    },
  },
  {
    // Legitimate exemption (handoff §10): this file's fixtures describe mock
    // ct_heat_entries *rows* the fake Supabase client hands back — data
    // shape, not a real write path. The module under test (timing.js) still
    // has full rule coverage; only its test's own fixture literals are
    // exempt.
    files: ['src/formats/cup-taster/timing.test.js', 'src/formats/cup-taster/timingScreen.test.js'],
    rules: {
      'seduh-next/no-raw-elapsed-write': 'off',
    },
  },
  prettier,
];
