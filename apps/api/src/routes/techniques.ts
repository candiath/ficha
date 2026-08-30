import { Router } from 'express';
import { z } from 'zod';
import { techniqueRepo } from '../repositories';

// Las queries viven en techniqueRepo, que aplica la política "global o del
// tenant" (Technique no está cubierta por el guard de forTenant); esta ruta
// queda en HTTP puro: validar el body y mapear null/false a 404.
const router = Router();

const TechniqueSchema = z.object({
  name: z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
});

// GET /api/techniques — globales + las del tenant
router.get('/', async (req, res) => {
  const data = await techniqueRepo.list(req.context);
  res.json({ data });
});

// POST /api/techniques — crea técnica personalizada para el tenant
router.post('/', async (req, res) => {
  const { name } = TechniqueSchema.parse(req.body);
  const technique = await techniqueRepo.create(req.context, { name });
  res.status(201).json({ data: technique });
});

// PATCH /api/techniques/:id — solo técnicas del tenant (no globales)
router.patch('/:id', async (req, res) => {
  const { name } = TechniqueSchema.parse(req.body);

  // null = inexistente, de otro tenant o global: mismo 404 en los tres casos.
  const technique = await techniqueRepo.update(req.context, req.params.id, { name });
  if (!technique) {
    res.status(404).json({ error: 'Técnica no encontrada o no editable' });
    return;
  }

  res.json({ data: technique });
});

// DELETE /api/techniques/:id — solo técnicas del tenant (no globales)
router.delete('/:id', async (req, res) => {
  const deleted = await techniqueRepo.delete(req.context, req.params.id);
  if (!deleted) {
    res.status(404).json({ error: 'Técnica no encontrada o no eliminable' });
    return;
  }

  res.status(204).send();
});

export default router;
