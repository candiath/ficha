import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../middlewares/requireRole';
import { tenantRepo } from '../repositories';

// Configuración de la clínica. Leerla la puede cualquier usuario autenticado
// —la pantalla de Clínica es para todos—, pero editarla es solo de ADMIN, así
// que requireRole va en el handler del PATCH y no al montar el router.
const router = Router();

// "HH:mm" en 24 horas. Se guarda como string y no como Int de minutos porque
// es lo que el <input type="time"> del navegador manda y espera: convertir de
// ida y vuelta en cada punta agrega una traducción sin comprarnos nada.
const TimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'La hora debe tener el formato HH:mm');

// Un identificador IANA cualquiera sirve mientras el runtime lo entienda; la
// lista completa cambia con las versiones de ICU, así que se le pregunta a
// Intl en vez de mantener un enum que envejece.
function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Un string vacío desde un formulario significa "sin dato", no "guardá una
// cadena vacía": se normaliza a null para que la app tenga una sola forma de
// preguntar si el campo está cargado.
const OptionalText = z
  .string()
  .trim()
  .max(200)
  .nullable()
  .optional()
  .transform((v) => (v === '' ? null : v));

// CUIT argentino: 11 dígitos. Se valida el formato y se normaliza a
// XX-XXXXXXXX-X para que se muestre igual sin importar cómo se haya tipeado.
// El dígito verificador NO se valida: hoy este dato solo se muestra, y cuando
// haya facturación de verdad va a necesitar bastante más que un check digit.
const CuitSchema = z
  .string()
  .trim()
  .nullable()
  .optional()
  .transform((v) => (v === '' ? null : v))
  .refine((v) => v == null || /^\d{11}$/.test(v.replace(/\D/g, '')), {
    error: 'El CUIT debe tener 11 dígitos',
  })
  .transform((v) => {
    if (v == null) return v;
    const d = v.replace(/\D/g, '');
    return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`;
  });

const TenantUpdateSchema = z
  .object({
    // El slug no está: es un identificador, no un dato de contacto. Cambiarlo
    // no debería ser un renombre casual desde un formulario.
    name: z.string().trim().min(2, 'El nombre debe tener al menos 2 caracteres').optional(),
    email: z
      .union([z.literal(''), z.email('Email inválido')])
      .nullable()
      .optional()
      .transform((v) => (v === '' ? null : v)),
    phone: OptionalText,
    address: OptionalText,
    cuit: CuitSchema,
    specialty: OptionalText,
    timezone: z
      .string()
      .refine(isValidTimeZone, { error: 'Zona horaria desconocida' })
      .optional(),
    workdayStart: TimeSchema.optional(),
    workdayEnd: TimeSchema.optional(),
    workdays: z
      .array(z.number().int().min(0).max(6))
      .min(1, 'Elegí al menos un día de atención')
      .max(7)
      // Días repetidos no significan nada y ensucian el render de la agenda.
      .refine((d) => new Set(d).size === d.length, { error: 'Hay días repetidos' })
      .transform((d) => [...d].sort((a, b) => a - b))
      .optional(),
  })
  // Solo se puede comparar cuando vienen los dos: un PATCH que manda uno solo
  // se valida contra lo guardado, más abajo en el handler.
  .refine((d) => !d.workdayStart || !d.workdayEnd || d.workdayStart < d.workdayEnd, {
    error: 'El horario de cierre tiene que ser posterior al de apertura',
    path: ['workdayEnd'],
  });

// GET /api/tenant — configuración de la clínica del usuario autenticado.
router.get('/', async (req, res) => {
  const data = await tenantRepo.get(req.context);
  res.json({ data });
});

// PATCH /api/tenant — solo ADMIN.
router.patch('/', requireRole('ADMIN'), async (req, res) => {
  const body = TenantUpdateSchema.parse(req.body);

  // El schema solo puede comparar apertura y cierre cuando llegan juntos. Si
  // vino uno solo, el otro sale de lo guardado: mandar únicamente
  // workdayStart: "22:00" sobre un cierre de 20:00 dejaría un horario que
  // termina antes de empezar.
  if (body.workdayStart !== undefined || body.workdayEnd !== undefined) {
    const actual = await tenantRepo.get(req.context);
    const desde = body.workdayStart ?? actual.workdayStart;
    const hasta = body.workdayEnd ?? actual.workdayEnd;
    if (desde >= hasta) {
      res.status(400).json({
        error: 'El horario de cierre tiene que ser posterior al de apertura',
      });
      return;
    }
  }

  const data = await tenantRepo.update(req.context, body);
  res.json({ data });
});

export default router;
