import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';

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

  const packages = await prisma.sessionPackage.findMany({
    where: {
      tenantId: req.context.tenantId,
      ...(patientId ? { patientId } : {}),
    },
    include: {
      patient: { select: { id: true, fullName: true } },
      _count: { select: { payments: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const data = packages.map((pkg) => ({
    id: pkg.id,
    patientId: pkg.patientId,
    patientName: pkg.patient.fullName,
    name: pkg.name,
    totalSessions: pkg.totalSessions,
    pricePerSession: Number(pkg.pricePerSession),
    usedSessions: pkg._count.payments,
    remainingSessions: pkg.totalSessions - pkg._count.payments,
    notes: pkg.notes,
    createdAt: pkg.createdAt,
  }));

  res.json({ data });
});

// POST /api/packages
router.post('/', async (req, res) => {
  const body = PackageCreateSchema.parse(req.body);

  // Verificar que el paciente pertenece al tenant
  const patient = await prisma.patient.findFirst({
    where: { id: body.patientId, tenantId: req.context.tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!patient) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  const pkg = await prisma.sessionPackage.create({
    data: {
      tenantId: req.context.tenantId,
      patientId: body.patientId,
      name: body.name,
      totalSessions: body.totalSessions,
      pricePerSession: body.pricePerSession,
      notes: body.notes ?? null,
    },
    include: {
      _count: { select: { payments: true } },
    },
  });

  res.status(201).json({
    data: {
      ...pkg,
      pricePerSession: Number(pkg.pricePerSession),
      usedSessions: 0,
      remainingSessions: pkg.totalSessions,
    },
  });
});

// DELETE /api/packages/:id — solo si no tiene sesiones usadas
router.delete('/:id', async (req, res) => {
  const pkg = await prisma.sessionPackage.findFirst({
    where: { id: req.params.id, tenantId: req.context.tenantId },
    include: { _count: { select: { payments: true } } },
  });

  if (!pkg) {
    res.status(404).json({ error: 'Paquete no encontrado' });
    return;
  }

  if (pkg._count.payments > 0) {
    res.status(409).json({ error: 'No se puede eliminar un paquete con sesiones ya usadas' });
    return;
  }

  await prisma.sessionPackage.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

export default router;
