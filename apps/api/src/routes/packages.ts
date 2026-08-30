import { Router } from 'express';
import { z } from 'zod';
import { packageRepo, patientRepo } from '../repositories';

// Las queries viven en packageRepo (incluida la regla "no borrar un paquete
// con sesiones ya usadas"); la ruta queda en HTTP puro: validar el body y
// mapear el resultado a status codes.
const router = Router();

const PackageCreateSchema = z.object({
  patientId: z.string().min(1),
  name: z.string().min(1),
  totalSessions: z.number().int().min(1),
  pricePerSession: z.number().positive(),
  notes: z.string().optional().nullable(),
});

// GET /api/packages?patientId=xxx  — lista paquetes de un paciente con sesiones usadas
router.get('/', async (req, res) => {
  const patientId = req.query.patientId as string | undefined;
  const data = await packageRepo.list(req.context, { patientId });
  res.json({ data });
});

// POST /api/packages
router.post('/', async (req, res) => {
  const body = PackageCreateSchema.parse(req.body);

  // Paciente del tenant y vigente: la política vive en patientRepo.
  if (!(await patientRepo.exists(req.context, body.patientId))) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  const pkg = await packageRepo.create(req.context, body);
  res.status(201).json({ data: pkg });
});

// DELETE /api/packages/:id — solo si no tiene sesiones usadas
router.delete('/:id', async (req, res) => {
  const result = await packageRepo.deleteIfUnused(req.context, req.params.id);

  if (result === 'not_found') {
    res.status(404).json({ error: 'Paquete no encontrado' });
    return;
  }

  if (result === 'in_use') {
    res.status(409).json({ error: 'No se puede eliminar un paquete con sesiones ya usadas' });
    return;
  }

  res.status(204).send();
});

export default router;
