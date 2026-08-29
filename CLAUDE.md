# Ficha

Monorepo de npm workspaces: `apps/api` (Express 5 + Prisma + Postgres), `apps/web` (Vite + React 19 + Tailwind v4 + Base UI), `packages/shared` (tipos y schemas Zod compartidos; se buildea antes que las apps).

## Comandos

- `npm run dev` — shared + api + web en paralelo (api en :3001, web en :5173)
- `npm run dev:api` / `npm run dev:web` — cada app por separado
- `npm test` — tests de integración de la API (vitest + supertest, pegan a la DB)
- `npm test -w apps/web` — tests del frontend (vitest + jsdom + testing-library)
- `npm run build` — shared → api → web
- `npm run db:migrate` / `db:seed` / `db:studio` — Prisma (workspace apps/api)

## Infraestructura

Nada se hostea junto: cada capa vive en un proveedor distinto y ninguno conoce a los otros. La rama de git es el único pegamento — los tres se disparan solos al detectar un push.

- **GitHub** (`candiath/ficha`, repo **público**) — código, CI y rulesets de protección de ramas.
- **Render** — la API de Express. Un servicio por entorno, plan free (cold start ~50s).
- **Netlify** — la web de Vite, build estático. Un solo sitio (`fichita`) con dos contextos de deploy.
- **Neon** — Postgres. Un solo proyecto (`holy-pine-07820384`) con una branch por entorno.

### Los dos entornos

| | Producción | Staging |
| --- | --- | --- |
| Rama | `main` | `dev` |
| API (Render) | `Ficha` / `srv-d8d00v57vvec73fpvjkg` → ficha-i3t6.onrender.com | `ficha-staging` / `srv-da9eodpsrm7s73c4tsr0` → ficha-staging.onrender.com |
| Web (Netlify) | fichita.netlify.app | `dev--fichita.netlify.app` (branch deploy) |
| DB (Neon branch) | `production` (default) | `staging` / `br-quiet-bread-ac78jda0` |

Los entornos están aislados de verdad, no solo por URL: cada servicio de Render tiene su propio `JWT_SECRET` (un token de staging no vale en producción) y su propio `DATABASE_URL`. Ambos corren con `NODE_ENV=production`, que gatea el guard del seed y vuelve obligatorio `CORS_ORIGIN`.

Hay un tercer consumidor de la DB que no es un entorno desplegado: **CI**, con su propia `CI_DATABASE_URL` (secret de GitHub). Y el `.env` local apunta a la branch `production`, o sea que **dev local escribe sobre datos de producción** — deuda conocida, no un accidente.

### El ciclo de vida de un cambio

```
feat/lo-que-sea ──PR──> dev ──auto-deploy──> staging
                         │
                         └──PR "release: ..."──> main ──auto-deploy──> producción
```

Los PRs de feature van contra `dev`, nunca contra `main`. La promoción a producción es un PR `dev` → `main` con merge commit (no squash: reescribir ahí duplicaría el historial que ya vive en `dev`).

<!-- TODO(human): política de migraciones al promover a producción -->

### Estado de la migración a dos entornos (2026-08-29)

El split se hizo el 29/08/2026; **la mitad todavía está sin aplicar**. Verificar antes de asumir:

- ✅ `main` creada, branch `staging` en Neon, servicio `ficha-staging` live.
- ⏳ Default branch del repo (sigue en `dev`), rulesets de protección, servicio `Ficha` apuntando a `main`, y contextos de Netlify (production branch + `VITE_API_URL` por contexto).

Para consultar el estado real hay MCPs de Render y Neon disponibles; los IDs de arriba son el punto de entrada. Netlify no tiene MCP: se mira en el dashboard.

## Base de datos

Postgres en **Neon**, vía `DATABASE_URL` en `apps/api/.env`. **No usar Docker**: `docker-compose.yml` y los scripts `db:up`/`db:down`/`db:reset` son vestigiales. `prisma migrate dev` corre directo contra Neon.

## Convenciones

- Branches `feat/*` desde `dev`; PRs de feature contra `dev`, nunca contra `main`. El default branch del repo es `main`, así que `gh pr create` necesita `-B dev` explícito. Commits pequeños y atómicos, mensajes en español con prefijo convencional (`fix(web): ...`, `test(web): ...`).
- UI y mensajes de error de la API en español.
- La API envuelve respuestas en `{ data: ... }`; todo `/api/*` salvo `/api/auth/*` y `/health` exige `Authorization: Bearer <token>` (401 → `{"error":"No autenticado"}`).
- CI (`.github/workflows/test.yml`): jobs paralelos para API (con migraciones) y web.

Para levantar y verificar la app end-to-end (puertos, seed, gotchas de Windows): skill `verify` en `.claude/skills/verify/SKILL.md`.
