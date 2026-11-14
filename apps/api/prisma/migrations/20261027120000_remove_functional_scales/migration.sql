-- The functional scales (Oswestry, NDI) left the patient's record in June
-- 2026 and no screen offered them since: the table, its type and its routes
-- were dead code. Dropped in one release: production is wiped before the
-- relaunch (#238). The audit catalog keeps SCALE_APPLIED, deprecated, and the
-- audit enums keep SCALE_APPLIED and SCALE: codes are permanent.
DROP TABLE "functional_scales";

DROP TYPE "ScaleType";
