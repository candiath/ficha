import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // ── Catálogo global de regiones corporales ──────────────────────────────
  const bodyRegions = await Promise.all([
    prisma.bodyRegion.upsert({ where: { id: 'br-cervical' }, update: {}, create: { id: 'br-cervical', name: 'Cervical', zone: 'superior' } }),
    prisma.bodyRegion.upsert({ where: { id: 'br-dorsal' }, update: {}, create: { id: 'br-dorsal', name: 'Dorsal', zone: 'superior' } }),
    prisma.bodyRegion.upsert({ where: { id: 'br-lumbar' }, update: {}, create: { id: 'br-lumbar', name: 'Lumbar', zone: 'inferior' } }),
    prisma.bodyRegion.upsert({ where: { id: 'br-cadera' }, update: {}, create: { id: 'br-cadera', name: 'Cadera', zone: 'inferior' } }),
    prisma.bodyRegion.upsert({ where: { id: 'br-rodilla' }, update: {}, create: { id: 'br-rodilla', name: 'Rodilla', zone: 'inferior' } }),
  ]);

  // ── Técnicas globales RPG (tenant_id null = disponible para todos) ───────
  await Promise.all([
    prisma.technique.upsert({ where: { id: 'tech-rana-suelo' }, update: {}, create: { id: 'tech-rana-suelo', tenantId: null, name: 'Rana en el suelo', isGlobal: true } }),
    prisma.technique.upsert({ where: { id: 'tech-rana-aire' }, update: {}, create: { id: 'tech-rana-aire', tenantId: null, name: 'Rana en el aire', isGlobal: true } }),
    prisma.technique.upsert({ where: { id: 'tech-sentado' }, update: {}, create: { id: 'tech-sentado', tenantId: null, name: 'Sentado en silla', isGlobal: true } }),
    prisma.technique.upsert({ where: { id: 'tech-parado' }, update: {}, create: { id: 'tech-parado', tenantId: null, name: 'Parado en la pared', isGlobal: true } }),
  ]);

  // ── Tenant de desarrollo ─────────────────────────────────────────────────
  const tenant = await prisma.tenant.upsert({
    where: { id: 'dev-tenant-001' },
    update: {},
    create: {
      id: 'dev-tenant-001',
      name: 'Clínica Demo RPG',
      slug: 'demo-rpg',
    },
  });

  // ── Usuario admin (contraseña: password123 — solo dev) ───────────────────
  const hashedPassword = await bcrypt.hash('password123', 10);
  const user = await prisma.user.upsert({
    where: { email: 'admin@ficha.dev' },
    update: {},
    create: {
      tenantId: tenant.id,
      email: 'admin@ficha.dev',
      passwordHash: hashedPassword,
      name: 'Admin Demo',
    },
  });

  // ── Paciente de prueba ────────────────────────────────────────────────────
  const patient = await prisma.patient.upsert({
    where: { id: 'dev-patient-001' },
    update: {},
    create: {
      id: 'dev-patient-001',
      tenantId: tenant.id,
      fullName: 'María García',
      phone: '+54 11 1234-5678',
      sex: 'FEMALE',
      occupation: 'Docente',
    },
  });

  // ── Evaluación inicial del paciente de prueba ─────────────────────────────
  await prisma.initialEvaluation.upsert({
    where: { patientId: patient.id },
    update: {},
    create: {
      tenantId: tenant.id,
      patientId: patient.id,
      reasonForConsultation: 'Dolor lumbar crónico y contracturas cervicales',
      globalPosture: 'Hiperlordosis lumbar, cabeza adelantada',
      breathingPattern: 'Costal superior predominante',
    },
  });

  // ── Sesiones de ejemplo ────────────────────────────────────────────────
  const session1 = await prisma.session.upsert({
    where: { id: 'dev-session-001' },
    update: {},
    create: {
      id: 'dev-session-001',
      tenantId: tenant.id,
      patientId: patient.id,
      userId: user.id,
      sessionType: 'SESSION',
      sessionDate: new Date('2026-02-10T10:00:00.000Z'),
      painScaleBefore: 7,
      painScaleAfter: 4,
      preSesionState: 'Paciente refiere dolor lumbar al estar sentada más de 30 minutos. Noches con dificultad para dormir de costado.',
      reEvaluationNotes: 'Mejora leve en rango de flexión lumbar respecto a evaluación inicial. Persiste tensión en cadena posterior.',
      patientResponse: 'Buena respuesta a la postura rana en el suelo. Dificultad inicial para soltar el diafragma.',
      observations: 'Se trabajó cadena posterior con postura en rana en el suelo, 20 minutos. Respiración diafragmática guiada.',
    },
  });

  await prisma.session.upsert({
    where: { id: 'dev-session-002' },
    update: {},
    create: {
      id: 'dev-session-002',
      tenantId: tenant.id,
      patientId: patient.id,
      userId: user.id,
      sessionType: 'SESSION',
      sessionDate: new Date('2026-02-24T10:00:00.000Z'),
      painScaleBefore: 5,
      painScaleAfter: 2,
      preSesionState: 'Paciente reporta mejoría notable. Dolor aparece recién después de 1 hora sentada. Duerme mejor.',
      reEvaluationNotes: 'Flexión lumbar dentro de rangos normales. Reducción de hiperlordosis observable. Cabeza sigue adelantada.',
      patientResponse: 'Excelente respuesta. Se incorporó postura parado en la pared sin dificultad.',
      observations: 'Sesión combinada: rana en el suelo + parado en la pared. Trabajo específico sobre sector cervical.',
    },
  });

  // ── Técnicas aplicadas en sesión 1 ────────────────────────────────────
  await prisma.sessionTechnique.upsert({
    where: { id: 'dev-st-001' },
    update: {},
    create: {
      id: 'dev-st-001',
      sessionId: session1.id,
      techniqueId: 'tech-rana-suelo',
      bodyRegionId: 'br-lumbar',
      variantNotes: '20 min, respiración diafragmática guiada',
    },
  });

  // ── Registros de auditoría de ejemplo ──────────────────────────────────
  await prisma.auditLog.upsert({
    where: { id: 'dev-audit-001' },
    update: {},
    create: {
      id: 'dev-audit-001',
      tenantId: tenant.id,
      patientId: patient.id,
      userId: user.id,
      entity: 'PATIENT',
      entityId: patient.id,
      action: 'CREATED',
      description: 'Paciente María García creada en el sistema',
      createdAt: new Date('2026-02-01T09:00:00.000Z'),
    },
  });

  await prisma.auditLog.upsert({
    where: { id: 'dev-audit-002' },
    update: {},
    create: {
      id: 'dev-audit-002',
      tenantId: tenant.id,
      patientId: patient.id,
      userId: user.id,
      entity: 'EVALUATION',
      entityId: patient.id,
      action: 'CREATED',
      description: 'Evaluación inicial registrada',
      createdAt: new Date('2026-02-01T09:30:00.000Z'),
    },
  });

  await prisma.auditLog.upsert({
    where: { id: 'dev-audit-003' },
    update: {},
    create: {
      id: 'dev-audit-003',
      tenantId: tenant.id,
      patientId: patient.id,
      userId: user.id,
      entity: 'SESSION',
      entityId: 'dev-session-001',
      action: 'CREATED',
      description: 'Sesión de tratamiento registrada',
      createdAt: new Date('2026-02-10T10:30:00.000Z'),
    },
  });

  await prisma.auditLog.upsert({
    where: { id: 'dev-audit-004' },
    update: {},
    create: {
      id: 'dev-audit-004',
      tenantId: tenant.id,
      patientId: patient.id,
      userId: user.id,
      entity: 'SESSION',
      entityId: 'dev-session-002',
      action: 'CREATED',
      description: 'Sesión de tratamiento registrada',
      createdAt: new Date('2026-02-24T10:30:00.000Z'),
    },
  });

  // ── Alertas clínicas de ejemplo ────────────────────────────────────────
  await prisma.clinicalAlert.upsert({
    where: { id: 'dev-alert-001' },
    update: {},
    create: {
      id: 'dev-alert-001',
      tenantId: tenant.id,
      patientId: patient.id,
      type: 'FOLLOW_UP',
      message: 'María García lleva 30 días sin sesión — agendar seguimiento',
      createdAt: new Date('2026-03-24T08:00:00.000Z'),
    },
  });

  await prisma.clinicalAlert.upsert({
    where: { id: 'dev-alert-002' },
    update: {},
    create: {
      id: 'dev-alert-002',
      tenantId: tenant.id,
      patientId: patient.id,
      type: 'PAYMENT',
      message: 'María García tiene 1 cobro pendiente',
      createdAt: new Date('2026-03-20T08:00:00.000Z'),
    },
  });

  console.log('✓ Seed completado');
  console.log(`  Tenant:  ${tenant.name} (slug: ${tenant.slug})`);
  console.log(`  Usuario: ${user.email} / password123`);
  console.log(`  Paciente: ${patient.fullName}`);
  console.log(`  Regiones corporales: ${bodyRegions.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
