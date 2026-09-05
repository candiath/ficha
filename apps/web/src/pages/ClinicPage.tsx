import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Building2,
  Clock,
  DatabaseBackup,
  ExternalLink,
  Globe,
  Mail,
  MapPin,
  Phone,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import ClinicEditDialog from '@/components/clinic/ClinicEditDialog';
import { useAuth } from '@/contexts/AuthContext';
import { ARGENTINA_TIMEZONES, formatSchedule } from '@/lib/clinicSchedule';
import { tenantApi, tenantKeys } from '@/services/tenant';

// El workflow que hace el pg_dump vive en un repo aparte y privado
// (candiath/ficha-backups): la credencial de producción no puede estar en el
// repo público de la app. El porqué completo está en la sección Backups de
// CLAUDE.md.
const BACKUP_WORKFLOW_URL =
  'https://github.com/candiath/ficha-backups/actions/workflows/backup.yml';

/**
 * Un dato de la clínica, que puede no estar cargado todavía.
 *
 * "Sin cargar" en gris y en itálica, y nunca un valor de ejemplo: esta
 * pantalla mostraba una clínica inventada entera —CUIT 30-12345678-9, Av.
 * Corrientes 1234— y el problema no era que faltaran los datos sino que los
 * falsos no se distinguían de los reales.
 */
function Dato({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon?: React.ElementType;
  label: string;
  value: string | null;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      {Icon && <Icon className="h-4 w-4 text-muted-foreground shrink-0" />}
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        {value ? (
          <p className={mono ? 'text-sm font-mono' : 'text-sm font-medium'}>{value}</p>
        ) : (
          <p className="text-sm text-muted-foreground italic">Sin cargar</p>
        )}
      </div>
    </div>
  );
}

export default function ClinicPage() {
  useEffect(() => { document.title = 'Clínica'; }, []);
  const [editOpen, setEditOpen] = useState(false);

  // RequireAuth garantiza que hay sesión cuando esta página se renderiza.
  // Editar es solo de ADMIN: la API responde 403 a un THERAPIST, así que el
  // botón se oculta en vez de dejarlo fallar.
  const { user } = useAuth();
  const esAdmin = user?.role === 'ADMIN';

  // /api/auth/me trae el nombre y el slug (la identidad de la sesión); acá
  // hace falta la configuración completa, que es de esta pantalla.
  const { data: tenant, isLoading, isError } = useQuery({
    queryKey: tenantKeys.config,
    queryFn: tenantApi.get,
  });

  const zonaLabel =
    ARGENTINA_TIMEZONES.find((tz) => tz.value === tenant?.timezone)?.label ??
    tenant?.timezone ??
    null;

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold tracking-tight">Clínica</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Configuración de tu organización
        </p>
      </div>

      {isError && (
        <p className="text-destructive text-sm mb-4">
          No se pudieron cargar los datos de la clínica.
        </p>
      )}

      <div className="space-y-4">
        {/* Datos principales */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Datos de la clínica</CardTitle>
              {esAdmin && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditOpen(true)}
                  disabled={!tenant}
                >
                  Editar
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Cargando...</p>
            ) : (
              <>
                <Dato icon={Building2} label="Nombre" value={tenant?.name ?? null} />
                <Separator />
                <Dato
                  icon={Globe}
                  label="Identificador (slug)"
                  value={tenant?.slug ?? null}
                  mono
                />
                <Separator />
                <Dato icon={MapPin} label="Dirección" value={tenant?.address ?? null} />
                <Separator />
                <div className="grid grid-cols-2 gap-4">
                  <Dato icon={Phone} label="Teléfono" value={tenant?.phone ?? null} />
                  <Dato icon={Mail} label="Email" value={tenant?.email ?? null} />
                </div>
                <Separator />
                <div className="grid grid-cols-2 gap-4">
                  <Dato label="CUIT" value={tenant?.cuit ?? null} mono />
                  <Dato label="Especialidad" value={tenant?.specialty ?? null} />
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Horarios */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Horarios y zona horaria</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Dato
              icon={Clock}
              label="Horario de atención"
              value={
                tenant
                  ? formatSchedule(tenant.workdays, tenant.workdayStart, tenant.workdayEnd)
                  : null
              }
            />
            <Separator />
            <Dato icon={Globe} label="Zona horaria" value={zonaLabel} />
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

        {!esAdmin && (
          <p className="text-xs text-muted-foreground">
            Solo un administrador de la clínica puede editar estos datos.
          </p>
        )}
      </div>

      {tenant && (
        <ClinicEditDialog
          tenant={tenant}
          open={editOpen}
          onClose={() => setEditOpen(false)}
        />
      )}
    </div>
  );
}
