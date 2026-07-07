import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // ── Catálogo global de cadenas musculares (Método Souchard / RPG) ────────
  await Promise.all([
    prisma.muscularChain.upsert({ where: { id: 'mc-respiratoria' }, update: {}, create: { id: 'mc-respiratoria', name: 'Cadena Respiratoria Estática', description: 'Músculos inspiratorios de la caja torácica que fijan la respiración en inspiración' } }),
    prisma.muscularChain.upsert({ where: { id: 'mc-inspiratoria' }, update: {}, create: { id: 'mc-inspiratoria', name: 'Cadena Inspiratoria', description: 'Escalenos, intercostales y serrato; mantiene expansión torácica' } }),
    prisma.muscularChain.upsert({ where: { id: 'mc-anterior-brazo' }, update: {}, create: { id: 'mc-anterior-brazo', name: 'Cadena Anterior del Brazo', description: 'Cadena flexora anterior del miembro superior' } }),
    prisma.muscularChain.upsert({ where: { id: 'mc-posterior-brazo' }, update: {}, create: { id: 'mc-posterior-brazo', name: 'Cadena Posterior del Brazo', description: 'Cadena extensora posterior del miembro superior' } }),
    prisma.muscularChain.upsert({ where: { id: 'mc-maestra-anterior' }, update: {}, create: { id: 'mc-maestra-anterior', name: 'Cadena Maestra Anterior', description: 'Gran cadena flexora anterior del tronco y miembros inferiores' } }),
    prisma.muscularChain.upsert({ where: { id: 'mc-maestra-posterior' }, update: {}, create: { id: 'mc-maestra-posterior', name: 'Cadena Maestra Posterior', description: 'Gran cadena extensora posterior; paravertebrales, glúteos e isquiotibiales' } }),
  ]);

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

  // ── Guardia de producción ────────────────────────────────────────────────
  // En producción solo se siembran los catálogos globales de arriba.
  // El tenant demo, el usuario admin@ficha.dev/password123 y los pacientes
  // de ejemplo son EXCLUSIVAMENTE de desarrollo: sembrar una credencial
  // conocida en producción sería una puerta trasera.
  if (process.env.NODE_ENV === 'production') {
    console.log('✓ Seed completado (solo catálogos globales)');
    console.log('  NODE_ENV=production: no se crean tenant, usuario ni datos demo.');
    return;
  }

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

  // ── Episodio clínico del paciente de prueba ───────────────────────────────
  const episode1 = await prisma.clinicalEpisode.upsert({
    where: { id: 'dev-episode-001' },
    update: {},
    create: {
      id: 'dev-episode-001',
      tenantId: tenant.id,
      patientId: patient.id,
      status: 'ACTIVE',
      mainComplaint: 'Dolor lumbar crónico y contracturas cervicales',
      openedAt: new Date('2026-02-01T00:00:00.000Z'),
    },
  });

  // ── Evaluación inicial del paciente de prueba ─────────────────────────────
  await prisma.initialEvaluation.upsert({
    where: { id: 'dev-eval-001' },
    update: {},
    create: {
      id: 'dev-eval-001',
      tenantId: tenant.id,
      patientId: patient.id,
      episodeId: episode1.id,
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
      episodes: { create: { episode: { connect: { id: episode1.id } } } },
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
      episodes: { create: { episode: { connect: { id: episode1.id } } } },
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

  // ════════════════════════════════════════════════════════════════════════
  // PACIENTE DEMO 2 — Javier Rodríguez
  // Historia clínica completa: cervicalgia crónica + hernia C5-C6
  // Abarca: evaluación extendida, 8 sesiones, 3 escalas NDI,
  //         consentimiento, paquete + cobros, alertas y auditoría.
  // ════════════════════════════════════════════════════════════════════════

  const p2 = await prisma.patient.upsert({
    where: { id: 'dev-patient-002' },
    update: {},
    create: {
      id: 'dev-patient-002',
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
    where: { id: 'dev-episode-p2-001' },
    update: {},
    create: {
      id: 'dev-episode-p2-001',
      tenantId: tenant.id,
      patientId: p2.id,
      status: 'ACTIVE',
      mainComplaint: 'Cervicalgia bilateral con irradiación a hombros y brazos. Cefaleas tensionales 3–4 veces por semana.',
      openedAt: new Date('2025-12-05T00:00:00.000Z'),
    },
  });

  // ── Evaluación inicial ───────────────────────────────────────────────────
  await prisma.initialEvaluation.upsert({
    where: { id: 'dev-eval-002' },
    update: {},
    create: {
      id: 'dev-eval-002',
      tenantId: tenant.id,
      patientId: p2.id,
      episodeId: episodeP2.id,
      reasonForConsultation:
        'Cervicalgia bilateral con irradiación a hombros y brazos. Cefaleas tensionales 3–4 veces por semana. Los síntomas empeoran al final de la jornada laboral frente a la pantalla.',
      medicalHistory:
        'Hernia discal C5-C6 leve confirmada por RMN (febrero 2024). Sin cirugías previas. Hipertensión arterial controlada con enalapril. Sedentario. 12 años de trabajo de oficina.',
      globalPosture:
        'Hipercifosis dorsal marcada. Cabeza adelantada ~5 cm respecto a la plomada de referencia. Hombros caídos hacia adelante con protracción escapular bilateral. Ligera escoliosis funcional lumbar hacia la derecha.',
      breathingPattern:
        'Respiración torácica superficial. Escasa participación diafragmática. Tendencia a retener el aliento durante el trabajo de concentración.',
      morphotype: 'Tipo cifo-lordótico con proyección anterior de cabeza',
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
      footEvaluation:
        'Pie plano grado I bilateral con pronación leve. No compensaciones posturales significativas desde pie.',
      breathingPatternDetail: 'costal_superior',
      flexibilityNotes:
        'Isquiotibiales cortos: test dedos-suelo −15 cm. Rotación cervical D: 45° / I: 40° (reducida). Flexión cervical limitada, mentón–esternón 3 dedos. Rotadores externos de cadera acortados.',
      evaluatedAt: new Date('2025-12-05T09:30:00.000Z'),
    },
  });

  // ── Consentimiento informado ─────────────────────────────────────────────
  await prisma.informedConsent.upsert({
    where: { patientId: p2.id },
    update: {},
    create: {
      id: 'dev-consent-002',
      tenantId: tenant.id,
      patientId: p2.id,
      signed: true,
      signedAt: new Date('2025-12-05T09:00:00.000Z'),
    },
  });

  // ── Paquete de sesiones ──────────────────────────────────────────────────
  const pkg2 = await prisma.sessionPackage.upsert({
    where: { id: 'dev-pkg-p2-001' },
    update: {},
    create: {
      id: 'dev-pkg-p2-001',
      tenantId: tenant.id,
      patientId: p2.id,
      name: 'Paquete 8 sesiones RPG',
      totalSessions: 8,
      pricePerSession: 7500,
      notes: 'Precio acordado en diciembre 2025. Incluye reevaluación sin costo adicional.',
      createdAt: new Date('2025-12-01T00:00:00.000Z'),
    },
  });

  // ── 8 Sesiones de tratamiento ────────────────────────────────────────────
  const sessionsP2 = [
    {
      id: 'dev-session-p2-001',
      date: '2025-12-05T10:00:00.000Z',
      painBefore: 8,
      painAfter: 5,
      preSesion:
        'Primera sesión de tratamiento. Paciente refiere dolor cervical 8/10, irradiación a brazo derecho. Noche previa sin poder dormir de costado.',
      reevalNotes:
        'Posturas adoptadas típicas de usuario de computadora. Observación de patrón respiratorio torácico superior en reposo.',
      response:
        'Buena predisposición. Se sorprendió con la intensidad de la postura sentado en silla. Costo respiratorio elevado al inicio.',
      obs: 'Postura sentado en silla con foco en debloqueo del diafragma. Trabajo de conciencia propioceptiva cervical. Tiempo total: 45 min.',
      type: 'SESSION' as const,
    },
    {
      id: 'dev-session-p2-002',
      date: '2025-12-12T10:00:00.000Z',
      painBefore: 7,
      painAfter: 4,
      preSesion:
        'Refiere leve mejoría en cefaleas (solo 2 episodios en la semana). Dolor cervical persiste al final del día de trabajo.',
      reevalNotes:
        'Mejora incipiente en amplitud de rotación cervical izquierda (+5°). Hombros ligeramente menos elevados.',
      response: 'Mejor tolerancia a la postura. Logra mantener respiración diafragmática 10 minutos sostenidos.',
      obs: 'Postura sentado en silla + introducción de rana en el suelo para cadena posterior. Corrección de posición escapular.',
      type: 'SESSION' as const,
    },
    {
      id: 'dev-session-p2-003',
      date: '2026-01-09T10:00:00.000Z',
      painBefore: 6,
      painAfter: 3,
      preSesion:
        'Pasó vacaciones de verano. Refiere que caminó y estuvo menos frente a la pantalla: notó clara mejoría. Retomó trabajo y en 3 días volvió el dolor.',
      reevalNotes:
        'Reevaluación programada (3ª sesión). Rotación cervical D: 52° / I: 48°. Mejora objetivable en postura de cabeza (+2 cm).',
      response: 'Excelente respuesta. Incorpora rana en el suelo con mayor facilidad. Refiere sentir el debloqueo.',
      obs: 'Postura rana en el suelo foco lumbar + sentado en silla. Se explicó la correlación postura laboral–síntomas cervicales.',
      type: 'SESSION' as const,
    },
    {
      id: 'dev-session-p2-004',
      date: '2026-01-16T10:00:00.000Z',
      painBefore: 5,
      painAfter: 2,
      preSesion:
        'Sin cefaleas en la semana. Dolor cervical solo aparece al final de jornadas > 8 horas de pantalla. Duerme bien.',
      reevalNotes:
        'Posición de cabeza corregida ~3 cm respecto a inicial. Protracción escapular reducida visiblemente.',
      response: 'Motivado por la evolución. Refiere que su pareja notó el cambio postural.',
      obs: 'Parado en la pared + rana en el suelo. Incorporación de autopostura diaria de 5 min indicada como tarea.',
      type: 'SESSION' as const,
    },
    {
      id: 'dev-session-p2-005',
      date: '2026-01-23T10:00:00.000Z',
      painBefore: 5,
      painAfter: 5,
      preSesion:
        'Episodio de reagudización por reunión con mucho stress laboral (8 horas frente a pantalla sin pausas). Decide venir igual.',
      reevalNotes: null,
      response: null,
      obs: 'NOTA CLÍNICA: Episodio de reagudización leve asociado a estrés laboral y uso prolongado de pantalla. Se refuerza educación postural y se indica pausas activas cada 45 min. No se realizó postura por tensión muscular elevada.',
      type: 'NOTE' as const,
    },
    {
      id: 'dev-session-p2-006',
      date: '2026-01-30T10:00:00.000Z',
      painBefore: 5,
      painAfter: 2,
      preSesion: 'Recuperado del episodio. Cumplió con las pausas activas indicadas. Cierre del Ciclo 1.',
      reevalNotes:
        'Reevaluación cierre ciclo 1. Rotación cervical D: 60° / I: 55° (dentro de rangos normales). Test dedos-suelo: −8 cm (↑7 cm). NDI a reevaluar hoy.',
      response: 'Muy contento con la evolución. Comprometido a continuar.',
      obs: 'Sesión de cierre de ciclo 1. Postura parado en la pared + sentado en silla. Reevaluación completa. Se planifica ciclo 2 de mantenimiento.',
      type: 'SESSION' as const,
    },
    {
      id: 'dev-session-p2-007',
      date: '2026-02-06T10:00:00.000Z',
      painBefore: 3,
      painAfter: 1,
      preSesion: 'Inicio de ciclo 2. Sin cefaleas en las últimas 2 semanas. Dolor cervical esporádico.',
      reevalNotes: 'Postura laboral mejorada según autoreporte. Continúa con pausas activas diarias.',
      response: 'Tolerancia excelente a todas las posturas. Maneja respiración diafragmática de forma autónoma.',
      obs: 'Rana en el aire + parado en la pared. Incorporación de cadena maestra anterior. Foco en estabilización.',
      type: 'SESSION' as const,
    },
    {
      id: 'dev-session-p2-008',
      date: '2026-03-06T10:00:00.000Z',
      painBefore: 3,
      painAfter: 1,
      preSesion: 'Sin cefaleas hace 5 semanas. Dolor solo en contexto de jornadas excepcionales > 10 horas.',
      reevalNotes:
        'Rotación cervical D: 65° / I: 60° (supranormal). Cabeza en plomada. Postura de trabajo corregida. NDI a reevaluar.',
      response: 'Refiere haber recuperado calidad de vida. Trabaja más cómodo y con más energía al final del día.',
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
        episodes: { create: { episode: { connect: { id: episodeP2.id } } } },
        sessionType: s.type,
        sessionDate: new Date(s.date),
        painScaleBefore: s.painBefore,
        painScaleAfter: s.painAfter,
        preSesionState: s.preSesion,
        reEvaluationNotes: s.reevalNotes,
        patientResponse: s.response,
        observations: s.obs,
      },
    });
    createdSessionsP2.push({ id: session.id, sessionDate: session.sessionDate });
  }

  // ── Técnicas aplicadas ──────────────────────────────────────────────────
  const techniquesP2 = [
    // Sesión 1
    { id: 'dev-st-p2-001', sessionId: 'dev-session-p2-001', techniqueId: 'tech-sentado',      bodyRegionId: 'br-cervical', chainId: 'mc-respiratoria',   notes: '45 min, debloqueo diafragma, conciencia cervical' },
    // Sesión 2
    { id: 'dev-st-p2-002', sessionId: 'dev-session-p2-002', techniqueId: 'tech-sentado',      bodyRegionId: 'br-cervical', chainId: 'mc-respiratoria',   notes: '30 min, foco escapular' },
    { id: 'dev-st-p2-003', sessionId: 'dev-session-p2-002', techniqueId: 'tech-rana-suelo',   bodyRegionId: 'br-lumbar',   chainId: 'mc-maestra-posterior', notes: '15 min, introducción' },
    // Sesión 3
    { id: 'dev-st-p2-004', sessionId: 'dev-session-p2-003', techniqueId: 'tech-rana-suelo',   bodyRegionId: 'br-lumbar',   chainId: 'mc-maestra-posterior', notes: '25 min, mayor soltura' },
    { id: 'dev-st-p2-005', sessionId: 'dev-session-p2-003', techniqueId: 'tech-sentado',      bodyRegionId: 'br-cervical', chainId: 'mc-respiratoria',   notes: '20 min' },
    // Sesión 4
    { id: 'dev-st-p2-006', sessionId: 'dev-session-p2-004', techniqueId: 'tech-parado',       bodyRegionId: 'br-dorsal',   chainId: 'mc-maestra-anterior', notes: '30 min, corrección hipercifosis' },
    { id: 'dev-st-p2-007', sessionId: 'dev-session-p2-004', techniqueId: 'tech-rana-suelo',   bodyRegionId: 'br-cadera',   chainId: 'mc-maestra-posterior', notes: '15 min' },
    // Sesión 6 (sesión 5 es NOTE — sin técnicas)
    { id: 'dev-st-p2-008', sessionId: 'dev-session-p2-006', techniqueId: 'tech-parado',       bodyRegionId: 'br-cervical', chainId: 'mc-maestra-anterior', notes: '30 min, cierre ciclo 1' },
    { id: 'dev-st-p2-009', sessionId: 'dev-session-p2-006', techniqueId: 'tech-sentado',      bodyRegionId: 'br-cervical', chainId: 'mc-respiratoria',   notes: '20 min, reevaluación postural' },
    // Sesión 7
    { id: 'dev-st-p2-010', sessionId: 'dev-session-p2-007', techniqueId: 'tech-rana-aire',    bodyRegionId: 'br-cadera',   chainId: 'mc-maestra-anterior', notes: '30 min, cadena anterior' },
    { id: 'dev-st-p2-011', sessionId: 'dev-session-p2-007', techniqueId: 'tech-parado',       bodyRegionId: 'br-dorsal',   chainId: 'mc-maestra-anterior', notes: '15 min, estabilización' },
    // Sesión 8
    { id: 'dev-st-p2-012', sessionId: 'dev-session-p2-008', techniqueId: 'tech-rana-aire',    bodyRegionId: 'br-cadera',   chainId: 'mc-maestra-anterior', notes: '25 min' },
    { id: 'dev-st-p2-013', sessionId: 'dev-session-p2-008', techniqueId: 'tech-sentado',      bodyRegionId: 'br-cervical', chainId: 'mc-inspiratoria',   notes: '20 min, trabajo respiratorio final' },
  ];

  for (const t of techniquesP2) {
    await prisma.sessionTechnique.upsert({
      where: { id: t.id },
      update: {},
      create: {
        id: t.id,
        sessionId: t.sessionId,
        techniqueId: t.techniqueId,
        bodyRegionId: t.bodyRegionId,
        muscularChainId: t.chainId,
        variantNotes: t.notes,
      },
    });
  }

  // ── Pagos por sesión (7 pagados, 1 pendiente) ────────────────────────────
  const paymentsP2 = [
    { id: 'dev-pay-p2-001', sessionId: 'dev-session-p2-001', status: 'PAID',    paidAt: '2025-12-05T11:00:00.000Z', method: 'TRANSFER' },
    { id: 'dev-pay-p2-002', sessionId: 'dev-session-p2-002', status: 'PAID',    paidAt: '2025-12-12T11:00:00.000Z', method: 'TRANSFER' },
    { id: 'dev-pay-p2-003', sessionId: 'dev-session-p2-003', status: 'PAID',    paidAt: '2026-01-09T11:00:00.000Z', method: 'CASH' },
    { id: 'dev-pay-p2-004', sessionId: 'dev-session-p2-004', status: 'PAID',    paidAt: '2026-01-16T11:00:00.000Z', method: 'TRANSFER' },
    { id: 'dev-pay-p2-005', sessionId: 'dev-session-p2-005', status: 'PAID',    paidAt: '2026-01-23T11:00:00.000Z', method: 'CASH' },
    { id: 'dev-pay-p2-006', sessionId: 'dev-session-p2-006', status: 'PAID',    paidAt: '2026-01-30T11:00:00.000Z', method: 'TRANSFER' },
    { id: 'dev-pay-p2-007', sessionId: 'dev-session-p2-007', status: 'PAID',    paidAt: '2026-02-06T11:00:00.000Z', method: 'TRANSFER' },
    { id: 'dev-pay-p2-008', sessionId: 'dev-session-p2-008', status: 'PENDING', paidAt: null,                       method: null },
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
        baseAmount: 7500,
        discount: 0,
        finalAmount: 7500,
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
      id: 'dev-scale-p2-001',
      appliedAt: '2025-12-05T09:30:00.000Z',
      responses: { q1: 4, q2: 3, q3: 3, q4: 4, q5: 4, q6: 3, q7: 3, q8: 2, q9: 3, q10: 1 },
      score: 60,
      interpretation: 'Discapacidad completa (≥35%)',
    },
    {
      id: 'dev-scale-p2-002',
      appliedAt: '2026-01-30T10:30:00.000Z',
      responses: { q1: 2, q2: 2, q3: 2, q4: 2, q5: 3, q6: 2, q7: 2, q8: 1, q9: 2, q10: 0 },
      score: 36,
      interpretation: 'Discapacidad completa (≥35%)',
    },
    {
      id: 'dev-scale-p2-003',
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
    { id: 'dev-audit-p2-001', entity: 'PATIENT',    entityId: p2.id,                  action: 'CREATED', description: 'Paciente Javier Rodríguez registrado',               date: '2025-12-01T09:00:00.000Z' },
    { id: 'dev-audit-p2-002', entity: 'CONSENT',    entityId: 'dev-consent-002',       action: 'CREATED', description: 'Consentimiento informado firmado',                    date: '2025-12-05T09:00:00.000Z' },
    { id: 'dev-audit-p2-003', entity: 'EVALUATION', entityId: 'dev-eval-002',          action: 'CREATED', description: 'Evaluación inicial registrada',                       date: '2025-12-05T09:30:00.000Z' },
    { id: 'dev-audit-p2-004', entity: 'SESSION',    entityId: 'dev-session-p2-001',    action: 'CREATED', description: 'Sesión registrada — EVA 8→5',                         date: '2025-12-05T11:00:00.000Z' },
    { id: 'dev-audit-p2-005', entity: 'EVALUATION', entityId: 'dev-scale-p2-001',      action: 'CREATED', description: 'Escala NDI aplicada — score 60%',                     date: '2025-12-05T09:35:00.000Z' },
    { id: 'dev-audit-p2-006', entity: 'SESSION',    entityId: 'dev-session-p2-002',    action: 'CREATED', description: 'Sesión registrada — EVA 7→4',                         date: '2025-12-12T11:00:00.000Z' },
    { id: 'dev-audit-p2-007', entity: 'SESSION',    entityId: 'dev-session-p2-003',    action: 'CREATED', description: 'Sesión registrada — EVA 6→3',                         date: '2026-01-09T11:00:00.000Z' },
    { id: 'dev-audit-p2-008', entity: 'SESSION',    entityId: 'dev-session-p2-004',    action: 'CREATED', description: 'Sesión registrada — EVA 5→2',                         date: '2026-01-16T11:00:00.000Z' },
    { id: 'dev-audit-p2-009', entity: 'SESSION',    entityId: 'dev-session-p2-005',    action: 'CREATED', description: 'Nota clínica — reagudización por sobrecarga laboral', date: '2026-01-23T11:00:00.000Z' },
    { id: 'dev-audit-p2-010', entity: 'SESSION',    entityId: 'dev-session-p2-006',    action: 'CREATED', description: 'Sesión cierre ciclo 1 — EVA 5→2',                     date: '2026-01-30T11:00:00.000Z' },
    { id: 'dev-audit-p2-011', entity: 'EVALUATION', entityId: 'dev-scale-p2-002',      action: 'CREATED', description: 'Escala NDI aplicada — score 36%',                     date: '2026-01-30T10:35:00.000Z' },
    { id: 'dev-audit-p2-012', entity: 'SESSION',    entityId: 'dev-session-p2-007',    action: 'CREATED', description: 'Sesión inicio ciclo 2 — EVA 3→1',                     date: '2026-02-06T11:00:00.000Z' },
    { id: 'dev-audit-p2-013', entity: 'SESSION',    entityId: 'dev-session-p2-008',    action: 'CREATED', description: 'Sesión registrada — EVA 3→1',                         date: '2026-03-06T11:00:00.000Z' },
    { id: 'dev-audit-p2-014', entity: 'EVALUATION', entityId: 'dev-scale-p2-003',      action: 'CREATED', description: 'Escala NDI aplicada — score 18%',                     date: '2026-03-06T10:35:00.000Z' },
    { id: 'dev-audit-p2-015', entity: 'EVALUATION', entityId: 'dev-eval-002',          action: 'UPDATED', description: 'Mapa de retracciones actualizado con evolución',       date: '2026-01-30T10:00:00.000Z' },
  ] as const;

  for (const log of auditLogsP2) {
    await prisma.auditLog.upsert({
      where: { id: log.id },
      update: {},
      create: {
        id: log.id,
        tenantId: tenant.id,
        patientId: p2.id,
        userId: user.id,
        entity: log.entity,
        entityId: log.entityId,
        action: log.action,
        description: log.description,
        createdAt: new Date(log.date),
      },
    });
  }

  console.log('✓ Seed completado');
  console.log(`  Tenant:    ${tenant.name} (slug: ${tenant.slug})`);
  console.log(`  Usuario:   ${user.email} / password123`);
  console.log(`  Paciente 1: ${patient.fullName} — episodio ${episode1.id}`);
  console.log(`  Paciente 2: ${p2.fullName} — episodio ${episodeP2.id} (historia clínica completa)`);
  console.log(`  Regiones corporales: ${bodyRegions.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
