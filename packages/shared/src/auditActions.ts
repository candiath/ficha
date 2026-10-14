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
  fullName: 'el nombre',
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
  reasonForConsultation: 'el motivo de consulta',
  medicalHistory: 'los antecedentes',
  globalPosture: 'la postura global',
  breathingPattern: 'el patrón respiratorio',
  breathingPatternDetail: 'el detalle del patrón respiratorio',
  notes: 'las notas',
  morphotype: 'el morfotipo',
  retractionMap: 'el mapa de retracciones',
  footEvaluation: 'la evaluación del pie',
  flexibilityNotes: 'la flexibilidad',
  physicalActivity: 'la actividad física',
  painAppearanceMoment: 'el momento de aparición del dolor',
  painFrequency: 'la frecuencia del dolor',
  familyPainAppearance: 'la aparición del dolor por familia',
  familyPainDisappearance: 'la desaparición del dolor por familia',
  postureFamilies: 'las familias de posturas',
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

export const AUDIT_PAYMENT_FIELDS = {
  baseAmount: 'el monto',
  discount: 'el descuento',
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

export type AuditEntity = 'PATIENT' | 'EVALUATION' | 'SCALE' | 'SESSION' | 'PAYMENT' | 'CONSENT';

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
      params: { changedFields: fields(AUDIT_PATIENT_FIELDS) },
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
      params: { changedFields: fields(AUDIT_EVALUATION_FIELDS) },
      label: 'Evaluación inicial actualizada',
      describe: (p) => {
        const changed = joinFields(p.changedFields, AUDIT_EVALUATION_FIELDS);
        return changed
          ? `Actualizó ${changed} en la evaluación inicial`
          : 'Actualizó la evaluación inicial';
      },
    }),
    SCALE_APPLIED: action({
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
      params: { sessionType: code(AUDIT_SESSION_TYPES), changedFields: fields(AUDIT_SESSION_FIELDS) },
      label: 'Sesión actualizada',
      describe: (p) => {
        const what = p.sessionType === 'DISCHARGE' ? 'del alta' : p.sessionType === 'NOTE' ? 'de la nota clínica' : 'de la sesión';
        const changed = joinFields(p.changedFields, AUDIT_SESSION_FIELDS);
        return changed ? `Actualizó ${changed} ${what}` : `Actualizó los datos ${what}`;
      },
    }),
    SESSION_DELETED: action({
      entity: 'SESSION',
      kind: 'delete',
      params: {},
      label: 'Sesión eliminada',
      describe: () => 'Eliminó una sesión',
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
