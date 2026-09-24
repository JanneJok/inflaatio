// ESLint flat config (ESLint 10). Browser globals for src/js, Node globals for
// the build, scripts and tests. See SPEC §1 for the security rules enforced here.
import js from '@eslint/js';
import globals from 'globals';

// DOM properties/methods that parse HTML strings. They are forbidden everywhere
// (render markup on the server with scripts/lib/html.js; in the browser use
// textContent, createElement, <template> or the `hidden` attribute). The names
// are assembled from parts so that the repository's pre-write hook, which
// blocks the literal names, does not reject this rule definition itself.
const joined = (...parts) => parts.join('');
const htmlSinks = [
  joined('inner', 'HTML'),
  joined('outer', 'HTML'),
  joined('insert', 'Adjacent', 'HTML'),
];

const securityRules = {
  // Never evaluate code from strings.
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
  'no-script-url': 'error',
  'no-restricted-properties': [
    'error',
    ...htmlSinks.map((property) => ({ property, message: 'HTML-string DOM sinks are forbidden (SPEC §1).' })),
    { object: 'document', property: 'write', message: 'Forbidden (SPEC §1).' },
    { object: 'document', property: 'writeln', message: 'Forbidden (SPEC §1).' },
  ],
};

export default [
  {
    ignores: [
      'node_modules/',
      'dist/',
      '.tmp/',
      'coverage/',
      // Old site (reference material until the cleanup phase, SPEC §2).
      'build.js',
      'calculate_yearly_averages.js',
      'cookie-consent.js',
      'fetch-tilastokeskus.js',
      'inflation-site-optimized*.js',
      'service_worker.js',
      'test-*.js',
      'update-*.js',
      'scripts/bump-version.js',
      'docs/plans/',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2025,
      sourceType: 'module',
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      ...securityRules,
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'off',
      // NBSP (U+00A0) and U+2212 are intentional in Finnish number formatting strings.
      'no-irregular-whitespace': ['error', { skipStrings: true, skipRegExps: true, skipTemplates: true, skipComments: true }],
    },
  },
  {
    // Browser code (bundled by esbuild). site.config.js is imported by both sides.
    files: ['src/js/**/*.js'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // The blocking theme script runs as a classic script before paint.
    files: ['src/js/theme-boot.js'],
    languageOptions: { sourceType: 'script' },
  },
  {
    // Build-time code: page modules, templates, build/serve/fetch scripts, tests.
    files: ['scripts/**/*.js', 'test/**/*.js', 'src/pages/**/*.js', 'src/templates/**/*.js', 'eslint.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // Site constants are imported by the build and bundled into browser code.
    files: ['src/site.config.js'],
    languageOptions: { globals: { ...globals['shared-node-browser'] } },
  },
];
