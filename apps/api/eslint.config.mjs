import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.node,
      parserOptions: {
        // Lint con información de tipos: habilita reglas como
        // no-floating-promises. projectService arma el programa de TS solo.
        // allowDefaultProject cubre los config sueltos que no están en el
        // tsconfig (include: ["src"]) sin tener que meterlos al build.
        projectService: {
          allowDefaultProject: [
            'vitest.config.ts',
            'prisma/seed.ts',
            'scripts/create-admin.ts',
          ],
        },
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
  {
    // supertest tipa `res.body` como `any`; assertear sobre él dispara la
    // familia no-unsafe-* sin que haya inseguridad real. Se relaja SOLO acá.
    // El resto de las reglas type-checked (no-floating-promises, etc.) siguen
    // activas también en tests: una promesa flotante en un test igual es un bug.
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
])
