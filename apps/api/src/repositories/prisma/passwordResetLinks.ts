import type { Prisma } from '@prisma/client';
import { PASSWORD_RESET_TTL_MS } from '../../lib/passwordReset';
import { generateOpaqueToken, hashOpaqueToken } from '../../lib/opaqueToken';
import type { PasswordResetIssueInput, PasswordResetLink } from '../userRepository';

// The link for the caller to hand over, plus its row id, which the operator's
// audit row names (SPEC-audit-structured-entries.md). The id never leaves the API.
export type IssuedPasswordReset = PasswordResetLink & { id: string };

// The user lists show a pending reset (SPEC-password-reset, decision 5):
// merged into each list's select, so the badge comes with the row. Her
// unused, unretired link — generating a new one retires the earlier, so
// there is at most one — and pendingPasswordResetExpiry decides whether it
// still counts.
export const pendingPasswordResetSelect = {
  passwordResetTokens: {
    where: { usedAt: null, invalidatedAt: null },
    orderBy: { expiresAt: 'desc' },
    take: 1,
    select: { expiresAt: true },
  },
} satisfies Prisma.UserSelect;

// The expiry of her link if it can still be used, else null. A deactivated
// user's link is dead (the public routes require her active), so no badge.
export function pendingPasswordResetExpiry(row: {
  isActive: boolean;
  passwordResetTokens: { expiresAt: Date }[];
}): string | null {
  const link = row.passwordResetTokens[0];
  if (!row.isActive || !link || link.expiresAt.getTime() <= Date.now()) return null;
  return link.expiresAt.toISOString();
}

// Who generates a link: an ADMIN of the clinic or the platform operator.
export type PasswordResetIssuer = { userId: string } | { operatorId: string };

// The writes of generating a reset link, shared by the ADMIN
// (userRepository) and the operator (platformRepository). The caller has
// already proved, in the same transaction, that the user is in the right
// clinic and active. From this moment the account is closed to everyone
// until the link is used: earlier links are retired, her password stops
// working and every session she had is revoked (SPEC-password-reset).
export async function issuePasswordReset(
  tx: Prisma.TransactionClient,
  userId: string,
  issuer: PasswordResetIssuer,
  input: PasswordResetIssueInput,
): Promise<IssuedPasswordReset> {
  const now = new Date();

  await tx.passwordResetToken.updateMany({
    where: { userId, usedAt: null, invalidatedAt: null },
    data: { invalidatedAt: now },
  });

  const token = generateOpaqueToken();
  const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TTL_MS);
  const { id } = await tx.passwordResetToken.create({
    data: {
      userId,
      tokenHash: hashOpaqueToken(token),
      expiresAt,
      createdByUserId: 'userId' in issuer ? issuer.userId : null,
      createdByOperatorId: 'operatorId' in issuer ? issuer.operatorId : null,
      createdIp: input.ip,
      createdUserAgent: input.userAgent,
    },
    select: { id: true },
  });

  await tx.user.update({
    where: { id: userId },
    data: { passwordHash: input.disabledPasswordHash },
  });
  await tx.authSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: now },
  });

  return { id, token, expiresAt: expiresAt.toISOString() };
}
