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

### Los tres entornos

| | Producción | Testing | Desarrollo |
| --- | --- | --- | --- |
| Rama | `main` | `dev` | working tree local |
| Quién lo consume | los usuarios | solo Nath | solo Nath |
| API | `Ficha` / `srv-d8d00v57vvec73fpvjkg` → ficha-i3t6.onrender.com | `ficha-staging` / `srv-da9eodpsrm7s73c4tsr0` → ficha-staging.onrender.com | `localhost:3001` |
| Web | fichita.netlify.app | `dev--fichita.netlify.app` (branch deploy) | `localhost:5173` |
| DB (Neon branch) | `production` / `br-mute-star-acmnbdh1` | `staging` / `br-quiet-bread-ac78jda0` | `development` / `br-cool-lake-ac3pow9e` |

Los tres están aislados de verdad, no solo por URL: **cada uno tiene su propia branch de Neon y su propio `JWT_SECRET`**, así que un token de testing no vale en producción y una migración local no toca datos reales. Los dos desplegados corren con `NODE_ENV=production`, que gatea el guard del seed y vuelve obligatorio `CORS_ORIGIN`; en local `NODE_ENV` no es production, por eso ahí el seed sí corre.

Hay un cuarto consumidor de la DB que no es un entorno: **CI**, con su propia `CI_DATABASE_URL` (secret de GitHub).

Las branches de Neon son copy-on-write: se crean en segundos con los datos del padre y solo ocupan las páginas que divergen. Rehacer `development` desde `production` para tener datos frescos es barato.

### El ciclo de vida de un cambio

```
local (development) ──PR──> dev ──auto-deploy──> testing
                             │
                             └──PR "release: ..."──> main ──auto-deploy──> producción
```

Los PRs de feature van contra `dev`, nunca contra `main`. La promoción a producción es un PR `dev` → `main` con merge commit (no squash: reescribir ahí duplicaría el historial que ya vive en `dev`).

**El ruleset tiene `strict_required_status_checks_policy` en `false` a propósito** — no es un olvido. Con `strict` en `true` ("require branches to be up to date"), cada release deja un merge commit que vive solo en `main`, así que `dev` queda permanentemente "desactualizada" y GitHub exige un *Update branch*; ese botón hace un push directo a `dev`, que el mismo ruleset rechaza por no tener checks corridos todavía. Deadlock en cada release. Y no se pierde nada: como todo llega a `main` a través de `dev`, `dev` nunca puede estar atrasada en código. La contracara es que si alguna vez se hace un hotfix directo sobre `main`, hay que bajarlo a `dev` a mano — GitHub ya no avisa.

Como el árbol que testea el PR de release es idéntico al merge commit que aterriza en `main` (nadie más mueve `main`), el CI **no corre de nuevo al mergear a `main`**: el trigger de `push` cubre solo `dev`. Si en el futuro `main` empezara a recibir cambios por otro canal, esa suposición deja de valer y habría que volver a sumarla.

El entorno de testing solo sirve si se usa: el valor está en la ventana entre mergear a `dev` y promover a `main`. Promover en el mismo minuto convierte a testing en una segunda producción rota en silencio.

### Política de migraciones

Cada entorno migra su propia base, y el schema viaja por el mismo canal que el código:

1. **Local**: `npm run db:migrate` (`prisma migrate dev`) genera el archivo de migración contra la branch `development`. El archivo se commitea junto al cambio de código que lo necesita.
2. **Testing y producción**: `npm run migrate:prod` (`prisma migrate deploy`) corre en el Build Command de cada servicio de Render, con el `DATABASE_URL` de ese servicio. Es idempotente: aplica solo lo pendiente.

Las migraciones van por **conexión directa**, no por el pooler: el datasource declara `directUrl = env("DIRECT_DATABASE_URL")`, que es el mismo host de Neon sin `-pooler`. `prisma migrate` toma un advisory lock de sesión y PgBouncer en modo transacción no garantiza la misma conexión física entre statements (falla con `P1002`). Cada entorno necesita las dos variables; la app solo usa la pooled.

Si una migración falla, el build falla y Render **mantiene vivo el deploy anterior** — el entorno sigue sirviendo la versión vieja en vez de arrancar con un schema a medias. Prisma envuelve cada migración en una transacción, así que no quedan aplicadas por la mitad.

**Migraciones destructivas en dos pasos.** Un `DROP COLUMN` que llega junto al código que deja de usar la columna rompe producción en el intervalo entre que la migración corre y el proceso nuevo toma el tráfico. Se hace en dos releases: primero se agrega lo nuevo y se deja de leer lo viejo; el `DROP` va en un release posterior, cuando ya nada lo referencia.

Nunca correr `db:migrate` ni `db:seed` con `DATABASE_URL` apuntando a `production`. El `.env` local trae la URL de producción comentada solo para inspección con `db:studio`.

### Cómo se llegó acá (2026-08-29)

El split a tres entornos se hizo el 29/08/2026 y está **completo**: `main` como default branch, rulesets (`test` + `test-web` en `main` y `dev`, PR obligatorio en `main`), las tres branches de Neon, los dos servicios de Render apuntando a su rama y corriendo `migrate:prod` en el build, Netlify con production branch en `main` más branch deploy de `dev`, y `VITE_API_URL` por contexto.

Dos cosas que se rompieron en el camino y conviene no repetir:

- **No habilitar PR previews sobre el servicio de producción de Render.** Los previews clonan las env vars del padre, así que cada uno arrancaba con el `DATABASE_URL` y el `JWT_SECRET` de producción: migraba contra la base real y firmaba tokens válidos en producción. Si se quieren previews, van sobre `ficha-staging`.
- **Verificar la config de Netlify leyendo el bundle, no el dashboard.** Vite inlinea `VITE_API_URL` en build time, así que `curl` sobre el JS publicado dice a qué API pega cada contexto de verdad. Cambiar la variable no tiene efecto hasta rebuildear.

Para consultar el estado real hay MCPs de Render y Neon disponibles; los IDs de arriba son el punto de entrada. Netlify no tiene MCP: se mira en el dashboard.

## Base de datos

Postgres en **Neon**, vía `DATABASE_URL` en `apps/api/.env` (branch `development`, ver arriba). **No usar Docker**: `docker-compose.yml` y los scripts `db:up`/`db:down`/`db:reset` son vestigiales. `prisma migrate dev` corre directo contra Neon.

### Acceso a datos: patrón repositorio

**La base de datos se toca solo desde `apps/api/src/repositories`.** Una regla `no-restricted-imports` en `eslint.config.mjs` lo hace cumplir: importar `lib/prisma` o `lib/tenantScope` desde una ruta o middleware es error de lint (y el CI corre `npm run check`). `tests/`, `prisma/seed.ts` y `scripts/` quedan exentos.

Cada entidad tiene un **port** (`<entidad>Repository.ts`: interface + DTOs) y una **implementación** (`prisma/prisma<Entidad>Repository.ts`), exportada con alias desde el barrel `repositories/index.ts`. Convenciones:

- Primer argumento `ctx: TenantContext` (lo arma `authenticate` y viaja en `req.context`); adentro, `forTenant(ctx)` devuelve el cliente scopeado que inyecta el `tenantId` solo.
- **No encontrado devuelve `null`/`false`, nunca throw** — la ruta lo mapea a 404. Con más de dos salidas, unión de literales (`'deleted' | 'not_found' | 'in_use'`) o resultado discriminado (`{ ok: false, reason }`).
- **Las escrituras condicionadas llevan la condición en el `where` del write** (`updateMany`/`deleteMany` + count, o `update` con campos no únicos en el where y `P2025` → `null`): existencia, pertenencia y vigencia se deciden en la misma query que escribe, sin ventana entre chequeo y escritura.
- Los DTOs no exponen `tenantId`; fechas como ISO string y `Decimal` como `number`.
- Zod y la semántica HTTP se quedan en la ruta; la política de datos (borrado lógico, "global o del tenant", "no borrar un paquete usado") vive en el repositorio.

Dos excepciones documentadas: `authRepository` **no** recibe `ctx` (sus lecturas son las que lo construyen: login y `authenticate`), y `techniqueRepository` filtra el tenant a mano porque `Technique` tiene `tenantId` nullable y queda fuera del guard.

### Borrado de pacientes

Es **lógico** (`deletedAt`): el paciente desaparece de `GET /api/patients`, su ficha da 404 y no puede recibir datos clínicos nuevos (las rutas que crean episodios, sesiones, escalas, alertas y paquetes pasan por `patientRepo.exists()`). Pero **el historial ya registrado lo sigue nombrando**: los joins `patient: { select: { fullName } }` de Cobros, Sesiones y Paquetes no filtran `deletedAt` a propósito — un cobro sin nombre sería un registro inútil. Borrar un paciente lo oculta; no reescribe el pasado. (Issue #72, cerrado *by design*.)

La línea que separa las dos mitades es **historial vs. trabajo pendiente**. Por eso las **alertas sí filtran** pacientes borrados, en la lista y en el contador de no leídas: una alerta no registra lo que pasó, pide una acción — y sobre un paciente eliminado esa acción es imposible. El filtro va en la lectura (`clinicalAlertRepository`) y no borra filas: el borrado es reversible y las alertas deben poder volver con el paciente.

### Campos JSON: la forma vive en `packages/shared`

La evaluación inicial guarda varias columnas `Json?` (grilla de familias de posturas, dolor en familia, mapa de retracciones). Postgres no valida nada de su contenido, así que **la forma de un campo JSON se declara en `packages/shared` y la ruta la valida con ese schema** — si no, el significado del dato termina viviendo sólo en el componente de React que lo dibuja, y nadie más puede leerlo sin reimplementarlo.

`postureFamilies` es el caso modelo (`packages/shared/src/postureFamilies.ts`): `POSTURE_TABLES` describe las dos tablas columna por columna, cada una con un `kind` (`mark`, `flag`, `choice`, `text`) que dice qué guarda la celda. De ahí sale todo lo demás: la web dibuja el control según el `kind` y `postureFamiliesSchema` se deriva de la misma definición, con `strictObject` en los tres niveles (tabla → fila → columna). Agregar una columna es agregar una entrada en la lista.

Lo guardado es sparse: una celda vacía no se guarda, una fila o tabla que queda sin celdas se borra, y una grilla sin nada se guarda como `NULL`. `setPostureCell` hace esa poda; no armar el objeto a mano.

Éste es el único módulo de `packages/shared` con **valores de runtime** (el resto son `import type`). Por eso `apps/web/vite.config.ts` y `vitest.config.ts` aliasan `@ficha/shared` al código fuente —el paquete compila a CommonJS, que un browser no puede cargar— y el job `test` del CI buildea `packages/shared` antes de correr los tests de la API. Render ya lo hacía vía `build:api`.

Queda un campo sin migrar a este patrón: `retractionMap` sigue con `z.unknown()`.

## Convenciones

- Branches `feat/*` desde `dev`; PRs de feature contra `dev`, nunca contra `main`. El default branch del repo es `main`, así que `gh pr create` necesita `-B dev` explícito. Commits pequeños y atómicos, mensajes en español con prefijo convencional (`fix(web): ...`, `test(web): ...`).
- UI y mensajes de error de la API en español.
- La API envuelve respuestas en `{ data: ... }`; todo `/api/*` salvo `/api/auth/*` y `/health` exige `Authorization: Bearer <token>` (401 → `{"error":"No autenticado"}`).
- CI (`.github/workflows/test.yml`): jobs paralelos para API (con migraciones) y web.

Para levantar y verificar la app end-to-end (puertos, seed, gotchas de Windows): skill `verify` en `.claude/skills/verify/SKILL.md`.
