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
      // Sigue siendo "error" para que el pre-push lo atrape; en el editor se ve
      // amarillo vía eslint.rules.customizations (.vscode/settings.json).
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // La base de datos se toca SOLO desde src/repositories.
    //
    // Las rutas y middlewares reciben un TenantContext y se lo pasan a un
    // repositorio; el cliente Prisma (y el guard de tenant que lo envuelve)
    // no deben cruzar esa frontera. Sin esta regla la separación se erosiona
    // sola: alcanza un `import { prisma }` en una ruta nueva para volver a
    // tener queries sin scopear repartidas por la capa HTTP.
    //
    // Excluidos: los propios repositorios, y lib/ (prisma.ts define el
    // cliente; tenantScope.ts lo envuelve). tests/, prisma/seed.ts y
    // scripts/ quedan fuera por no matchear el `files` de abajo: usan prisma
    // legítimamente para fixtures, limpieza y semillas.
    files: ['src/**/*.ts'],
    ignores: ['src/repositories/**', 'src/lib/prisma.ts', 'src/lib/tenantScope.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/lib/prisma'],
              // pingDatabase es la excepción: el /health pregunta si la DB
              // responde, que es infra, no acceso a datos de dominio. El
              // cliente `prisma` en sí sigue prohibido.
              allowImportNames: ['pingDatabase'],
              message:
                'La base de datos se toca solo desde src/repositories. Usá (o creá) un repositorio y pasale el TenantContext.',
            },
            {
              group: ['**/lib/tenantScope'],
              message:
                'El guard de tenant es un detalle de la capa de persistencia: usalo desde un repositorio en src/repositories, no desde una ruta.',
            },
            {
              group: ['@prisma/client'],
              importNames: ['PrismaClient'],
              message:
                'No instancies PrismaClient fuera de src/lib/prisma.ts. Los tipos y enums de @prisma/client sí se pueden importar.',
            },
          ],
        },
      ],
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
