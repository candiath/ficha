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
//
// TENANT_ID también es opcional, y es la salida para cuando el slug dejó de
// deducirse del nombre (ver resolverClinica).

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

// Cómo se resuelve la clínica, en orden:
//
//   1. TENANT_ID, si viene. Es la salida para cuando el slug ya no se deduce
//      del nombre: la clínica se renombró, o el slug se editó a mano.
//   2. El slug derivado del nombre, que es el caso normal.
//   3. Crearla — pero solo si todavía no hay ninguna clínica.
//
// El paso 3 es el que se arregló. Antes se creaba siempre que la búsqueda por
// slug fallara, así que un simple renombre convertía este script en una
// fábrica de clínicas duplicadas: el ADMIN nuevo quedaba parado en un tenant
// vacío, sin pacientes y sin un solo mensaje de error que lo delatara.
//
// El slug no es una clave: es la única correspondencia nombre→clínica que
// existe, y depende de que nadie renombre nada. Cuando esa correspondencia se
// rompe, la ambigüedad la resuelve la persona con TENANT_ID, no el script
// adivinando.
async function resolverClinica(tenantName: string) {
  const tenantId = process.env.TENANT_ID;

  if (tenantId) {
    const porId = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!porId) {
      console.error(`No existe ninguna clínica con id ${tenantId}. No se hizo ningún cambio.`);
      process.exit(1);
    }
    return porId;
  }

  const slug = slugify(tenantName);
  const porSlug = await prisma.tenant.findUnique({ where: { slug } });
  if (porSlug) return porSlug;

  const existentes = await prisma.tenant.findMany({
    select: { id: true, name: true, slug: true },
    orderBy: { name: 'asc' },
  });

  if (existentes.length > 0) {
    console.error(
      `Ninguna clínica tiene el slug "${slug}" (derivado de "${tenantName}"), ` +
        `pero ya hay ${existentes.length} creada(s). No se creó ninguna clínica nueva.\n` +
        'Si querías una de éstas, volvé a correr con TENANT_ID:\n' +
        existentes.map((t) => `  ${t.id}  ${t.name} (${t.slug})`).join('\n'),
    );
    process.exit(1);
  }

  return prisma.tenant.create({ data: { name: tenantName, slug } });
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

  // Si la clínica ya existe se reutiliza: el script también sirve para
  // agregar un ADMIN extra más adelante.
  const tenant = await resolverClinica(tenantName);

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
