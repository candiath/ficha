import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';

const router = Router();

const techniqueSelect = {
  id: true,
  name: true,
  isGlobal: true,
  tenantId: true,
  createdAt: true,
} as const;

const TechniqueSchema = z.object({
  name: z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
});

// GET /api/techniques — globales + las del tenant
router.get('/', async (req, res) => {
  const techniques = await prisma.technique.findMany({
    where: {
      OR: [{ isGlobal: true }, { tenantId: req.context.tenantId }],
    },
    orderBy: [{ isGlobal: 'desc' }, { name: 'asc' }],
    select: techniqueSelect,
  });

  res.json({ data: techniques });
});

// POST /api/techniques — crea técnica personalizada para el tenant
router.post('/', async (req, res) => {
  const { name } = TechniqueSchema.parse(req.body);

  const technique = await prisma.technique.create({
    data: { name, tenantId: req.context.tenantId, isGlobal: false },
    select: techniqueSelect,
  });

  res.status(201).json({ data: technique });
});

// PATCH /api/techniques/:id — solo técnicas del tenant (no globales)
router.patch('/:id', async (req, res) => {
  const existing = await prisma.technique.findFirst({
    where: { id: req.params.id, tenantId: req.context.tenantId, isGlobal: false },
    select: { id: true },
  });

  if (!existing) {
    res.status(404).json({ error: 'Técnica no encontrada o no editable' });
    return;
  }

  const { name } = TechniqueSchema.parse(req.body);
  const technique = await prisma.technique.update({
    where: { id: req.params.id },
    data: { name },
    select: techniqueSelect,
  });

  res.json({ data: technique });
});

// DELETE /api/techniques/:id — solo técnicas del tenant (no globales)
router.delete('/:id', async (req, res) => {
  const existing = await prisma.technique.findFirst({
    where: { id: req.params.id, tenantId: req.context.tenantId, isGlobal: false },
    select: { id: true },
  });

  if (!existing) {
    res.status(404).json({ error: 'Técnica no encontrada o no eliminable' });
    return;
  }

  await prisma.technique.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

export default router;
