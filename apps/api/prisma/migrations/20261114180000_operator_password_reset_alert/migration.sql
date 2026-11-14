-- reset:operator-password tells the operator by Telegram: one alert kind.
-- Nothing here changes a row.

-- AlterEnum
ALTER TYPE "SysadminAlertKind" ADD VALUE 'OPERATOR_PASSWORD_RESET';
