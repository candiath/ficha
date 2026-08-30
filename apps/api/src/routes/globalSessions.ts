import { Router } from 'express';
import { sessionRepo } from '../repositories';

const router = Router();

// GET /api/sessions — todas las sesiones del tenant, con nombre del paciente.
// Una sesión puede abordar varios episodios (motivos), por eso se devuelven como
// arreglo `episodes` y se aplana también a `episodeIds`.
router.get('/', async (req, res) => {
  const data = await sessionRepo.listAllForTenant(req.context);
  res.json({ data });
});

export default router;
