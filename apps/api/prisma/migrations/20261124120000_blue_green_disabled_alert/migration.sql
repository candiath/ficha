-- The production API tells the operator when it starts with blue/green
-- deploys turned off (DEPLOY_NO_BLUE_GREEN, ops/README.md): one alert kind.
-- Nothing here changes a row.

-- AlterEnum
ALTER TYPE "SysadminAlertKind" ADD VALUE 'BLUE_GREEN_DISABLED';
