# Ficha

Ficha clínica digital para consultorios de kinesiología orientados al método RPG
(Reeducación Postural Global). Pacientes, episodios clínicos, evaluación
postural inicial, sesiones con evolución del dolor, escalas funcionales,
consentimiento informado y cobros.

Multi-tenant: cada clínica ve solo sus datos, garantizado a nivel de fila.

## Estructura

Monorepo de npm workspaces.

| | |
|---|---|
| `apps/api` | Express 5 + Prisma + Postgres |
| `apps/web` | Vite + React 19 + Tailwind v4 + Base UI |
| `packages/shared` | Tipos y schemas de Zod compartidos (se buildea antes que las apps) |

## Arrancar

Hace falta Node 24 y un `apps/api/.env` con `DATABASE_URL` y
`DIRECT_DATABASE_URL` apuntando a la branch `development` de Neon, más un
`JWT_SECRET` de 32+ caracteres. Hay un `.env.example` al lado.

```bash
npm install
npm run db:migrate      # aplica las migraciones pendientes
npm run db:seed         # tenant demo + admin@ficha.dev / password123 (solo dev)
npm run dev             # api en :3001, web en :5173
```

**La base corre en Neon, no en Docker.** El `docker-compose.yml` y los scripts
`db:up` / `db:down` / `db:reset` son vestigiales.

## Comandos

| | |
|---|---|
| `npm run dev` | shared + api + web en paralelo |
| `npm run dev:api` / `npm run dev:web` | cada app por separado |
| `npm test` | tests de integración de la API (pegan a la base) |
| `npm test -w apps/web` | tests del frontend |
| `npm run check` | lint + typecheck de las dos apps (lo mismo que corre el pre-push) |
| `npm run build` | shared → api → web |
| `npm run db:migrate` / `db:seed` / `db:studio` | Prisma |

## Cómo se trabaja

Ramas `feat/*` o `fix/*` desde `dev`; los PRs van **contra `dev`, nunca contra
`main`** (el default branch es `main`, así que `gh pr create` necesita `-B dev`).
Promover a producción es un PR `dev` → `main`.

Hay tres entornos aislados de verdad —producción, testing y desarrollo—, cada
uno con su propia branch de Neon y su propio `JWT_SECRET`.

## Documentación

**[`CLAUDE.md`](CLAUDE.md) es la documentación real del proyecto** y conviene
leerlo antes de tocar nada: infraestructura y entornos, política de
migraciones, backups, el patrón repositorio y el guard de multi-tenancy, la
política de borrado lógico y cómo se declaran los campos JSON.

Las notas de investigación y los análisis viven en [`.notes/`](.notes/).
