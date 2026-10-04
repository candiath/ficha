---
name: verify
description: Cómo levantar y verificar Ficha (API Express + web Vite) end-to-end en esta máquina.
---

# Verificar Ficha

## Levantar

- DB: Postgres en Neon (no hay Docker); `DATABASE_URL` ya está en `apps/api/.env`.
- API: `npm run dev:api` (puerto 3001, ts-node-dev). Esperar a que `curl http://localhost:3001/health` devuelva `{"status":"ok"}`.
- Web: `npm run dev:web` (Vite). Build de producción: `npm run build:web`.
- Seed idempotente: `npm run db:seed` (usuario demo `admin@ficha.dev` / `password123`; operador de plataforma `operador@ficha.dev` / `password123`).
- La API exige `PLATFORM_JWT_SECRET` además de `JWT_SECRET` (y distintos): sin él no arranca.

## Flujos que valen la pena

- Login: `POST /api/auth/login` con `{"email","password"}` → `{ data: { token, user } }`.
- Rutas protegidas: cualquier `/api/*` (salvo `/api/auth/*` y `/health`) exige `Authorization: Bearer <token>`; sin token → 401 `{"error":"No autenticado"}`.
- Operador de plataforma: `POST /api/platform/auth/login` → token propio; `GET /api/platform/tenants`. Ese token da 401 en cualquier `/api/*` de la clínica, y viceversa. UI en `/platform/login`.
- Datos demo útiles: pacientes "María García" y "Javier Rodríguez" (historia completa). Los ids son UUID (#174): el seed los deriva del nombre legible con `devId('dev-patient-001')`, así que son fijos entre corridas; el seed imprime los de los episodios al terminar, o se sacan de `GET /api/patients`.
- Un id malformado en la URL da 404 con el mensaje de la entidad; en el body, 400.

## Gotchas

- **Windows + ts-node-dev**: matar la tarea de npm NO mata el server hijo; queda huérfano reteniendo el puerto 3001 y el server "nuevo" imprime que corre pero no recibe conexiones. Matar por dueño del puerto:
  `Get-NetTCPConnection -LocalPort 3001 -State Listen | % { taskkill /PID $_.OwningProcess /T /F }`
- **Rate limit del login**: 10 requests / 15 min por IP (en memoria). Si lo agotás probando, reiniciá la API para resetearlo.
- El warning de chunks > 500 kB en `build:web` es preexistente, no es una regresión.
