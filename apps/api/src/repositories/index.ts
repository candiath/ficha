// Barrel: exporta las implementaciones Prisma de cada repositorio.
// Para cambiar de ORM basta reemplazar las importaciones aquí.

export { prismaSessionTechniqueRepository as sessionTechniqueRepo } from './prisma/prismaSessionTechniqueRepository';
export { prismaAuditLogRepository as auditLogRepo } from './prisma/prismaAuditLogRepository';
export { prismaConsentRepository as consentRepo } from './prisma/prismaConsentRepository';
export { prismaClinicalAlertRepository as clinicalAlertRepo } from './prisma/prismaClinicalAlertRepository';
