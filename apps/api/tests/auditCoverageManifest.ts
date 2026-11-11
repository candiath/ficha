// Inventory of every write route (POST, PUT, PATCH, DELETE) of the API, keyed
// by `METHOD fullPath`. Each one is either audited (names the table its audit
// row goes to), exempt (writes no action, with the reason), or debt (no audit
// row yet, with the module that closes it). See docs/specs/SPEC-audit-coverage.md.
//
// Adding a write route means adding its entry here in the same PR. A debt entry
// is deleted by the module that closes it, never added for a new route.

export type AuditTable =
  | 'audit_logs'
  | 'platform_audit_logs'
  | 'login_events'
  | 'clinic_audit_logs'
  | 'record_access_logs';

export type DebtModule =
  | 'clinic-audit'
  | 'account-audit'
  | 'security-events';

export type AuditCoverage =
  | { status: 'audited'; table: AuditTable }
  | { status: 'exempt'; reason: string }
  | { status: 'debt'; module: DebtModule };

const audited = (table: AuditTable): AuditCoverage => ({ status: 'audited', table });
const exempt = (reason: string): AuditCoverage => ({ status: 'exempt', reason });
const debt = (module: DebtModule): AuditCoverage => ({ status: 'debt', module });

export const AUDIT_COVERAGE: Record<string, AuditCoverage> = {
  // Alerts (routes/alerts.ts)
  'POST /api/alerts': exempt('a reminder for the clinic, not part of the patient history; no screen calls it (#283)'),
  'PATCH /api/alerts/:id/read': exempt('the state of a notification, not a clinical fact'),
  'PATCH /api/alerts/read-all': exempt('the state of a notification, not a clinical fact'),

  // Appointments (routes/appointments.ts)
  'POST /api/appointments': audited('audit_logs'),
  'PATCH /api/appointments/:id': audited('audit_logs'),
  'POST /api/appointments/:id/cancel-series': audited('audit_logs'),

  // Auth, clinic side (routes/auth.ts)
  'POST /api/auth/login': audited('login_events'),
  'POST /api/auth/change-password': debt('account-audit'),
  'POST /api/auth/password-reset/check': exempt('validates a reset token; writes nothing'),
  'POST /api/auth/password-reset': debt('account-audit'),
  'POST /api/auth/logout': debt('account-audit'),
  'POST /api/auth/devices/revoke-others': debt('account-audit'),
  'DELETE /api/auth/devices/:authSessionId': debt('account-audit'),
  'POST /api/auth/devices/:authSessionId/untrust': debt('account-audit'),

  // Consent (routes/consent.ts), mounted under a patient
  'POST /api/patients/:patientId/consent': audited('audit_logs'),
  'DELETE /api/patients/:patientId/consent': audited('audit_logs'),

  // Episodes (routes/episodes.ts)
  'POST /api/patients/:patientId/episodes': audited('audit_logs'),
  'PATCH /api/patients/:patientId/episodes/:episodeId': audited('audit_logs'),

  // Initial evaluation (routes/evaluations.ts)
  'PUT /api/patients/:patientId/episodes/:episodeId/evaluation': audited('audit_logs'),

  // The patient's history (routes/patientEvents.ts, #238)
  'POST /api/patients/:patientId/events': audited('audit_logs'),
  'PATCH /api/patients/:patientId/events/:eventId': audited('audit_logs'),
  'POST /api/patients/:patientId/events/:eventId/annul': audited('audit_logs'),

  // Packages (routes/packages.ts)
  'POST /api/packages': audited('audit_logs'),
  'DELETE /api/packages/:id': audited('audit_logs'),

  // Payments (routes/payments.ts)
  'POST /api/payments': audited('audit_logs'),
  'PATCH /api/payments/:id': audited('audit_logs'),

  // Patients (routes/patients.ts)
  'POST /api/patients': audited('audit_logs'),
  'PATCH /api/patients/:id': audited('audit_logs'),
  'DELETE /api/patients/:id': audited('audit_logs'),
  'POST /api/patients/:id/restore': audited('audit_logs'),

  // Operator (routes/platform.ts), every action audited in its transaction
  'POST /api/platform/tenants': audited('platform_audit_logs'),
  'PATCH /api/platform/tenants/:tenantId': audited('platform_audit_logs'),
  'POST /api/platform/tenants/:tenantId/users': audited('platform_audit_logs'),
  'PATCH /api/platform/tenants/:tenantId/users/:userId': audited('platform_audit_logs'),
  'POST /api/platform/tenants/:tenantId/users/:userId/disconnect-devices': audited('platform_audit_logs'),
  'POST /api/platform/tenants/:tenantId/users/:userId/password-reset': audited('platform_audit_logs'),

  // Sysadmin alerts (routes/platformAlerts.ts): the test alert is an operator
  // action (TEST_ALERT_SENT), written with the alert in one transaction
  'POST /api/platform/alerts/test': audited('platform_audit_logs'),

  // Operator login and password (routes/platformAuth.ts)
  'POST /api/platform/auth/login': audited('login_events'),
  'POST /api/platform/auth/change-password': debt('account-audit'),

  // Clinical sessions (routes/sessions.ts), mounted under a patient
  'POST /api/patients/:patientId/sessions': audited('audit_logs'),
  'PATCH /api/patients/:patientId/sessions/:sessionId': audited('audit_logs'),
  'POST /api/patients/:patientId/sessions/:sessionId/annul': audited('audit_logs'),

  // Clinic configuration (routes/tenant.ts)
  'PATCH /api/tenant': debt('clinic-audit'),

  // Users, ADMIN only (routes/users.ts)
  'POST /api/users': debt('clinic-audit'),
  'PATCH /api/users/:id': debt('clinic-audit'),
  'POST /api/users/:id/disconnect-devices': debt('clinic-audit'),
  'POST /api/users/:id/password-reset': debt('clinic-audit'),
};
