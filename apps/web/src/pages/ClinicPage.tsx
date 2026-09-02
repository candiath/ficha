import { useEffect } from 'react';
import { Building2, Clock, DatabaseBackup, ExternalLink, Globe, Mail, MapPin, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

// El workflow que hace el pg_dump vive en un repo aparte y privado
// (candiath/ficha-backups): la credencial de producción no puede estar en el
// repo público de la app. El porqué completo está en la sección Backups de
// CLAUDE.md.
const BACKUP_WORKFLOW_URL =
  'https://github.com/candiath/ficha-backups/actions/workflows/backup.yml';

// Placeholder — se leerá del tenant autenticado cuando se implemente JWT.
const DEV_TENANT = {
  name: 'Clínica Demo RPG',
  slug: 'demo-rpg',
  email: 'contacto@demo-rpg.com',
  phone: '+54 11 1234-5678',
  address: 'Av. Corrientes 1234, CABA',
  cuit: '30-12345678-9',
  specialty: 'Reeducación Postural Global (RPG)',
  timezone: 'America/Argentina/Buenos_Aires',
  workingHours: 'Lunes a viernes, 8:00 – 20:00',
};

export default function ClinicPage() {
  useEffect(() => { document.title = 'Clínica'; }, []);
  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold tracking-tight">Clínica</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Configuración de tu organización
        </p>
      </div>

      <div className="space-y-4">
        {/* Datos principales */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Datos de la clínica</CardTitle>
              <Button variant="outline" size="sm" disabled>
                Editar
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Nombre</p>
                <p className="text-sm font-medium">{DEV_TENANT.name}</p>
              </div>
            </div>
            <Separator />
            <div className="flex items-center gap-3">
              <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Identificador (slug)</p>
                <p className="text-sm font-mono">{DEV_TENANT.slug}</p>
              </div>
            </div>
            <Separator />
            <div className="flex items-center gap-3">
              <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Dirección</p>
                <p className="text-sm font-medium">{DEV_TENANT.address}</p>
              </div>
            </div>
            <Separator />
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-3">
                <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Teléfono</p>
                  <p className="text-sm font-medium">{DEV_TENANT.phone}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Email</p>
                  <p className="text-sm font-medium">{DEV_TENANT.email}</p>
                </div>
              </div>
            </div>
            <Separator />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">CUIT</p>
                <p className="text-sm font-mono">{DEV_TENANT.cuit}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Especialidad</p>
                <p className="text-sm font-medium">{DEV_TENANT.specialty}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Horarios */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Horarios y zona horaria</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Horario de atención</p>
                <p className="text-sm font-medium">{DEV_TENANT.workingHours}</p>
              </div>
            </div>
            <Separator />
            <div className="flex items-center gap-3">
              <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Zona horaria</p>
                <p className="text-sm font-mono">{DEV_TENANT.timezone}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Backups */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Copia de seguridad</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-3">
              <DatabaseBackup className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm">
                  La base se respalda sola todos los días a las 3:00, y también antes de
                  cada actualización del sistema.
                </p>
                <p className="text-xs text-muted-foreground">
                  Si vas a hacer una carga grande o algo que te dé desconfianza, podés
                  pedir una copia en el momento.
                </p>
              </div>
            </div>
            <Separator />
            {/* Enlace y no botón de acción: disparar el workflow desde acá
                exigiría guardar un token de GitHub con permiso de escritura en
                el entorno de la API. Un link no necesita ninguna credencial
                nueva y deja el mismo resultado a un click. */}
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              render={
                <a
                  href={BACKUP_WORKFLOW_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
            >
              Pedir una copia ahora
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
            <p className="text-xs text-muted-foreground">
              Se abre GitHub en otra pestaña: entrá a <span className="font-medium">Run workflow</span> y
              confirmá. Tarda un par de minutos.
            </p>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground">
          La edición de datos de clínica estará disponible junto con el módulo de autenticación.
        </p>
      </div>
    </div>
  );
}
