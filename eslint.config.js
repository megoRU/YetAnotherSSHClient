import js from '@eslint/js'
import globals from 'globals'
import svelte from 'eslint-plugin-svelte'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'release', 'src-tauri/target']),
  {
    files: ['**/*.{ts,svelte}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { globals: globals.browser },
  },
  ...svelte.configs.recommended,
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    rules: {
      // Существующие Map и Set хранят служебные данные. Состояние для UI публикуется отдельно.
      'svelte/prefer-svelte-reactivity': 'off',
    },
    languageOptions: {
      parserOptions: { parser: tseslint.parser },
    },
  },
])
