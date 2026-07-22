import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.node,
      parserOptions: {
        // Monorepo: fija la raíz a esta carpeta para que el ESLint del IDE
        // (que corre desde el root) no dude entre apps/api y apps/web.
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Convención del repo: parámetros no usados prefijados con "_" no son error
      // (ej. el "next" que Express exige para reconocer un error handler).
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
])
