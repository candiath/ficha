import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { EmailSchema, PasswordSchema } from '../src/lib/validation';

// Bootstrap de producción: el seed no crea usuarios en prod (a propósito,
// sembraría una credencial conocida), y /api/users exige un ADMIN logueado.
// Este script rompe ese huevo-y-gallina creando la clínica y su primer
// ADMIN desde variables de entorno, sin SQL a mano ni hashes artesanales.
//
// Uso:
//   TENANT_NAME="Clínica X" ADMIN_EMAIL=a@b.com ADMIN_PASSWORD=... \
//     npm run create:admin -w apps/api
// ADMIN_NAME es opcional. La contraseña nunca se imprime.

const prisma = new PrismaClient();

// Slug URL-safe a partir del nombre: minúsculas, sin acentos, guiones.
// NFD separa cada letra acentuada en letra + diacrítico, y \p{M} borra
// esos diacríticos ("Clínica" → "clinica").
function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function main() {
  const tenantName = process.env.TENANT_NAME;
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  const adminName = process.env.ADMIN_NAME ?? null;

  if (!tenantName || !adminEmail || !adminPassword) {
    console.error(
      'Faltan variables: TENANT_NAME, ADMIN_EMAIL y ADMIN_PASSWORD son obligatorias.\n' +
        'Ejemplo: TENANT_NAME="Clínica X" ADMIN_EMAIL=a@b.com ADMIN_PASSWORD=... npm run create:admin -w apps/api',
    );
    process.exit(1);
  }

  // Misma política que la API: si acá se aceptara una contraseña débil,
  // el primer admin sería justamente el usuario peor protegido.
  const email = EmailSchema.parse(adminEmail);
  const password = PasswordSchema.parse(adminPassword);

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    console.error(`Ya existe un usuario con el email ${email}. No se hizo ningún cambio.`);
    process.exit(1);
  }

  // Si la clínica ya existe (mismo slug) se reutiliza: el script también
  // sirve para agregar un ADMIN extra más adelante.
  const slug = slugify(tenantName);
  const tenant =
    (await prisma.tenant.findUnique({ where: { slug } })) ??
    (await prisma.tenant.create({ data: { name: tenantName, slug } }));

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { tenantId: tenant.id, email, passwordHash, name: adminName, role: 'ADMIN' },
    select: { id: true, email: true, role: true },
  });

  console.log(`✓ Clínica "${tenant.name}" (${tenant.slug})`);
  console.log(`✓ Usuario ADMIN creado: ${user.email}`);
  console.log('  Los próximos usuarios se crean desde la API con POST /api/users.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
