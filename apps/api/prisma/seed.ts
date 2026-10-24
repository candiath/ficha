import { type DatePrecision, type PatientEventKind, Prisma, PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { auditEntityOf, auditEntryProblem } from '@ficha/shared';
import { foreignAccounts } from './seedGuard';

const prisma = new PrismaClient();

// The demo audit history, inserted only where missing and with its demo dates.
// createMany with skipDuplicates is ON CONFLICT DO NOTHING: an upsert would
// fire the append-only trigger of #186 on every re-run. Backdating needs the
// maintenance switch, set for this transaction alone; once the triggers exist
// it also needs the branch's maintenance flag, so the seed stops with
// instructions instead of silently stamping "now".
async function seedAuditRows(rows: Prisma.AuditLogCreateManyInput[]): Promise<void> {
  // Checked against the catalog like any audit write (SPEC-audit-structured-entries.md §4).
  for (const row of rows) {
    const problem = auditEntryProblem('audit_logs', row.action, row.params ?? {});
    if (problem || row.entity !== auditEntityOf('audit_logs', row.action)) {
      throw new Error(`seed: audit row ${row.id ?? ''} does not match the catalog: ${problem ?? 'entity'}`);
    }
  }
  await prisma.$transaction(async (tx) => {
    const [state] = await tx.$queryRaw<{ hardened: boolean; flagged: boolean }[]>`
      SELECT to_regprocedure('public.audit_maintenance_on()') IS NOT NULL AS hardened,
             to_regclass('ficha_ops.audit_maintenance_allowed') IS NOT NULL AS flagged`;
    if (state.hardened && !state.flagged) {
      throw new Error(
        'This database has no audit maintenance flag, so the seed cannot write its demo ' +
          'history. Only development and ci get it: see docs/infra.md.',
      );
    }
    await tx.$queryRaw`SELECT set_config('ficha.audit_maintenance', pg_current_xact_id()::text, true)`;
    await tx.auditLog.createMany({ data: rows, skipDuplicates: true });
  });
}

// Ids fijos para que el seed se pueda correr las veces que haga falta: cada
// upsert encuentra la fila de la corrida anterior. Las columnas de ids son
// `uuid` (issue #174), así que el nombre legible no puede ser el id: se deriva
// de él un UUID determinístico (SHA-1 del nombre, con los bits de versión 5 y
// de variante RFC). `dev-patient-001` da siempre el mismo id, en cualquier
// máquina.
function devId(name: string): string {
  const h = createHash('sha1').update(`ficha-seed:${name}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const hex = h.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// A session's block for one episode it treated (#238): what belongs to that
// problem alone.
async function seedBlock(
  session: { id: string; tenantId: string; patientId: string },
  episodeId: string,
  fields: Pick<
    Prisma.SessionEpisodeUncheckedCreateInput,
    | 'preSessionState'
    | 'treatment'
    | 'painScaleBefore'
    | 'painScaleAfter'
    | 'patientExercises'
    | 'reEvaluationNotes'
  > = {},
): Promise<void> {
  await prisma.sessionEpisode.upsert({
    where: { sessionId_episodeId: { sessionId: session.id, episodeId } },
    update: {},
    create: {
      tenantId: session.tenantId,
      patientId: session.patientId,
      sessionId: session.id,
      episodeId,
      ...fields,
    },
  });
}

// An entry of a patient's history (#238), with its partial date.
async function seedEvent(
  id: string,
  owner: { tenantId: string; patientId: string },
  kind: PatientEventKind,
  description: string,
  occurred: { date: string; precision: DatePrecision; approximate?: boolean } | null,
): Promise<void> {
  await prisma.patientEvent.upsert({
    where: { id },
    update: {},
    create: {
      id,
      ...owner,
      kind,
      description,
      occurredOn: occurred ? new Date(`${occurred.date}T00:00:00.000Z`) : null,
      occurredPrecision: occurred?.precision ?? null,
      occurredApproximate: occurred?.approximate ?? false,
    },
  });
}

async function main() {
  // ── Guardia de producción ────────────────────────────────────────────────
  // Desde que se eliminaron los catálogos de técnicas, el seed no tiene nada
  // que sembrar en producción. El tenant demo, el usuario
  // admin@ficha.dev/password123 y los pacientes de ejemplo son
  // EXCLUSIVAMENTE de desarrollo: sembrar una credencial conocida en
  // producción sería una puerta trasera.
  if (process.env.NODE_ENV === 'production') {
    console.log('✓ Seed completado (nada que sembrar)');
    console.log('  NODE_ENV=production: no se crean tenant, usuario ni datos demo.');
    return;
  }

  // Second guard: NODE_ENV does not protect a laptop pointed at the wrong
  // database. Any account outside the demo and test domains means this is not
  // a database the seed belongs in (prisma/seedGuard.ts).
  const foreign = await foreignAccounts(prisma);
  if (foreign.length > 0) {
    throw new Error(
      `Refusing to seed: this database has ${foreign.length} account(s) outside the demo ` +
        'and test domains. The seed plants known credentials; run it only on development.',
    );
  }

  // ── Tenant de desarrollo ─────────────────────────────────────────────────
  const tenant = await prisma.tenant.upsert({
    where: { id: devId('dev-tenant-001') },
    update: {},
    create: {
      id: devId('dev-tenant-001'),
      name: 'Clínica Demo RPG',
      slug: 'demo-rpg',
    },
  });

  // ── Usuario admin (contraseña: password123 — solo dev) ───────────────────
  const hashedPassword = await bcrypt.hash('password123', 10);
  const user = await prisma.user.upsert({
    where: { email: 'admin@ficha.dev' },
    // update también setea el rol para promover usuarios creados antes
    // de que existiera la columna role.
    update: { role: 'ADMIN' },
    create: {
      tenantId: tenant.id,
      email: 'admin@ficha.dev',
      passwordHash: hashedPassword,
      name: 'Admin Demo',
      role: 'ADMIN',
    },
  });

  // ── Demo session (expired) ────────────────────────────────────────────────
  // The demo audit history names a session of its author, as the database
  // requires (#186). Already expired, and its token is random bytes nobody
  // ever saw: it cannot be used to sign in.
  //
  // Dated relative to this run, and refreshed on every run: a session that
  // ended more than 180 days ago is deleted by the retention runner (#178),
  // and a local API could delete it between this upsert and the demo audit
  // rows below, whose insert trigger requires the session to exist. The demo
  // audit rows keep their own, earlier, backdated times; nothing compares the
  // two.
  const ranAt = Date.now();
  const demoSessionDates = {
    createdAt: new Date(ranAt - 2 * 24 * 60 * 60 * 1000),
    lastUsedAt: new Date(ranAt - 25 * 60 * 60 * 1000),
    expiresAt: new Date(ranAt - 24 * 60 * 60 * 1000),
  };
  const demoSession = await prisma.authSession.upsert({
    where: { id: devId('dev-auth-session-001') },
    update: demoSessionDates,
    create: {
      id: devId('dev-auth-session-001'),
      userId: user.id,
      tokenHash: createHash('sha256').update(randomBytes(32)).digest(),
      ...demoSessionDates,
    },
  });

  // ── Operador de plataforma (contraseña: password123 — solo dev) ─────────
  // Para trabajar la UI de /platform en local. En producción el primero se
  // crea con scripts/create-operator.ts; el guard de arriba lo cubre.
  await prisma.platformOperator.upsert({
    where: { email: 'operador@ficha.dev' },
    update: {},
    create: {
      email: 'operador@ficha.dev',
      passwordHash: hashedPassword,
      name: 'Operador Demo',
    },
  });

  // ── Paciente de prueba ────────────────────────────────────────────────────
  const patient = await prisma.patient.upsert({
    where: { id: devId('dev-patient-001') },
    update: {},
    create: {
      id: devId('dev-patient-001'),
      tenantId: tenant.id,
      fullName: 'María García',
      phone: '+54 11 1234-5678',
      sex: 'FEMALE',
      occupation: 'Docente',
    },
  });

  // ── Episodios clínicos del paciente de prueba ─────────────────────────────
  // Two problems treated in parallel (#238), both open: the back, and an
  // ankle sprain that started later. One session treats both, each with its
  // own block, so a new session can pick both too. A shoulder tendinitis from
  // the year before is the closed episode, with its discharge.
  const episode1 = await prisma.clinicalEpisode.upsert({
    where: { id: devId('dev-episode-001') },
    update: {},
    create: {
      id: devId('dev-episode-001'),
      tenantId: tenant.id,
      patientId: patient.id,
      status: 'ACTIVE',
      mainComplaint: 'Lumbalgia crónica',
      openedAt: new Date('2026-02-01T00:00:00.000Z'),
    },
  });

  const episodeAnkle = await prisma.clinicalEpisode.upsert({
    where: { id: devId('dev-episode-002') },
    update: {},
    create: {
      id: devId('dev-episode-002'),
      tenantId: tenant.id,
      patientId: patient.id,
      status: 'ACTIVE',
      mainComplaint: 'Esguince de tobillo derecho',
      openedAt: new Date('2026-02-20T00:00:00.000Z'),
    },
  });

  const episodeShoulder = await prisma.clinicalEpisode.upsert({
    where: { id: devId('dev-episode-003') },
    update: {},
    create: {
      id: devId('dev-episode-003'),
      tenantId: tenant.id,
      patientId: patient.id,
      status: 'DISCHARGED',
      mainComplaint: 'Tendinitis de hombro derecho',
      openedAt: new Date('2025-09-01T00:00:00.000Z'),
      closedAt: new Date('2025-10-15T10:00:00.000Z'),
    },
  });

  // ── Evaluación inicial del paciente de prueba ─────────────────────────────
  await prisma.initialEvaluation.upsert({
    where: { id: devId('dev-eval-001') },
    update: {},
    create: {
      id: devId('dev-eval-001'),
      tenantId: tenant.id,
      patientId: patient.id,
      episodeId: episode1.id,
      patientNarrative: 'Dolor lumbar desde hace meses, peor al estar sentada. Lo atribuye a la silla nueva del trabajo.',
    },
  });

  // ── Antecedentes ───────────────────────────────────────────────────────
  // Each kind of date: a year, a month (approximate, as "hace unos meses"
  // becomes), a day, and none.
  const mariaOwner = { tenantId: tenant.id, patientId: patient.id };
  await seedEvent(devId('dev-event-001'), mariaOwner, 'FRACTURE', 'Fractura de muñeca izquierda, tratada con yeso', {
    date: '2019-01-01',
    precision: 'YEAR',
  });
  await seedEvent(devId('dev-event-002'), mariaOwner, 'PAIN_ONSET', 'Dolor lumbar al estar sentada', {
    date: '2025-11-01',
    precision: 'MONTH',
    approximate: true,
  });
  await seedEvent(devId('dev-event-003'), mariaOwner, 'TRAUMA', 'Torcedura de tobillo derecho bajando una escalera', {
    date: '2026-02-20',
    precision: 'DAY',
  });
  await seedEvent(devId('dev-event-004'), mariaOwner, 'SURGERY', 'Cesárea', null);

  // ── Sesiones de ejemplo ────────────────────────────────────────────────
  // The shoulder and its discharge, the year before; then the back alone,
  // both open problems in one visit, the ankle alone, and a note that belongs
  // to no episode.
  const p1Sessions = [
    {
      id: devId('dev-session-005'),
      type: 'SESSION' as const,
      date: '2025-09-10T10:00:00.000Z',
      note: null,
      blocks: [
        {
          episodeId: episodeShoulder.id,
          preSessionState: 'Dolor de hombro derecho al levantar el brazo por encima de la cabeza.',
          treatment: 'Movilidad pasiva y activa asistida. Trabajo excéntrico de supraespinoso.',
          painScaleBefore: 6,
          painScaleAfter: 4,
          reEvaluationNotes: 'Arco doloroso entre 70° y 110° de abducción.',
          patientExercises: 'Péndulo de Codman 3 veces por día. Banda elástica en rotación externa.',
        },
      ],
    },
    {
      id: devId('dev-session-004'),
      type: 'DISCHARGE' as const,
      date: '2025-10-15T10:00:00.000Z',
      note: null,
      blocks: [
        {
          episodeId: episodeShoulder.id,
          preSessionState: 'Sin dolor de hombro en las actividades diarias.',
          treatment: 'Alta de la tendinitis: rango completo, sin arco doloroso.',
          painScaleBefore: 1,
          painScaleAfter: 0,
          reEvaluationNotes: 'Abducción completa sin dolor. Fuerza de rotadores conservada.',
          patientExercises: 'Mantener la banda elástica dos veces por semana.',
        },
      ],
    },
    {
      id: devId('dev-session-001'),
      type: 'SESSION' as const,
      date: '2026-02-10T10:00:00.000Z',
      note: null,
      blocks: [
        {
          episodeId: episode1.id,
          preSessionState: 'Paciente refiere dolor lumbar al estar sentada más de 30 minutos. Noches con dificultad para dormir de costado.',
          treatment: 'Se trabajó cadena posterior con postura en rana en el suelo, 20 minutos. Respiración diafragmática guiada.',
          painScaleBefore: 7,
          painScaleAfter: 4,
          reEvaluationNotes: 'Mejora leve en rango de flexión lumbar respecto a evaluación inicial. Persiste tensión en cadena posterior.',
          patientExercises: 'Rana en el suelo 10 minutos por día. Respiración diafragmática acostada antes de dormir.',
        },
      ],
    },
    {
      id: devId('dev-session-002'),
      type: 'SESSION' as const,
      date: '2026-02-24T10:00:00.000Z',
      note: null,
      blocks: [
        {
          episodeId: episode1.id,
          preSessionState: 'Mejoría notable de la espalda: el dolor aparece recién después de 1 hora sentada.',
          treatment: 'Rana en el suelo y parado en la pared, 30 minutos.',
          painScaleBefore: 5,
          painScaleAfter: 2,
          reEvaluationNotes: 'Flexión lumbar dentro de rangos normales. Reducción de hiperlordosis observable.',
          patientExercises: 'Parado en la pared 5 minutos, mañana y tarde. Seguir con la rana en el suelo.',
        },
        {
          episodeId: episodeAnkle.id,
          preSessionState: 'Llega rengueando: se torció el tobillo derecho bajando una escalera hace cuatro días.',
          treatment: 'Movilización suave y drenaje del tobillo, 20 minutos.',
          painScaleBefore: 6,
          painScaleAfter: 4,
          reEvaluationNotes: 'Edema leve en maléolo externo. Dorsiflexión limitada por dolor. Sin inestabilidad.',
          patientExercises: 'Hielo 15 minutos tres veces por día. Movilidad activa de tobillo sin carga.',
        },
      ],
    },
    {
      id: devId('dev-session-003'),
      type: 'SESSION' as const,
      date: '2026-03-03T10:00:00.000Z',
      note: null,
      blocks: [
        {
          episodeId: episodeAnkle.id,
          preSessionState: 'Viene solo por el tobillo: la espalda está tranquila esta semana.',
          treatment: 'Propiocepción en superficie estable, fortalecimiento de peroneos con banda elástica.',
          painScaleBefore: 3,
          painScaleAfter: 1,
          reEvaluationNotes: 'Edema resuelto. Dorsiflexión completa. Apoyo monopodal 20 segundos.',
          patientExercises: 'Apoyo monopodal 3 series de 30 segundos. Banda elástica para eversión.',
        },
      ],
    },
    {
      id: devId('dev-note-001'),
      type: 'NOTE' as const,
      date: '2026-03-19T15:00:00.000Z',
      note: 'Llamó para avisar que viaja dos semanas. Retoma la lumbalgia a la vuelta.',
      blocks: [],
    },
  ];

  for (const s of p1Sessions) {
    const session = await prisma.session.upsert({
      where: { id: s.id },
      update: {},
      create: {
        id: s.id,
        tenantId: tenant.id,
        patientId: patient.id,
        userId: user.id,
        sessionType: s.type,
        sessionDate: new Date(s.date),
        // The text of a note; everything clinical about a problem is in its block.
        observations: s.note,
      },
    });
    for (const { episodeId, ...fields } of s.blocks) {
      await seedBlock(session, episodeId, fields);
    }
  }

  // ── Registros de auditoría de ejemplo ──────────────────────────────────
  // Codes only, checked against the catalog (SPEC-audit-structured-entries.md).
  const demoAudit = { tenantId: tenant.id, userId: user.id, authSessionId: demoSession.id };
  await seedAuditRows([
    { ...demoAudit, id: devId('dev-audit-001'), patientId: patient.id, entity: 'PATIENT', entityId: patient.id, action: 'PATIENT_CREATED', params: {}, createdAt: new Date('2026-02-01T09:00:00.000Z') },
    { ...demoAudit, id: devId('dev-audit-002'), patientId: patient.id, entity: 'EVALUATION', entityId: devId('dev-eval-001'), action: 'EVALUATION_CREATED', params: {}, createdAt: new Date('2026-02-01T09:30:00.000Z') },
    { ...demoAudit, id: devId('dev-audit-003'), patientId: patient.id, entity: 'SESSION', entityId: devId('dev-session-001'), action: 'SESSION_RECORDED', params: {}, createdAt: new Date('2026-02-10T10:30:00.000Z') },
    { ...demoAudit, id: devId('dev-audit-004'), patientId: patient.id, entity: 'SESSION', entityId: devId('dev-session-002'), action: 'SESSION_RECORDED', params: {}, createdAt: new Date('2026-02-24T10:30:00.000Z') },
    { ...demoAudit, id: devId('dev-audit-005'), patientId: patient.id, entity: 'SESSION', entityId: devId('dev-session-003'), action: 'SESSION_RECORDED', params: {}, createdAt: new Date('2026-03-03T10:30:00.000Z') },
    { ...demoAudit, id: devId('dev-audit-006'), patientId: patient.id, entity: 'SESSION', entityId: devId('dev-session-004'), action: 'DISCHARGE_RECORDED', params: {}, createdAt: new Date('2025-10-15T10:30:00.000Z') },
    { ...demoAudit, id: devId('dev-audit-007'), patientId: patient.id, entity: 'SESSION', entityId: devId('dev-note-001'), action: 'NOTE_RECORDED', params: {}, createdAt: new Date('2026-03-19T15:05:00.000Z') },
    { ...demoAudit, id: devId('dev-audit-008'), patientId: patient.id, entity: 'SESSION', entityId: devId('dev-session-005'), action: 'SESSION_RECORDED', params: {}, createdAt: new Date('2025-09-10T10:30:00.000Z') },
  ]);

  // ── Alertas clínicas de ejemplo ────────────────────────────────────────
  await prisma.clinicalAlert.upsert({
    where: { id: devId('dev-alert-001') },
    update: {},
    create: {
      id: devId('dev-alert-001'),
      tenantId: tenant.id,
      patientId: patient.id,
      type: 'FOLLOW_UP',
      message: 'María García lleva 30 días sin sesión — agendar seguimiento',
      createdAt: new Date('2026-03-24T08:00:00.000Z'),
    },
  });

  await prisma.clinicalAlert.upsert({
    where: { id: devId('dev-alert-002') },
    update: {},
    create: {
      id: devId('dev-alert-002'),
      tenantId: tenant.id,
      patientId: patient.id,
      type: 'PAYMENT',
      message: 'María García tiene 1 cobro pendiente',
      createdAt: new Date('2026-03-20T08:00:00.000Z'),
    },
  });

  // ════════════════════════════════════════════════════════════════════════
  // PACIENTE DEMO 2 — Javier Rodríguez
  // Historia clínica completa: cervicalgia crónica + hernia C5-C6
  // Abarca: evaluación extendida, 8 sesiones, 3 escalas NDI,
  //         consentimiento, paquete + cobros, alertas y auditoría.
  // ════════════════════════════════════════════════════════════════════════

  const p2 = await prisma.patient.upsert({
    where: { id: devId('dev-patient-002') },
    update: {},
    create: {
      id: devId('dev-patient-002'),
      tenantId: tenant.id,
      fullName: 'Javier Rodríguez',
      birthDate: new Date('1980-08-15'),
      sex: 'MALE',
      phone: '+54 11 4567-8901',
      occupation: 'Programador (trabajo remoto)',
      referringDoctor: 'Dr. Carlos Méndez (traumatología)',
      insuranceName: 'OSDE',
      insuranceNumber: '1234567-08',
      insurancePlan: 'Plan 210',
    },
  });

  // ── Episodio clínico ─────────────────────────────────────────────────────
  const episodeP2 = await prisma.clinicalEpisode.upsert({
    where: { id: devId('dev-episode-p2-001') },
    update: {},
    create: {
      id: devId('dev-episode-p2-001'),
      tenantId: tenant.id,
      patientId: p2.id,
      status: 'ACTIVE',
      mainComplaint: 'Cervicalgia bilateral con irradiación a hombros y brazos. Cefaleas tensionales 3–4 veces por semana.',
      openedAt: new Date('2025-12-05T00:00:00.000Z'),
    },
  });

  // ── Evaluación inicial ───────────────────────────────────────────────────
  await prisma.initialEvaluation.upsert({
    where: { id: devId('dev-eval-002') },
    update: {},
    create: {
      id: devId('dev-eval-002'),
      tenantId: tenant.id,
      patientId: p2.id,
      episodeId: episodeP2.id,
      patientNarrative:
        'Cervicalgia bilateral con irradiación a hombros y brazos. Cefaleas tensionales 3–4 veces por semana. Los síntomas empeoran al final de la jornada laboral frente a la pantalla.',
      otherHistory: 'Hipertensión arterial controlada con enalapril. Sedentario. 12 años de trabajo de oficina.',
      retractionMap: [
        {
          id: 'rm-1',
          x: 50,
          y: 12,
          label: 'Contractura trapecio bilateral',
          severity: 'high',
          notes: 'Bilateral, más marcada a derecha. Trigger points activos.',
          view: 'back',
        },
        {
          id: 'rm-2',
          x: 50,
          y: 8,
          label: 'Tensión suboccipital',
          severity: 'medium',
          notes: 'Genera cefalea occipital. Restricción en flexo-extensión C0-C1.',
          view: 'back',
        },
        {
          id: 'rm-3',
          x: 50,
          y: 14,
          label: 'Retracción cadena anterior tórax',
          severity: 'medium',
          notes: 'Pectorales menores acortados. Contribuyen a la protracción escapular.',
          view: 'front',
        },
      ],
      flexibilityNotes:
        'Isquiotibiales cortos: test dedos-suelo −15 cm. Rotación cervical D: 45° / I: 40° (reducida). Flexión cervical limitada, mentón–esternón 3 dedos. Rotadores externos de cadera acortados.',
      evaluatedAt: new Date('2025-12-05T09:30:00.000Z'),
    },
  });

  // ── Antecedentes ─────────────────────────────────────────────────────────
  const javierOwner = { tenantId: tenant.id, patientId: p2.id };
  await seedEvent(devId('dev-event-101'), javierOwner, 'DIAGNOSIS', 'Hernia discal C5-C6 leve, confirmada por RMN', {
    date: '2024-02-01',
    precision: 'MONTH',
  });
  await seedEvent(devId('dev-event-102'), javierOwner, 'PAIN_ONSET', 'Cervicalgia con cefaleas tensionales', {
    date: '2025-06-01',
    precision: 'MONTH',
    approximate: true,
  });
  await seedEvent(devId('dev-event-103'), javierOwner, 'SURGERY', 'Apendicectomía', {
    date: '2010-01-01',
    precision: 'YEAR',
    approximate: true,
  });

  // ── Consentimiento informado ─────────────────────────────────────────────
  await prisma.informedConsent.upsert({
    where: { patientId: p2.id },
    update: {},
    create: {
      id: devId('dev-consent-002'),
      tenantId: tenant.id,
      patientId: p2.id,
      signed: true,
      signedAt: new Date('2025-12-05T09:00:00.000Z'),
    },
  });

  // ── Paquete de sesiones ──────────────────────────────────────────────────
  const pkg2 = await prisma.sessionPackage.upsert({
    where: { id: devId('dev-pkg-p2-001') },
    update: {},
    create: {
      id: devId('dev-pkg-p2-001'),
      tenantId: tenant.id,
      patientId: p2.id,
      name: 'Paquete 8 sesiones RPG',
      totalSessions: 8,
      pricePerSessionCents: 750_000,
      notes: 'Precio acordado en diciembre 2025. Incluye reevaluación sin costo adicional.',
      createdAt: new Date('2025-12-01T00:00:00.000Z'),
    },
  });

  // ── 8 Sesiones de tratamiento ────────────────────────────────────────────
  const sessionsP2 = [
    {
      id: devId('dev-session-p2-001'),
      date: '2025-12-05T10:00:00.000Z',
      painBefore: 8,
      painAfter: 5,
      preSesion:
        'Primera sesión de tratamiento. Paciente refiere dolor cervical 8/10, irradiación a brazo derecho. Noche previa sin poder dormir de costado.',
      reevalNotes:
        'Posturas adoptadas típicas de usuario de computadora. Observación de patrón respiratorio torácico superior en reposo.',
      exercises:
        'Sentado en silla 5 minutos en cada pausa del trabajo. Respiración diafragmática 3 veces por día.',
      obs: 'Postura sentado en silla con foco en debloqueo del diafragma. Trabajo de conciencia propioceptiva cervical. Tiempo total: 45 min.',
      type: 'SESSION' as const,
    },
    {
      id: devId('dev-session-p2-002'),
      date: '2025-12-12T10:00:00.000Z',
      painBefore: 7,
      painAfter: 4,
      preSesion:
        'Refiere leve mejoría en cefaleas (solo 2 episodios en la semana). Dolor cervical persiste al final del día de trabajo.',
      reevalNotes:
        'Mejora incipiente en amplitud de rotación cervical izquierda (+5°). Hombros ligeramente menos elevados.',
      exercises: 'Respiración diafragmática 10 minutos sostenidos, una vez por día.',
      obs: 'Postura sentado en silla + introducción de rana en el suelo para cadena posterior. Corrección de posición escapular.',
      type: 'SESSION' as const,
    },
    {
      id: devId('dev-session-p2-003'),
      date: '2026-01-09T10:00:00.000Z',
      painBefore: 6,
      painAfter: 3,
      preSesion:
        'Pasó vacaciones de verano. Refiere que caminó y estuvo menos frente a la pantalla: notó clara mejoría. Retomó trabajo y en 3 días volvió el dolor.',
      reevalNotes:
        'Reevaluación programada (3ª sesión). Rotación cervical D: 52° / I: 48°. Mejora objetivable en postura de cabeza (+2 cm).',
      exercises: 'Sumar la rana en el suelo 10 minutos, día por medio.',
      obs: 'Postura rana en el suelo foco lumbar + sentado en silla. Se explicó la correlación postura laboral–síntomas cervicales.',
      type: 'SESSION' as const,
    },
    {
      id: devId('dev-session-p2-004'),
      date: '2026-01-16T10:00:00.000Z',
      painBefore: 5,
      painAfter: 2,
      preSesion:
        'Sin cefaleas en la semana. Dolor cervical solo aparece al final de jornadas > 8 horas de pantalla. Duerme bien.',
      reevalNotes:
        'Posición de cabeza corregida ~3 cm respecto a inicial. Protracción escapular reducida visiblemente.',
      exercises: 'Mantener la rutina. Cuidar la postura cervical frente a la pantalla.',
      obs: 'Parado en la pared + rana en el suelo. Incorporación de autopostura diaria de 5 min indicada como tarea.',
      type: 'SESSION' as const,
    },
    {
      id: devId('dev-session-p2-005'),
      date: '2026-01-23T10:00:00.000Z',
      painBefore: 5,
      painAfter: 5,
      preSesion:
        'Episodio de reagudización por reunión con mucho stress laboral (8 horas frente a pantalla sin pausas). Decide venir igual.',
      reevalNotes: null,
      exercises: null,
      obs: 'NOTA CLÍNICA: Episodio de reagudización leve asociado a estrés laboral y uso prolongado de pantalla. Se refuerza educación postural y se indica pausas activas cada 45 min. No se realizó postura por tensión muscular elevada.',
      type: 'NOTE' as const,
    },
    {
      id: devId('dev-session-p2-006'),
      date: '2026-01-30T10:00:00.000Z',
      painBefore: 5,
      painAfter: 2,
      preSesion: 'Recuperado del episodio. Cumplió con las pausas activas indicadas. Cierre del Ciclo 1.',
      reevalNotes:
        'Reevaluación cierre ciclo 1. Rotación cervical D: 60° / I: 55° (dentro de rangos normales). Test dedos-suelo: −8 cm (↑7 cm). NDI a reevaluar hoy.',
      exercises: 'Parado en la pared 5 minutos al terminar la jornada.',
      obs: 'Sesión de cierre de ciclo 1. Postura parado en la pared + sentado en silla. Reevaluación completa. Se planifica ciclo 2 de mantenimiento.',
      type: 'SESSION' as const,
    },
    {
      id: devId('dev-session-p2-007'),
      date: '2026-02-06T10:00:00.000Z',
      painBefore: 3,
      painAfter: 1,
      preSesion: 'Inicio de ciclo 2. Sin cefaleas en las últimas 2 semanas. Dolor cervical esporádico.',
      reevalNotes: 'Postura laboral mejorada según autoreporte. Continúa con pausas activas diarias.',
      exercises: 'Rutina completa en casa: rana en el suelo, parado en la pared y sentado en silla.',
      obs: 'Rana en el aire + parado en la pared. Incorporación de cadena maestra anterior. Foco en estabilización.',
      type: 'SESSION' as const,
    },
    {
      id: devId('dev-session-p2-008'),
      date: '2026-03-06T10:00:00.000Z',
      painBefore: 3,
      painAfter: 1,
      preSesion: 'Sin cefaleas hace 5 semanas. Dolor solo en contexto de jornadas excepcionales > 10 horas.',
      reevalNotes:
        'Rotación cervical D: 65° / I: 60° (supranormal). Cabeza en plomada. Postura de trabajo corregida. NDI a reevaluar.',
      exercises: 'Rutina de mantenimiento dos veces por semana.',
      obs: 'Rana en el aire + sentado en silla. Refuerzo de autoposturas para alta progresiva. Se plantea espaciar sesiones a mensual.',
      type: 'SESSION' as const,
    },
  ];

  const createdSessionsP2: { id: string; sessionDate: Date }[] = [];
  for (const s of sessionsP2) {
    const session = await prisma.session.upsert({
      where: { id: s.id },
      update: {},
      create: {
        id: s.id,
        tenantId: tenant.id,
        patientId: p2.id,
        userId: user.id,
        sessionType: s.type,
        sessionDate: new Date(s.date),
        // A note keeps its text; a session's treatment is its block's.
        observations: s.type === 'NOTE' ? s.obs : null,
      },
    });
    await seedBlock(session, episodeP2.id, {
      preSessionState: s.preSesion,
      treatment: s.type === 'NOTE' ? null : s.obs,
      painScaleBefore: s.painBefore,
      painScaleAfter: s.painAfter,
      reEvaluationNotes: s.reevalNotes,
      patientExercises: s.exercises,
    });
    createdSessionsP2.push({ id: session.id, sessionDate: session.sessionDate });
  }

  // ── Pagos por sesión (7 pagados, 1 pendiente) ────────────────────────────
  const paymentsP2 = [
    { id: devId('dev-pay-p2-001'), sessionId: devId('dev-session-p2-001'), status: 'PAID',    paidAt: '2025-12-05T11:00:00.000Z', method: 'TRANSFER' },
    { id: devId('dev-pay-p2-002'), sessionId: devId('dev-session-p2-002'), status: 'PAID',    paidAt: '2025-12-12T11:00:00.000Z', method: 'TRANSFER' },
    { id: devId('dev-pay-p2-003'), sessionId: devId('dev-session-p2-003'), status: 'PAID',    paidAt: '2026-01-09T11:00:00.000Z', method: 'CASH' },
    { id: devId('dev-pay-p2-004'), sessionId: devId('dev-session-p2-004'), status: 'PAID',    paidAt: '2026-01-16T11:00:00.000Z', method: 'TRANSFER' },
    { id: devId('dev-pay-p2-005'), sessionId: devId('dev-session-p2-005'), status: 'PAID',    paidAt: '2026-01-23T11:00:00.000Z', method: 'CASH' },
    { id: devId('dev-pay-p2-006'), sessionId: devId('dev-session-p2-006'), status: 'PAID',    paidAt: '2026-01-30T11:00:00.000Z', method: 'TRANSFER' },
    { id: devId('dev-pay-p2-007'), sessionId: devId('dev-session-p2-007'), status: 'PAID',    paidAt: '2026-02-06T11:00:00.000Z', method: 'TRANSFER' },
    { id: devId('dev-pay-p2-008'), sessionId: devId('dev-session-p2-008'), status: 'PENDING', paidAt: null,                       method: null },
  ] as const;

  for (const p of paymentsP2) {
    await prisma.payment.upsert({
      where: { id: p.id },
      update: {},
      create: {
        id: p.id,
        tenantId: tenant.id,
        patientId: p2.id,
        sessionId: p.sessionId,
        packageId: pkg2.id,
        baseAmountCents: 750_000,
        discountCents: 0,
        finalAmountCents: 750_000,
        status: p.status,
        method: p.method ?? undefined,
        paidAt: p.paidAt ? new Date(p.paidAt) : undefined,
      },
    });
  }

  // ── Escalas NDI (3 mediciones — muestra progresión) ──────────────────────
  //  Fórmula: score = round((sum / (n * 5)) * 100)
  //  Escala 1 — 2025-12-05: sum=30/50 → 60% — Discapacidad completa
  //  Escala 2 — 2026-01-30: sum=18/50 → 36% — Discapacidad completa (mejoría significativa)
  //  Escala 3 — 2026-03-06: sum= 9/50 → 18% — Discapacidad moderada (meta casi lograda)
  const scalesP2 = [
    {
      id: devId('dev-scale-p2-001'),
      appliedAt: '2025-12-05T09:30:00.000Z',
      responses: { q1: 4, q2: 3, q3: 3, q4: 4, q5: 4, q6: 3, q7: 3, q8: 2, q9: 3, q10: 1 },
      score: 60,
      interpretation: 'Discapacidad completa (≥35%)',
    },
    {
      id: devId('dev-scale-p2-002'),
      appliedAt: '2026-01-30T10:30:00.000Z',
      responses: { q1: 2, q2: 2, q3: 2, q4: 2, q5: 3, q6: 2, q7: 2, q8: 1, q9: 2, q10: 0 },
      score: 36,
      interpretation: 'Discapacidad completa (≥35%)',
    },
    {
      id: devId('dev-scale-p2-003'),
      appliedAt: '2026-03-06T10:30:00.000Z',
      responses: { q1: 1, q2: 1, q3: 1, q4: 1, q5: 2, q6: 1, q7: 1, q8: 0, q9: 1, q10: 0 },
      score: 18,
      interpretation: 'Discapacidad moderada (15–24%)',
    },
  ];

  for (const sc of scalesP2) {
    await prisma.functionalScale.upsert({
      where: { id: sc.id },
      update: {},
      create: {
        id: sc.id,
        tenantId: tenant.id,
        patientId: p2.id,
        episodeId: episodeP2.id,
        scaleType: 'NDI',
        responses: sc.responses,
        score: sc.score,
        interpretation: sc.interpretation,
        appliedAt: new Date(sc.appliedAt),
      },
    });
  }

  // ── Auditoría ────────────────────────────────────────────────────────────
  const auditLogsP2 = [
    { id: devId('dev-audit-p2-001'), entity: 'PATIENT', entityId: p2.id, action: 'PATIENT_CREATED', params: {}, date: '2025-12-01T09:00:00.000Z' },
    { id: devId('dev-audit-p2-002'), entity: 'CONSENT', entityId: devId('dev-consent-002'), action: 'CONSENT_SIGNED', params: {}, date: '2025-12-05T09:00:00.000Z' },
    { id: devId('dev-audit-p2-003'), entity: 'EVALUATION', entityId: devId('dev-eval-002'), action: 'EVALUATION_CREATED', params: {}, date: '2025-12-05T09:30:00.000Z' },
    { id: devId('dev-audit-p2-004'), entity: 'SESSION', entityId: devId('dev-session-p2-001'), action: 'SESSION_RECORDED', params: {}, date: '2025-12-05T11:00:00.000Z' },
    { id: devId('dev-audit-p2-005'), entity: 'SCALE', entityId: devId('dev-scale-p2-001'), action: 'SCALE_APPLIED', params: { scaleType: 'NDI' }, date: '2025-12-05T09:35:00.000Z' },
    { id: devId('dev-audit-p2-006'), entity: 'SESSION', entityId: devId('dev-session-p2-002'), action: 'SESSION_RECORDED', params: {}, date: '2025-12-12T11:00:00.000Z' },
    { id: devId('dev-audit-p2-007'), entity: 'SESSION', entityId: devId('dev-session-p2-003'), action: 'SESSION_RECORDED', params: {}, date: '2026-01-09T11:00:00.000Z' },
    { id: devId('dev-audit-p2-008'), entity: 'SESSION', entityId: devId('dev-session-p2-004'), action: 'SESSION_RECORDED', params: {}, date: '2026-01-16T11:00:00.000Z' },
    { id: devId('dev-audit-p2-009'), entity: 'SESSION', entityId: devId('dev-session-p2-005'), action: 'NOTE_RECORDED', params: {}, date: '2026-01-23T11:00:00.000Z' },
    { id: devId('dev-audit-p2-010'), entity: 'SESSION', entityId: devId('dev-session-p2-006'), action: 'SESSION_RECORDED', params: {}, date: '2026-01-30T11:00:00.000Z' },
    { id: devId('dev-audit-p2-011'), entity: 'SCALE', entityId: devId('dev-scale-p2-002'), action: 'SCALE_APPLIED', params: { scaleType: 'NDI' }, date: '2026-01-30T10:35:00.000Z' },
    { id: devId('dev-audit-p2-012'), entity: 'SESSION', entityId: devId('dev-session-p2-007'), action: 'SESSION_RECORDED', params: {}, date: '2026-02-06T11:00:00.000Z' },
    { id: devId('dev-audit-p2-013'), entity: 'SESSION', entityId: devId('dev-session-p2-008'), action: 'SESSION_RECORDED', params: {}, date: '2026-03-06T11:00:00.000Z' },
    { id: devId('dev-audit-p2-014'), entity: 'SCALE', entityId: devId('dev-scale-p2-003'), action: 'SCALE_APPLIED', params: { scaleType: 'NDI' }, date: '2026-03-06T10:35:00.000Z' },
    { id: devId('dev-audit-p2-015'), entity: 'EVALUATION', entityId: devId('dev-eval-002'), action: 'EVALUATION_UPDATED', params: { changedFields: ['evaScale', 'notes'] }, date: '2026-01-30T10:00:00.000Z' },
  ] as const;

  await seedAuditRows(
    auditLogsP2.map((log) => ({
      ...demoAudit,
      id: log.id,
      patientId: p2.id,
      entity: log.entity,
      entityId: log.entityId,
      action: log.action,
      params: log.params,
      createdAt: new Date(log.date),
    })),
  );

  console.log('✓ Seed completado');
  console.log(`  Tenant:    ${tenant.name} (slug: ${tenant.slug})`);
  console.log(`  Usuario:   ${user.email} / password123`);
  console.log(`  Paciente 1: ${patient.fullName} — episodio ${episode1.id}`);
  console.log(`  Paciente 2: ${p2.fullName} — episodio ${episodeP2.id} (historia clínica completa)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
