import type { RequestParamHandler } from 'express';
import { isId } from '../lib/validation';

// Valida que un parámetro de ruta (`:id`, `:patientId`…) sea un UUID antes de
// que llegue al repositorio. Se registra con `router.param(nombre, ...)`.
//
// Hace falta porque las columnas de ids son `uuid` nativo (issue #174): contra
// ellas, un id con otra forma no devuelve "no encontrado" sino P2023, y la
// ruta respondería 500. Responde 404 y no 400: un id con forma imposible es un
// recurso que no existe, y el mensaje es el mismo que daría la ruta para un id
// válido que no existe, así que el contrato con el front no cambia.
//
// Un `router.param` solo se dispara para parámetros declarados en ese mismo
// router: los que vienen del path de montaje (`/api/patients/:patientId/...`
// en app.ts) se registran con `app.param` en app.ts. tests/idParamCoverage
// rompe el CI si un `:param` queda sin registrar.
export function idParam(notFoundMessage: string): RequestParamHandler {
  return (_req, res, next, value) => {
    if (!isId(value)) {
      res.status(404).json({ error: notFoundMessage });
      return;
    }
    next();
  };
}
