import type { Prisma } from '@prisma/client';
import { PASSWORD_RESET_TTL_MS } from '../../lib/passwordReset';
import { generateOpaqueToken, hashOpaqueToken } from '../../lib/opaqueToken';
import type { PasswordResetIssueInput, PasswordResetLink } from '../userRepository';

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
): Promise<PasswordResetLink> {
  const now = new Date();

  await tx.passwordResetToken.updateMany({
    where: { userId, usedAt: null, invalidatedAt: null },
    data: { invalidatedAt: now },
  });

  const token = generateOpaqueToken();
  const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TTL_MS);
  await tx.passwordResetToken.create({
    data: {
      userId,
      tokenHash: hashOpaqueToken(token),
      expiresAt,
      createdByUserId: 'userId' in issuer ? issuer.userId : null,
      createdByOperatorId: 'operatorId' in issuer ? issuer.operatorId : null,
      createdIp: input.ip,
      createdUserAgent: input.userAgent,
    },
  });

  await tx.user.update({
    where: { id: userId },
    data: { passwordHash: input.disabledPasswordHash },
  });
  await tx.authSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: now },
  });

  return { token, expiresAt: expiresAt.toISOString() };
}
