import { z } from 'zod';

// The catalog of audit actions (#186, docs/specs/SPEC-audit-structured-entries.md).
//
// An audit row records what happened as codes: an action, the entity and its
// id, and a few parameters that are themselves codes. It never stores a
// sentence: the screens build one from here. The API validates every row
// against this catalog before writing it (strict), and every reader parses
// what it reads leniently, parameter by parameter, because a row is never
// rewritten and may come from an older or a newer version of this file.
//
// Codes are permanent. Once a release has written an action, a parameter or a
// parameter value, it is never renamed, reused or removed: a replaced action is
// marked `deprecated` (it keeps a wording and can no longer be written), and the
// value lists below only grow. Adding is always allowed.

// ─── Parameter values (append-only) ─────────────────────────────────────────
//
// The catalog's own lists, separate from the domain enums and from request
// validation: a value the domain drops still renders in the rows that name it.
// tests/auditCatalog.test.ts checks that every value of the mirrored Prisma
// enum is here.

// No Prisma enum since the functional scales were removed (2026-10-27): kept
// for the SCALE_APPLIED rows.
export const AUDIT_SCALE_TYPES = {
  OSWESTRY: 'Oswestry (ODI)',
  NDI: 'Neck Disability Index (NDI)',
} as const;

export const AUDIT_SESSION_TYPES = {
  SESSION: 'sesión',
  NOTE: 'nota clínica',
  DISCHARGE: 'alta',
} as const;

export const AUDIT_PAYMENT_STATUSES = {
  PENDING: 'pendiente',
  PAID: 'pagado',
  WAIVED: 'eximido',
} as const;

// What kind of thing the patient lived: an entry of her history (#238).
export const AUDIT_PATIENT_EVENT_KINDS = {
  FRACTURE: 'fractura',
  SURGERY: 'cirugía',
  TRAUMA: 'traumatismo',
  DIAGNOSIS: 'diagnóstico',
  PAIN_ONSET: 'inicio del dolor',
  OTHER: 'otro',
} as const;

// The status an episode was closed with (EPISODE_CLOSED). ACTIVE is not one:
// reopening is an action of its own.
export const AUDIT_EPISODE_STATUSES = {
  DISCHARGED: 'alta',
  ABANDONED: 'abandono',
} as const;

// The status an appointment was left in (APPOINTMENT_UPDATED), in the words of
// the agenda.
export const AUDIT_APPOINTMENT_STATUSES = {
  SCHEDULED: 'agendado',
  CONFIRMED: 'confirmado',
  COMPLETED: 'atendido',
  CANCELLED: 'cancelado',
  NO_SHOW: 'no asistió',
} as const;

// What annulling a session did to its payment (SESSION_ANNULLED): a pending or
// waived one is deleted with it, and a paid one refuses the annulment.
export const AUDIT_ANNULLED_SESSION_PAYMENTS = {
  NONE: 'sin cobro',
  PENDING_DELETED: 'se eliminó su cobro pendiente',
  WAIVED_DELETED: 'se eliminó su cobro eximido',
} as const;

// Why a clinical record was corrected or annulled (SPEC-clinical-revisions.md
// §4). Attached to each *_UPDATED and annulment action in the step that
// versions its aggregate: the catalog validates strictly, so a parameter is
// required from the commit that adds it. The form preselects DATA_ENTRY_ERROR.
export const AUDIT_REVISION_REASONS = {
  DATA_ENTRY_ERROR: 'error de confección',
  LATE_INFORMATION: 'información recibida después',
  CLARIFICATION: 'aclaración',
  OTHER: 'otro motivo',
} as const;

// "ADMIN" is the word the whole platform screen uses ("Sin ADMIN", "Crear ADMIN").
export const AUDIT_ROLES = {
  ADMIN: 'ADMIN',
  THERAPIST: 'fisioterapeuta',
} as const;

// ─── Field names (append-only) ──────────────────────────────────────────────
//
// What an update may list in `changedFields`: the API's field names, never a
// value. A JSON column is one name, and so is a relation set.

export const AUDIT_PATIENT_FIELDS = {
  firstName: 'el nombre',
  lastName: 'el apellido',
  birthDate: 'la fecha de nacimiento',
  sex: 'el sexo',
  phone: 'el teléfono',
  occupation: 'la ocupación',
  referringDoctor: 'el médico derivante',
  insuranceName: 'la obra social',
  insuranceNumber: 'el número de afiliado',
  insurancePlan: 'el plan de la obra social',
} as const;

export const AUDIT_EVALUATION_FIELDS = {
  patientNarrative: 'el relato del paciente',
  otherHistory: 'los otros antecedentes',
  notes: 'las notas',
  retractionMap: 'el mapa de retracciones',
  physicalActivity: 'la actividad física',
  painFrequency: 'la frecuencia del dolor',
  evaScale: 'la escala EVA',
} as const;

export const AUDIT_SESSION_FIELDS = {
  sessionType: 'el tipo',
  sessionDate: 'la fecha',
  episodeIds: 'los motivos de consulta',
  preSessionState: 'el estado previo',
  treatment: 'el tratamiento',
  reEvaluationNotes: 'la reevaluación',
  patientExercises: 'los ejercicios',
  painScaleBefore: 'el dolor al inicio',
  painScaleAfter: 'el dolor al final',
  observations: 'la nota',
} as const;

export const AUDIT_PATIENT_EVENT_FIELDS = {
  kind: 'el tipo',
  description: 'la descripción',
  occurred: 'la fecha',
} as const;

// A correction of an episode (EPISODE_UPDATED): never its status, whose
// changes are EPISODE_CLOSED and EPISODE_REOPENED. The opening date is not
// editable yet.
export const AUDIT_EPISODE_FIELDS = {
  mainComplaint: 'el motivo de consulta',
  closedAt: 'la fecha de cierre',
} as const;

// startsAt and endsAt are the stored columns: moving an appointment names both,
// and changing only its length names endsAt.
export const AUDIT_APPOINTMENT_FIELDS = {
  startsAt: 'el inicio',
  endsAt: 'el fin',
  status: 'el estado',
  episodeId: 'el motivo de consulta',
  notes: 'las notas',
} as const;

export const AUDIT_PAYMENT_FIELDS = {
  baseAmountCents: 'el monto',
  discountCents: 'el descuento',
  status: 'el estado',
  method: 'el medio de pago',
  paidAt: 'la fecha de pago',
  packageId: 'el paquete',
  notes: 'las notas',
} as const;

// ─── Parameter definitions ──────────────────────────────────────────────────

type Labels = Readonly<Record<string, string>>;

// A parameter is a code from a list, or a list of field names. Nothing else:
// that is also all the database check (audit_params_are_codes) accepts.
export type AuditParamDef =
  | { readonly type: 'code'; readonly values: Labels }
  | { readonly type: 'fields'; readonly values: Labels };

const code = <V extends Labels>(values: V) => ({ type: 'code', values }) as const;
const fields = <V extends Labels>(values: V) => ({ type: 'fields', values }) as const;

type ParamShape = Readonly<Record<string, AuditParamDef>>;

type ParamValue<D extends AuditParamDef> = D extends { type: 'code'; values: infer V }
  ? keyof V & string
  : D extends { type: 'fields'; values: infer V }
    ? (keyof V & string)[]
    : never;

/** What a writer passes: every parameter, valid. */
export type AuditParamsOf<S extends ParamShape> = { [K in keyof S]: ParamValue<S[K]> };

/** What a reader gets: whatever parsed. A row may predate a parameter. */
export type AuditReadParamsOf<S extends ParamShape> = Partial<AuditParamsOf<S>>;

export type AuditEntity =
  | 'PATIENT'
  | 'EVALUATION'
  | 'SCALE'
  | 'SESSION'
  | 'PAYMENT'
  | 'CONSENT'
  | 'PATIENT_EVENT'
  | 'EPISODE'
  | 'APPOINTMENT'
  | 'PACKAGE';

// The object a platform_audit_logs row acted on, when it is neither the clinic
// (tenant_id) nor a user (target_user_id), which have columns of their own.
export type PlatformAuditEntity = 'PASSWORD_RESET_TOKEN' | 'SYSADMIN_ALERT';

/** Who acted: a person of a clinic, the platform operator, or the system. */
export type AuditActorType = 'USER' | 'OPERATOR' | 'SYSTEM';

/** The timeline's colour. */
export type AuditKind = 'create' | 'update' | 'delete';

export interface AuditActionDef<S extends ParamShape = ParamShape> {
  /**
   * The type of object the row's entity_id points at. Required on every
   * audit_logs action; on platform_audit_logs only when the object is neither
   * the clinic nor a user.
   */
  readonly entity?: AuditEntity | PlatformAuditEntity;
  readonly kind: AuditKind;
  readonly params: S;
  /** Short: badges and filters. */
  readonly label: string;
  /** What was done, without who did it: the screen adds the actor. */
  readonly describe: (p: AuditReadParamsOf<S>) => string;
  /** Kept to render old rows; can never be written again. */
  readonly deprecated?: true;
}

// Keeps the entity and deprecated literals in the type, so AuditTakesEntity
// and AuditWritableAction can tell actions apart.
const action = <
  const S extends ParamShape,
  const E extends AuditEntity | PlatformAuditEntity | undefined = undefined,
  const D extends true | undefined = undefined,
>(
  def: AuditActionDef<S> & { readonly entity?: E; readonly deprecated?: D },
) =>
  def as AuditActionDef<S> &
    (E extends string ? { readonly entity: E } : unknown) &
    (D extends true ? { readonly deprecated: true } : unknown);

// "el teléfono", "el teléfono y la obra social", "a, b y c".
function joinFields(names: readonly string[] | undefined, labels: Labels): string | null {
  const words = (names ?? []).map((n) => labels[n]).filter((w): w is string => w !== undefined);
  if (words.length === 0) return null;
  if (words.length === 1) return words[0];
  return `${words.slice(0, -1).join(', ')} y ${words[words.length - 1]}`;
}

const withStatus = (text: string, status: string | undefined) =>
  status ? `${text} (${AUDIT_PAYMENT_STATUSES[status as keyof typeof AUDIT_PAYMENT_STATUSES]})` : text;

// ─── The catalog ────────────────────────────────────────────────────────────
//
// One section per audit table. A code is unique within its table: the same
// fact done by different actors may use the same code in two tables.

export const AUDIT_ACTIONS = {
  audit_logs: {
    PATIENT_CREATED: action({
      entity: 'PATIENT',
      kind: 'create',
      params: {},
      label: 'Paciente registrado',
      describe: () => 'Registró al paciente',
    }),
    PATIENT_UPDATED: action({
      entity: 'PATIENT',
      kind: 'update',
      params: { changedFields: fields(AUDIT_PATIENT_FIELDS), reason: code(AUDIT_REVISION_REASONS) },
      label: 'Ficha actualizada',
      describe: (p) => {
        const changed = joinFields(p.changedFields, AUDIT_PATIENT_FIELDS);
        return changed ? `Actualizó ${changed}` : 'Actualizó la ficha del paciente';
      },
    }),
    PATIENT_DELETED: action({
      entity: 'PATIENT',
      kind: 'delete',
      params: {},
      label: 'Paciente eliminado',
      describe: () => 'Eliminó al paciente',
    }),
    EVALUATION_CREATED: action({
      entity: 'EVALUATION',
      kind: 'create',
      params: {},
      label: 'Evaluación inicial registrada',
      describe: () => 'Registró la evaluación inicial',
    }),
    EVALUATION_UPDATED: action({
      entity: 'EVALUATION',
      kind: 'update',
      params: { changedFields: fields(AUDIT_EVALUATION_FIELDS), reason: code(AUDIT_REVISION_REASONS) },
      label: 'Evaluación inicial actualizada',
      describe: (p) => {
        const changed = joinFields(p.changedFields, AUDIT_EVALUATION_FIELDS);
        return changed
          ? `Actualizó ${changed} en la evaluación inicial`
          : 'Actualizó la evaluación inicial';
      },
    }),
    // The functional scales (Oswestry, NDI) were removed on 2026-10-27: no screen
    // had offered them since June.
    SCALE_APPLIED: action({
      deprecated: true,
      entity: 'SCALE',
      kind: 'create',
      params: { scaleType: code(AUDIT_SCALE_TYPES) },
      label: 'Escala aplicada',
      describe: (p) =>
        p.scaleType ? `Aplicó la escala ${AUDIT_SCALE_TYPES[p.scaleType]}` : 'Aplicó una escala',
    }),
    SESSION_RECORDED: action({
      entity: 'SESSION',
      kind: 'create',
      params: {},
      label: 'Sesión registrada',
      describe: () => 'Registró una sesión',
    }),
    NOTE_RECORDED: action({
      entity: 'SESSION',
      kind: 'create',
      params: {},
      label: 'Nota clínica registrada',
      describe: () => 'Registró una nota clínica',
    }),
    DISCHARGE_RECORDED: action({
      entity: 'SESSION',
      kind: 'create',
      params: {},
      label: 'Alta registrada',
      describe: () => 'Registró el alta',
    }),
    SESSION_UPDATED: action({
      entity: 'SESSION',
      kind: 'update',
      // The type after the update: a session turned into a discharge by
      // editing it is findable too.
      params: {
        sessionType: code(AUDIT_SESSION_TYPES),
        changedFields: fields(AUDIT_SESSION_FIELDS),
        reason: code(AUDIT_REVISION_REASONS),
      },
      label: 'Sesión actualizada',
      describe: (p) => {
        const what = p.sessionType === 'DISCHARGE' ? 'del alta' : p.sessionType === 'NOTE' ? 'de la nota clínica' : 'de la sesión';
        const changed = joinFields(p.changedFields, AUDIT_SESSION_FIELDS);
        return changed ? `Actualizó ${changed} ${what}` : `Actualizó los datos ${what}`;
      },
    }),
    // Replaced by SESSION_ANNULLED (SPEC-clinical-revisions.md §8): a session
    // is no longer deleted, only annulled with a reason.
    SESSION_DELETED: action({
      deprecated: true,
      entity: 'SESSION',
      kind: 'delete',
      params: {},
      label: 'Sesión eliminada',
      describe: () => 'Eliminó una sesión',
    }),
    // The entry stays in the record, struck through, and its content in its
    // history; lists and metrics leave it out.
    SESSION_ANNULLED: action({
      entity: 'SESSION',
      kind: 'delete',
      // `payment`: a pending or waived payment goes with the session, and the
      // row says so; there is no other trace of it.
      params: {
        sessionType: code(AUDIT_SESSION_TYPES),
        reason: code(AUDIT_REVISION_REASONS),
        payment: code(AUDIT_ANNULLED_SESSION_PAYMENTS),
      },
      label: 'Sesión anulada',
      describe: (p) => {
        const what =
          p.sessionType === 'DISCHARGE'
            ? 'Anuló el alta'
            : p.sessionType === 'NOTE'
              ? 'Anuló una nota clínica'
              : 'Anuló una sesión';
        return p.payment && p.payment !== 'NONE' ? `${what} (${AUDIT_ANNULLED_SESSION_PAYMENTS[p.payment]})` : what;
      },
    }),
    PAYMENT_CREATED: action({
      entity: 'PAYMENT',
      kind: 'create',
      params: { status: code(AUDIT_PAYMENT_STATUSES) },
      label: 'Cobro registrado',
      describe: (p) => withStatus('Registró un cobro', p.status),
    }),
    PAYMENT_UPDATED: action({
      entity: 'PAYMENT',
      kind: 'update',
      // The status after the update: a payment marked paid is findable.
      params: { status: code(AUDIT_PAYMENT_STATUSES), changedFields: fields(AUDIT_PAYMENT_FIELDS) },
      label: 'Cobro actualizado',
      describe: (p) => {
        const changed = joinFields(p.changedFields, AUDIT_PAYMENT_FIELDS);
        return withStatus(changed ? `Actualizó ${changed} del cobro` : 'Actualizó el cobro', p.status);
      },
    }),
    CONSENT_SIGNED: action({
      entity: 'CONSENT',
      kind: 'create',
      params: {},
      label: 'Consentimiento firmado',
      describe: () => 'Registró la firma del consentimiento informado',
    }),
    CONSENT_REVOKED: action({
      entity: 'CONSENT',
      kind: 'update',
      params: {},
      label: 'Consentimiento revocado',
      describe: () => 'Registró la revocación del consentimiento informado',
    }),
    PATIENT_EVENT_RECORDED: action({
      entity: 'PATIENT_EVENT',
      kind: 'create',
      params: { kind: code(AUDIT_PATIENT_EVENT_KINDS) },
      label: 'Antecedente registrado',
      describe: (p) =>
        p.kind ? `Registró un antecedente (${AUDIT_PATIENT_EVENT_KINDS[p.kind]})` : 'Registró un antecedente',
    }),
    PATIENT_EVENT_UPDATED: action({
      entity: 'PATIENT_EVENT',
      kind: 'update',
      // The kind after the update, as SESSION_UPDATED keeps the type.
      params: { kind: code(AUDIT_PATIENT_EVENT_KINDS), changedFields: fields(AUDIT_PATIENT_EVENT_FIELDS), reason: code(AUDIT_REVISION_REASONS) },
      label: 'Antecedente actualizado',
      describe: (p) => {
        const changed = joinFields(p.changedFields, AUDIT_PATIENT_EVENT_FIELDS);
        return changed ? `Actualizó ${changed} de un antecedente` : 'Actualizó un antecedente';
      },
    }),
    // Replaced by PATIENT_EVENT_ANNULLED (SPEC-clinical-revisions.md §8).
    PATIENT_EVENT_DELETED: action({
      deprecated: true,
      entity: 'PATIENT_EVENT',
      kind: 'delete',
      params: { kind: code(AUDIT_PATIENT_EVENT_KINDS) },
      label: 'Antecedente eliminado',
      describe: (p) =>
        p.kind ? `Eliminó un antecedente (${AUDIT_PATIENT_EVENT_KINDS[p.kind]})` : 'Eliminó un antecedente',
    }),
    PATIENT_EVENT_ANNULLED: action({
      entity: 'PATIENT_EVENT',
      kind: 'delete',
      params: { kind: code(AUDIT_PATIENT_EVENT_KINDS), reason: code(AUDIT_REVISION_REASONS) },
      label: 'Antecedente anulado',
      describe: (p) =>
        p.kind ? `Anuló un antecedente (${AUDIT_PATIENT_EVENT_KINDS[p.kind]})` : 'Anuló un antecedente',
    }),
    // An episode's status changes are facts with actions of their own, and take
    // no reason; EPISODE_UPDATED is only a correction of its data. One request
    // never does both (SPEC-clinical-revisions.md §4).
    EPISODE_OPENED: action({
      entity: 'EPISODE',
      kind: 'create',
      params: {},
      label: 'Episodio abierto',
      describe: () => 'Abrió un episodio',
    }),
    EPISODE_CLOSED: action({
      entity: 'EPISODE',
      kind: 'update',
      params: { status: code(AUDIT_EPISODE_STATUSES) },
      label: 'Episodio cerrado',
      describe: (p) =>
        p.status ? `Cerró un episodio (${AUDIT_EPISODE_STATUSES[p.status]})` : 'Cerró un episodio',
    }),
    EPISODE_REOPENED: action({
      entity: 'EPISODE',
      kind: 'update',
      params: {},
      label: 'Episodio reabierto',
      describe: () => 'Reabrió un episodio',
    }),
    EPISODE_UPDATED: action({
      entity: 'EPISODE',
      kind: 'update',
      params: { changedFields: fields(AUDIT_EPISODE_FIELDS), reason: code(AUDIT_REVISION_REASONS) },
      label: 'Episodio actualizado',
      describe: (p) => {
        const changed = joinFields(p.changedFields, AUDIT_EPISODE_FIELDS);
        return changed ? `Actualizó ${changed} de un episodio` : 'Actualizó un episodio';
      },
    }),
    // One row per appointment, a series included: a row names exactly one
    // object, and params cannot hold a count (decided 2026-11-06).
    APPOINTMENT_SCHEDULED: action({
      entity: 'APPOINTMENT',
      kind: 'create',
      params: {},
      label: 'Turno agendado',
      describe: () => 'Agendó un turno',
    }),
    // Cancelling is a fact of its own, one by one or with the rest of a series.
    APPOINTMENT_CANCELLED: action({
      entity: 'APPOINTMENT',
      kind: 'update',
      params: {},
      label: 'Turno cancelado',
      describe: () => 'Canceló un turno',
    }),
    APPOINTMENT_UPDATED: action({
      entity: 'APPOINTMENT',
      kind: 'update',
      // The status after the update: an appointment marked as missed is
      // findable, as a payment marked paid is.
      params: { status: code(AUDIT_APPOINTMENT_STATUSES), changedFields: fields(AUDIT_APPOINTMENT_FIELDS) },
      label: 'Turno actualizado',
      describe: (p) => {
        const changed = joinFields(p.changedFields, AUDIT_APPOINTMENT_FIELDS);
        const text = changed ? `Actualizó ${changed} de un turno` : 'Actualizó un turno';
        return p.status ? `${text} (${AUDIT_APPOINTMENT_STATUSES[p.status]})` : text;
      },
    }),
    PACKAGE_CREATED: action({
      entity: 'PACKAGE',
      kind: 'create',
      params: {},
      label: 'Paquete registrado',
      describe: () => 'Registró un paquete de sesiones',
    }),
    PACKAGE_DELETED: action({
      entity: 'PACKAGE',
      kind: 'delete',
      params: {},
      label: 'Paquete eliminado',
      describe: () => 'Eliminó un paquete de sesiones',
    }),
    // Before the catalog (until 2026-10), an action was the entity plus one of
    // these, and the fact itself lived in a Spanish description.
    CREATED: action({
      deprecated: true,
      kind: 'create',
      params: {},
      label: 'Creación',
      describe: () => 'Registro creado',
    }),
    UPDATED: action({
      deprecated: true,
      kind: 'update',
      params: {},
      label: 'Actualización',
      describe: () => 'Registro actualizado',
    }),
    DELETED: action({
      deprecated: true,
      kind: 'delete',
      params: {},
      label: 'Eliminación',
      describe: () => 'Registro eliminado',
    }),
  },

  platform_audit_logs: {
    TENANT_CREATED: action({
      kind: 'create',
      params: {},
      label: 'Clínica creada',
      describe: () => 'Creó la clínica',
    }),
    TENANT_DEACTIVATED: action({
      kind: 'update',
      params: {},
      label: 'Clínica desactivada',
      describe: () => 'Desactivó la clínica',
    }),
    TENANT_REACTIVATED: action({
      kind: 'update',
      params: {},
      label: 'Clínica reactivada',
      describe: () => 'Reactivó la clínica',
    }),
    ADMIN_CREATED: action({
      kind: 'create',
      params: {},
      label: 'ADMIN creada',
      describe: () => 'Creó una ADMIN',
    }),
    USER_ROLE_CHANGED: action({
      kind: 'update',
      params: { role: code(AUDIT_ROLES) },
      label: 'Cambio de rol',
      // Rows written before the role was a parameter have none.
      describe: (p) => (p.role ? `Cambió el rol a ${AUDIT_ROLES[p.role]}` : 'Cambió el rol'),
    }),
    USER_DEACTIVATED: action({
      kind: 'update',
      params: {},
      label: 'Usuaria desactivada',
      describe: () => 'Desactivó a la usuaria',
    }),
    USER_REACTIVATED: action({
      kind: 'update',
      params: {},
      label: 'Usuaria reactivada',
      describe: () => 'Reactivó a la usuaria',
    }),
    USER_DEVICES_DISCONNECTED: action({
      kind: 'update',
      params: {},
      label: 'Dispositivos desconectados',
      describe: () => 'Desconectó los dispositivos de la usuaria',
    }),
    PASSWORD_RESET_LINK_CREATED: action({
      // The link generated, so a row names exactly one link.
      entity: 'PASSWORD_RESET_TOKEN',
      kind: 'create',
      params: {},
      label: 'Enlace para restablecer contraseña',
      describe: () => 'Generó un enlace para restablecer la contraseña',
    }),
    // An action on the platform itself: the only one with no clinic.
    TEST_ALERT_SENT: action({
      entity: 'SYSADMIN_ALERT',
      kind: 'create',
      params: {},
      label: 'Alerta de prueba enviada',
      describe: () => 'Envió una alerta de prueba',
    }),
    // Until 2026-10, deactivating and reactivating were one action, and which
    // one lived in the description.
    USER_ACTIVE_CHANGED: action({
      deprecated: true,
      kind: 'update',
      params: {},
      label: 'Cambio de estado',
      describe: () => 'Cambió el estado de la usuaria',
    }),
  },
} as const;

// ─── Types ──────────────────────────────────────────────────────────────────

type Catalog = typeof AUDIT_ACTIONS;
export type AuditTable = keyof Catalog;

/** Every code of a table, deprecated ones included: what a reader may find. */
export type AuditActionCode<T extends AuditTable> = keyof Catalog[T] & string;

type DeprecatedCodes<T extends AuditTable> = {
  [A in AuditActionCode<T>]: Catalog[T][A] extends { deprecated: true } ? A : never;
}[AuditActionCode<T>];

/** The codes a writer may use. */
export type AuditWritableAction<T extends AuditTable> = Exclude<AuditActionCode<T>, DeprecatedCodes<T>>;

type ShapeOf<T extends AuditTable, A extends AuditActionCode<T>> = Catalog[T][A] extends {
  params: infer S extends ParamShape;
}
  ? S
  : never;

/** Whether an action's row points at an object (and so needs an entity id). */
export type AuditTakesEntity<T extends AuditTable, A extends AuditActionCode<T>> = Catalog[T][A] extends {
  entity: string;
}
  ? true
  : false;

/** The parameters a writer passes for an action. */
export type AuditParams<T extends AuditTable, A extends AuditActionCode<T>> = AuditParamsOf<ShapeOf<T, A>>;

export type ClinicalAuditAction = AuditActionCode<'audit_logs'>;
export type PlatformAction = AuditActionCode<'platform_audit_logs'>;

// ─── Writing (strict) ───────────────────────────────────────────────────────

function lookup(table: AuditTable, actionCode: string): AuditActionDef | undefined {
  const section = AUDIT_ACTIONS[table] as Readonly<Record<string, AuditActionDef>>;
  return Object.prototype.hasOwnProperty.call(section, actionCode) ? section[actionCode] : undefined;
}

function paramSchema(def: AuditParamDef) {
  const values = Object.keys(def.values) as [string, ...string[]];
  return def.type === 'code' ? z.enum(values) : z.array(z.enum(values)).min(1);
}

/**
 * Checks what a writer is about to record. Returns the reason it cannot be
 * written, or null. Never throws: the caller decides what a failure is (for
 * the API, a server bug).
 */
export function auditEntryProblem(table: AuditTable, actionCode: string, params: unknown): string | null {
  const def = lookup(table, actionCode);
  if (!def) return `unknown action ${actionCode} for ${table}`;
  if (def.deprecated) return `deprecated action ${actionCode} for ${table}`;
  const shape = Object.fromEntries(Object.entries(def.params).map(([k, p]) => [k, paramSchema(p)]));
  const result = z.strictObject(shape).safeParse(params);
  if (!result.success) {
    // Paths and codes only: never the value, which is what the check is about.
    const where = result.error.issues.map((i) => `${i.path.join('.') || '(params)'}: ${i.code}`).join('; ');
    return `invalid params for ${actionCode}: ${where}`;
  }
  return null;
}

/** The type of object an action's row points at, if it points at one. */
export function auditEntityOf(table: 'audit_logs', actionCode: string): AuditEntity | undefined;
export function auditEntityOf(table: 'platform_audit_logs', actionCode: string): PlatformAuditEntity | undefined;
export function auditEntityOf(table: AuditTable, actionCode: string): AuditEntity | PlatformAuditEntity | undefined {
  return lookup(table, actionCode)?.entity;
}

// ─── Reading (lenient) ──────────────────────────────────────────────────────

/**
 * The parameters of a stored row, parsed one by one: a parameter the row
 * lacks, or a value this version does not know (a newer API), is left out;
 * unknown keys are ignored; anything that is not an object reads as {}.
 */
export function readAuditParams(table: AuditTable, actionCode: string, raw: unknown): Record<string, unknown> {
  const def = lookup(table, actionCode);
  if (!def || typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, param] of Object.entries(def.params)) {
    const value = (raw as Record<string, unknown>)[key];
    if (param.type === 'code') {
      if (typeof value === 'string' && Object.hasOwn(param.values, value)) out[key] = value;
    } else if (Array.isArray(value)) {
      const known = value.filter((v): v is string => typeof v === 'string' && Object.hasOwn(param.values, v));
      if (known.length > 0) out[key] = known;
    }
  }
  return out;
}

/** The short label of an action, or a neutral one for a code this version does not know. */
export function auditActionLabel(table: AuditTable, actionCode: string): string {
  return lookup(table, actionCode)?.label ?? 'Acción registrada';
}

/** The sentence for a stored row, without the actor. */
export function describeAuditEntry(table: AuditTable, actionCode: string, raw: unknown): string {
  const def = lookup(table, actionCode);
  if (!def) return 'Acción registrada';
  return (def.describe as (p: Record<string, unknown>) => string)(readAuditParams(table, actionCode, raw));
}

/** create / update / delete, for the timeline's colour; null for an unknown code. */
export function auditActionKind(table: AuditTable, actionCode: string): AuditKind | null {
  return lookup(table, actionCode)?.kind ?? null;
}

// ─── Requests that carry a reason ───────────────────────────────────────────
//
// A correction or an annulment of a clinical record says why
// (SPEC-clinical-revisions.md §4): a code, which goes into the audit row, and
// an optional note, which is clinical text and goes only into the revision.
// A correction's route spreads the fields into its body schema; an
// annulment's body is exactly these (revisionReasonSchema).
export type RevisionReason = keyof typeof AUDIT_REVISION_REASONS;

export const revisionReasonFields = {
  reason: z.enum(Object.keys(AUDIT_REVISION_REASONS) as [RevisionReason, ...RevisionReason[]], {
    error: 'Elegí el motivo del cambio',
  }),
  // The API's single empty (optionalText in apps/api/src/lib/validation.ts,
  // which this package cannot import): absent stays absent, "" and "   "
  // become null, and the limit is measured after the trim.
  reasonNote: z
    .string()
    .trim()
    .max(500, 'La nota no puede superar los 500 caracteres')
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
};

export const revisionReasonSchema = z.strictObject(revisionReasonFields);
