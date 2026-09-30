import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { EmailSchema, PasswordSchema } from '../src/lib/validation';

// Bootstrap del operador de plataforma (issue #153). Es el único huevo-y-
// gallina que queda: /api/platform/* exige un operador logueado, y el seed
// no crea ninguno en producción (sembraría una credencial conocida). Este
// script crea el PRIMERO desde variables de entorno; a partir de ahí las
// clínicas y sus ADMIN se crean desde la UI de plataforma, y ya no hace
// falta volver a tocar el DATABASE_URL de producción a mano para esto.
//
// Uso:
//   OPERATOR_EMAIL=a@b.com OPERATOR_PASSWORD=... [OPERATOR_NAME="..."] \
//     npm run create:operator -w apps/api
// La contraseña nunca se imprime.

const prisma = new PrismaClient();

async function main() {
  const operatorEmail = process.env.OPERATOR_EMAIL;
  const operatorPassword = process.env.OPERATOR_PASSWORD;
  const operatorName = process.env.OPERATOR_NAME ?? null;

  if (!operatorEmail || !operatorPassword) {
    console.error(
      'Faltan variables: OPERATOR_EMAIL y OPERATOR_PASSWORD son obligatorias.\n' +
        'Ejemplo: OPERATOR_EMAIL=a@b.com OPERATOR_PASSWORD=... npm run create:operator -w apps/api',
    );
    process.exit(1);
  }

  // Misma política que la API: el operador es la cuenta más poderosa del
  // sistema, no puede ser la peor protegida.
  const email = EmailSchema.parse(operatorEmail);
  const password = PasswordSchema.parse(operatorPassword);

  const existing = await prisma.platformOperator.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    console.error(`Ya existe un operador con el email ${email}. No se hizo ningún cambio.`);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const operator = await prisma.platformOperator.create({
    data: { email, passwordHash, name: operatorName },
    select: { id: true, email: true },
  });

  console.log(`✓ Operador de plataforma creado: ${operator.email}`);
  console.log('  Entrá por /platform/login; las clínicas y sus ADMIN se crean desde ahí.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
