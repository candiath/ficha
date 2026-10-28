// Every GET route outside a patient's record, classified (#186,
// docs/specs/SPEC-list-minimization.md §6). Routes under
// /api/patients/:patientId (and /api/patients/:id) are the record itself and
// need no entry. Every other GET is one of:
//
// - probed: it spans patients. tests/listMinimization.test.ts calls it
//   against a clinic whose clinical columns all hold markers, checks that no
//   marker comes back, and pins the exact keys of every item to `shape`.
//   `allow` names the paths where clinical-looking text is accepted, each one
//   a decision recorded in the spec.
// - exempt: it does not span patients' clinical data, with the reason.
//
// Adding a field to a probed route, or classifying a new GET as exempt, is a
// reviewed change to this file (the spec's "ask first").

// The keys of a response item. `true` is a scalar (or null); an object is a
// nested object (or null); `[shape]` is an array of objects with that shape.
export type Shape = { [key: string]: true | Shape | [Shape] };

export type ListScope =
  | { scope: 'probed'; shape: Shape; allow: string[] }
  | { scope: 'exempt'; reason: string };

const probed = (shape: Shape, allow: string[] = []): ListScope => ({ scope: 'probed', shape, allow });
const exempt = (reason: string): ListScope => ({ scope: 'exempt', reason });

const PATIENT_REF = { id: true, fullName: true } as const;

export const LIST_SCOPE: Record<string, ListScope> = {
  'GET /health': exempt('Database ping and build marker: no data.'),

  // ── Clinic-wide lists: no clinical text ──────────────────────────────────
  'GET /api/sessions': probed({
    id: true,
    sessionType: true,
    sessionDate: true,
    createdAt: true,
    updatedAt: true,
    patient: PATIENT_REF,
  }),
  'GET /api/appointments': probed({
    id: true,
    patientId: true,
    patientName: true,
    userId: true,
    episodeId: true,
    sessionId: true,
    seriesId: true,
    startsAt: true,
    endsAt: true,
    status: true,
    cancelledAt: true,
    date: true,
    startTime: true,
    endTime: true,
  }),
  'GET /api/alerts': probed({
    id: true,
    patientId: true,
    patientName: true,
    type: true,
    // Engine messages carry no clinical text; custom ones are the user's
    // reminder, with a hint in the form (Decision 3).
    message: true,
    isRead: true,
    readAt: true,
    createdAt: true,
  }),
  'GET /api/payments': probed({
    id: true,
    patientId: true,
    sessionId: true,
    packageId: true,
    baseAmountCents: true,
    discountCents: true,
    finalAmountCents: true,
    status: true,
    method: true,
    paidAt: true,
    // Administrative free text, kept with a hint in the form (Decision 3).
    notes: true,
    createdAt: true,
    updatedAt: true,
    patient: PATIENT_REF,
    session: { id: true, sessionDate: true, sessionType: true },
    package: { id: true, name: true },
  }),
  'GET /api/patients': probed(
    {
      id: true,
      firstName: true,
      lastName: true,
      fullName: true,
      birthDate: true,
      sex: true,
      phone: true,
      occupation: true,
      referringDoctor: true,
      insuranceName: true,
      insuranceNumber: true,
      insurancePlan: true,
      createdAt: true,
      updatedAt: true,
    },
    // Administrative, kept in the list (Decision 2).
    ['[].referringDoctor'],
  ),
  'GET /api/dashboard/stats': probed(
    {
      activePatients: true,
      totalSessions: true,
      sessionsThisMonth: true,
      pendingPayments: true,
      pathologies: [{ name: true, count: true }],
      sessionsByMonth: [{ month: true, count: true }],
    },
    // An aggregate that names no patient (Decision 1).
    ['pathologies[].name'],
  ),

  // ── Not spanning patients' clinical data ─────────────────────────────────
  'GET /api/alerts/stats': exempt('Unread counts by type.'),
  'GET /api/appointments/:id': exempt('One appointment, of one patient: no clinical text, and its notes are administrative.'),
  'GET /api/packages': exempt('Requires ?patientId: one patient\'s packages.'),
  'GET /api/payments/last-base-price': exempt('One amount.'),
  'GET /api/tenant': exempt('The clinic\'s own configuration.'),
  'GET /api/users': exempt('The clinic\'s staff: no patients.'),
  'GET /api/auth/me': exempt('The signed-in user.'),
  'GET /api/auth/devices': exempt('The signed-in user\'s own sessions.'),

  // The platform operator sees no clinical data: platformRepository never
  // joins a clinical table.
  'GET /api/platform/auth/me': exempt('The signed-in operator.'),
  'GET /api/platform/tenants': exempt('Clinics, for the operator.'),
  'GET /api/platform/tenants/:tenantId/users': exempt('A clinic\'s staff, for the operator.'),
  'GET /api/platform/tenants/:tenantId/audit-log': exempt('Operator actions on a clinic: codes and ids.'),
  'GET /api/platform/alerts': exempt('Sysadmin alerts: kinds and delivery outcomes.'),
  'GET /api/platform/alerts/bot': exempt('The Telegram bot\'s username.'),
};
