// Barrel: exporta las implementaciones Prisma de cada repositorio.
// Para cambiar de ORM basta reemplazar las importaciones aquí.

export { prismaPatientRepository as patientRepo } from './prisma/prismaPatientRepository';
export { prismaAuditLogRepository as auditLogRepo } from './prisma/prismaAuditLogRepository';
export { prismaConsentRepository as consentRepo } from './prisma/prismaConsentRepository';
export { prismaClinicalAlertRepository as clinicalAlertRepo } from './prisma/prismaClinicalAlertRepository';
export { prismaUserRepository as userRepo } from './prisma/prismaUserRepository';
export { prismaAuthRepository as authRepo } from './prisma/prismaAuthRepository';
export { prismaEpisodeRepository as episodeRepo } from './prisma/prismaEpisodeRepository';
export { prismaEvaluationRepository as evaluationRepo } from './prisma/prismaEvaluationRepository';
export { prismaFunctionalScaleRepository as functionalScaleRepo } from './prisma/prismaFunctionalScaleRepository';
export { prismaPackageRepository as packageRepo } from './prisma/prismaPackageRepository';
export { prismaPaymentRepository as paymentRepo } from './prisma/prismaPaymentRepository';
export { prismaSessionRepository as sessionRepo } from './prisma/prismaSessionRepository';
export { prismaDashboardRepository as dashboardRepo } from './prisma/prismaDashboardRepository';
export { prismaTenantRepository as tenantRepo } from './prisma/prismaTenantRepository';
export { prismaAppointmentRepository as appointmentRepo } from './prisma/prismaAppointmentRepository';
