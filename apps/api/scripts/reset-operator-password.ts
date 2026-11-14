import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { EmailSchema, PasswordSchema } from '../src/lib/validation';

// Recovery of a platform operator who lost her password. The operator has no
// "forgot my password" and nobody above her to reset it, so this is the only
// way back in short of editing the database by hand. Like create:operator, it
// runs from a terminal against the DATABASE_URL it is given.
//
// It replaces the hash and stamps passwordChangedAt, which is what makes the
// platform middleware reject every token issued before (platformAuth.ts), the
// same as changing the password from the UI.
//
// Usage:
//   OPERATOR_EMAIL=a@b.com OPERATOR_PASSWORD=... npm run reset:operator-password -w apps/api
// The password is never printed.

const prisma = new PrismaClient();

async function main() {
  const operatorEmail = process.env.OPERATOR_EMAIL;
  const operatorPassword = process.env.OPERATOR_PASSWORD;

  if (!operatorEmail || !operatorPassword) {
    console.error(
      'Faltan variables: OPERATOR_EMAIL y OPERATOR_PASSWORD son obligatorias.\n' +
        'Ejemplo: OPERATOR_EMAIL=a@b.com OPERATOR_PASSWORD=... npm run reset:operator-password -w apps/api',
    );
    process.exit(1);
  }

  // The same policy as the API and create:operator.
  const email = EmailSchema.parse(operatorEmail);
  const password = PasswordSchema.parse(operatorPassword);

  const passwordHash = await bcrypt.hash(password, 10);
  // Existence is decided by the write itself: no window between a lookup and the update.
  const { count } = await prisma.platformOperator.updateMany({
    where: { email },
    data: { passwordHash, passwordChangedAt: new Date() },
  });

  if (count === 0) {
    console.error(`No existe un operador con el email ${email}. No se hizo ningún cambio.`);
    process.exit(1);
  }

  console.log(`✓ Contraseña del operador ${email} reemplazada.`);
  console.log('  Las sesiones abiertas de ese operador quedaron cerradas. Entrá por /platform/login.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
