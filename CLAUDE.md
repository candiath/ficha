# Ficha

Monorepo de npm workspaces: `apps/api` (Express 5 + Prisma + Postgres), `apps/web` (Vite + React 19 + Tailwind v4 + Base UI), `packages/shared` (tipos y schemas Zod compartidos; se buildea antes que las apps).

## Comandos

- `npm run dev` — shared + api + web en paralelo (api en :3001, web en :5173)
- `npm run dev:api` / `npm run dev:web` — cada app por separado
- `npm test` — tests de integración de la API (vitest + supertest, pegan a la DB)
- `npm test -w apps/web` — tests del frontend (vitest + jsdom + testing-library)
- `npm run build` — shared → api → web
- `npm run db:migrate` / `db:seed` / `db:studio` — Prisma (workspace apps/api)

## Base de datos

Postgres en **Neon**, vía `DATABASE_URL` en `apps/api/.env`. **No usar Docker**: `docker-compose.yml` y los scripts `db:up`/`db:down`/`db:reset` son vestigiales. `prisma migrate dev` corre directo contra Neon. CI usa una branch de Neon dedicada (`CI_DATABASE_URL`), nunca la DB de dev.

## Convenciones

- Branches `feat/*` desde `dev`; PRs contra `dev`. Commits pequeños y atómicos, mensajes en español con prefijo convencional (`fix(web): ...`, `test(web): ...`).
- UI y mensajes de error de la API en español.
- La API envuelve respuestas en `{ data: ... }`; todo `/api/*` salvo `/api/auth/*` y `/health` exige `Authorization: Bearer <token>` (401 → `{"error":"No autenticado"}`).
- CI (`.github/workflows/test.yml`): jobs paralelos para API (con migraciones) y web.

Para levantar y verificar la app end-to-end (puertos, seed, gotchas de Windows): skill `verify` en `.claude/skills/verify/SKILL.md`.
