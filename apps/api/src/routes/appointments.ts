import { Router } from 'express';
import { z } from 'zod';
import {
  addClinicDays,
  addMinutes,
  CLINIC_DATE_RE,
  CLINIC_TIME_RE,
  clinicDayRange,
  clinicTimeToInstant,
  instantToClinicTime,
} from '../lib/clinicTime';
import {
  appointmentRepo,
  clinicalAlertRepo,
  episodeRepo,
  patientRepo,
  tenantRepo,
} from '../repositories';
import type { AppointmentDTO } from '../repositories/appointmentRepository';

const router = Router();

// Días que puede pedir la agenda de una vez. Una vista mensual necesita ~42
// (seis semanas de grilla); el tope está para que nadie se traiga la agenda
// entera de un año en una sola query, no para molestar al uso normal.
const MAX_RANGO_DIAS = 62;

// Cooldown de la alerta de inasistencia, para que marcar y desmarcar el
// estado no genere una alerta por click.
const ALERTA_COOLDOWN_DIAS = 7;

// Un tratamiento de RPG largo son ~20 sesiones semanales. El tope alto está
// para que un `occurrences: 5000` no escriba cinco mil filas en una
// transacción.
const MAX_OCURRENCIAS = 52;

const FechaSchema = z.string().regex(CLINIC_DATE_RE, 'La fecha debe ser YYYY-MM-DD');
const HoraSchema = z.string().regex(CLINIC_TIME_RE, 'La hora debe ser HH:mm');

const RangoSchema = z
  .object({ from: FechaSchema, to: FechaSchema })
  .refine((r) => r.from <= r.to, {
    error: 'El fin del rango no puede ser anterior al inicio',
    path: ['to'],
  })
  .refine(
    (r) => (Date.parse(`${r.to}T00:00:00Z`) - Date.parse(`${r.from}T00:00:00Z`)) / 86_400_000 < MAX_RANGO_DIAS,
    { error: `El rango no puede superar los ${MAX_RANGO_DIAS} días`, path: ['to'] },
  );

const CreateSchema = z.object({
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  // Hora de pared de la clínica, no un instante: el cliente no debería tener
  // que conocer la zona horaria para agendar. La conversión pasa acá.
  date: FechaSchema,
  time: HoraSchema,
  durationMinutes: z.number().int().min(5).max(480),
  // Los turnos recurrentes se materializan como filas independientes que
  // comparten un seriesId. No se guarda la regla: no hace falta para nada de
  // lo que la app necesita, y una regla guardada obliga a decidir qué pasa
  // cuando una ocurrencia se mueve.
  repeat: z
    .object({
      everyWeeks: z.number().int().min(1).max(4),
      occurrences: z.number().int().min(2).max(MAX_OCURRENCIAS),
    })
    .optional(),
});

const UpdateSchema = z.object({
  date: FechaSchema.optional(),
  time: HoraSchema.optional(),
  durationMinutes: z.number().int().min(5).max(480).optional(),
  status: z.enum(['SCHEDULED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']).optional(),
  episodeId: z.string().uuid().optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

/**
 * El turno tal como lo consume la app: el instante, y además la hora de pared
 * de la clínica ya resuelta.
 *
 * La redundancia es deliberada. El cliente necesita saber en qué casilla de la
 * grilla va cada turno, y hacer esa conversión en el navegador significaría
 * reimplementar la zona horaria de la clínica ahí — con el detalle de que la
 * zona del navegador puede no ser la misma.
 */
function serialize(a: AppointmentDTO, timezone: string) {
  const inicio = instantToClinicTime(new Date(a.startsAt), timezone);
  const fin = instantToClinicTime(new Date(a.endsAt), timezone);
  return { ...a, date: inicio.date, startTime: inicio.time, endTime: fin.time };
}

// GET /api/appointments?from=YYYY-MM-DD&to=YYYY-MM-DD
// Ambos inclusive, en días de la clínica.
router.get('/', async (req, res) => {
  const { from, to } = RangoSchema.parse({ from: req.query.from, to: req.query.to });
  const { timezone } = await tenantRepo.get(req.context);

  const { desde, hasta } = clinicDayRange(from, to, timezone);
  const turnos = await appointmentRepo.listInRange(req.context, desde, hasta);

  res.json({ data: turnos.map((t) => serialize(t, timezone)) });
});

// POST /api/appointments — uno solo, o una serie si viene `repeat`.
router.post('/', async (req, res) => {
  const body = CreateSchema.parse(req.body);

  // Paciente del tenant y vigente: la política vive en patientRepo.
  if (!(await patientRepo.exists(req.context, body.patientId))) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  // El episodio, si vino, tiene que ser de ese paciente. Sin esto se podría
  // agendar un turno contra el motivo de consulta de otro.
  if (
    body.episodeId &&
    !(await episodeRepo.exists(req.context, body.patientId, body.episodeId))
  ) {
    res.status(400).json({ error: 'Episodio inexistente o de otro paciente' });
    return;
  }

  const { timezone } = await tenantRepo.get(req.context);

  // Cada ocurrencia se calcula sobre la FECHA y se convierte por separado, no
  // sumando semanas a un instante: así "todos los martes a las 9" son las 9
  // aunque en el medio cambie el horario de verano.
  const veces = body.repeat?.occurrences ?? 1;
  const cadaDias = (body.repeat?.everyWeeks ?? 1) * 7;

  const slots = Array.from({ length: veces }, (_, i) => {
    const fecha = addClinicDays(body.date, i * cadaDias);
    const startsAt = clinicTimeToInstant(fecha, body.time, timezone);
    return { startsAt, endsAt: addMinutes(startsAt, body.durationMinutes) };
  });

  const creados = await appointmentRepo.create(req.context, {
    patientId: body.patientId,
    episodeId: body.episodeId,
    notes: body.notes,
    slots,
  });

  res.status(201).json({ data: creados.map((t) => serialize(t, timezone)) });
});

// PATCH /api/appointments/:id — reprogramar, cambiar estado o notas.
router.patch('/:id', async (req, res) => {
  const body = UpdateSchema.parse(req.body);
  const { timezone } = await tenantRepo.get(req.context);

  // Mover un turno necesita la fecha, la hora y la duración juntas, y el PATCH
  // es parcial: lo que no venga sale de lo guardado.
  let horario: { startsAt: Date; endsAt: Date } | undefined;
  if (body.date !== undefined || body.time !== undefined || body.durationMinutes !== undefined) {
    const actual = await appointmentRepo.getById(req.context, req.params.id);
    if (!actual) {
      res.status(404).json({ error: 'Turno no encontrado' });
      return;
    }

    const previo = instantToClinicTime(new Date(actual.startsAt), timezone);
    const duracionPrevia =
      (Date.parse(actual.endsAt) - Date.parse(actual.startsAt)) / 60_000;

    const startsAt = clinicTimeToInstant(
      body.date ?? previo.date,
      body.time ?? previo.time,
      timezone,
    );
    horario = {
      startsAt,
      endsAt: addMinutes(startsAt, body.durationMinutes ?? duracionPrevia),
    };
  }

  // null = inexistente o de otra clínica: mismo 404, sin revelar cuál.
  const turno = await appointmentRepo.update(req.context, req.params.id, {
    ...horario,
    status: body.status,
    episodeId: body.episodeId,
    notes: body.notes,
  });

  if (!turno) {
    res.status(404).json({ error: 'Turno no encontrado' });
    return;
  }

  // Faltar sin avisar es, por fin, algo que se puede saber: hasta que existió
  // la agenda no había turno al que faltar, y por eso la alerta de
  // inactividad se retipó a FOLLOW_UP en #111 dejando NO_SHOW libre.
  //
  // Fire-and-forget como el resto de las alertas y la auditoría: que falle
  // registrarla no debe hacer fallar el cambio de estado, que es lo que el
  // usuario pidió.
  if (body.status === 'NO_SHOW') {
    const desde = new Date();
    desde.setDate(desde.getDate() - ALERTA_COOLDOWN_DIAS);
    const inicio = instantToClinicTime(new Date(turno.startsAt), timezone);

    clinicalAlertRepo
      .hasRecentUnread(req.context, turno.patientId, 'NO_SHOW', desde)
      .then((yaHay) => {
        if (yaHay) return;
        return clinicalAlertRepo.create(req.context, {
          patientId: turno.patientId,
          type: 'NO_SHOW',
          message: `Faltó sin avisar al turno del ${inicio.date} a las ${inicio.time}.`,
        });
      })
      .catch((err) => console.error('[alerta no-show]', err));
  }

  res.json({ data: serialize(turno, timezone) });
});

// POST /api/appointments/:id/cancel-series
// Cancela los turnos de la misma serie que todavía no ocurrieron. El caso: un
// tratamiento de diez sesiones que se suspende en la tercera.
router.post('/:id/cancel-series', async (req, res) => {
  const turno = await appointmentRepo.getById(req.context, req.params.id);

  if (!turno) {
    res.status(404).json({ error: 'Turno no encontrado' });
    return;
  }

  if (!turno.seriesId) {
    res.status(400).json({ error: 'Este turno no es parte de una serie' });
    return;
  }

  // Desde ahora y no desde el turno: cancelar "lo que queda" es lo que queda
  // por delante, no lo que sigue a un turno que quizás ya pasó.
  const cancelados = await appointmentRepo.cancelSeriesFrom(
    req.context,
    turno.seriesId,
    new Date(),
  );

  res.json({ data: { cancelled: cancelados } });
});

export default router;
