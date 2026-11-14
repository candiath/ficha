-- A new ADMIN's invitation is its own fact, apart from a reset that cuts
-- access: one action. Nothing here changes a row.

-- AlterEnum
ALTER TYPE "PlatformAction" ADD VALUE 'INVITATION_LINK_CREATED';
