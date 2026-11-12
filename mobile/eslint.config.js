// Expo's recommended ESLint flat config for SDK 58. Run with `npm run lint` (expo lint).
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'node_modules/*', '.expo/*', 'public/sw.js'],
  },
  {
    rules: {
      // Guards against stray characters in HTML markup; apostrophes in React Native <Text> are fine.
      'react/no-unescaped-entities': 'off',
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      // TypeScript already checks imported names (and resolves `export *` chains, e.g.
      // Notifications.AndroidImportance, which this rule misreports). typescript-eslint
      // recommends turning it off for TypeScript projects.
      'import/namespace': 'off',
    },
  },
]);
