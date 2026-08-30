// Barrel: exporta las implementaciones Prisma de cada repositorio.
// Para cambiar de ORM basta reemplazar las importaciones aquí.

export { prismaPatientRepository as patientRepo } from './prisma/prismaPatientRepository';
export { prismaSessionTechniqueRepository as sessionTechniqueRepo } from './prisma/prismaSessionTechniqueRepository';
export { prismaAuditLogRepository as auditLogRepo } from './prisma/prismaAuditLogRepository';
export { prismaConsentRepository as consentRepo } from './prisma/prismaConsentRepository';
export { prismaClinicalAlertRepository as clinicalAlertRepo } from './prisma/prismaClinicalAlertRepository';
export { prismaTechniqueRepository as techniqueRepo } from './prisma/prismaTechniqueRepository';
export { prismaUserRepository as userRepo } from './prisma/prismaUserRepository';
export { prismaAuthRepository as authRepo } from './prisma/prismaAuthRepository';
export { prismaEpisodeRepository as episodeRepo } from './prisma/prismaEpisodeRepository';
export { prismaEvaluationRepository as evaluationRepo } from './prisma/prismaEvaluationRepository';
export { prismaFunctionalScaleRepository as functionalScaleRepo } from './prisma/prismaFunctionalScaleRepository';
export { prismaPackageRepository as packageRepo } from './prisma/prismaPackageRepository';
