import { useEffect } from 'react';
import { Building2, DatabaseBackup, ExternalLink, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/contexts/AuthContext';

// El workflow que hace el pg_dump vive en un repo aparte y privado
// (candiath/ficha-backups): la credencial de producción no puede estar en el
// repo público de la app. El porqué completo está en la sección Backups de
// CLAUDE.md.
const BACKUP_WORKFLOW_URL =
  'https://github.com/candiath/ficha-backups/actions/workflows/backup.yml';

export default function ClinicPage() {
  useEffect(() => { document.title = 'Clínica'; }, []);

  // RequireAuth garantiza que hay sesión cuando esta página se renderiza.
  //
  // Hasta acá esta pantalla mostraba una clínica inventada —"Clínica Demo
  // RPG", CUIT 30-12345678-9, Av. Corrientes 1234— con un comentario que
  // decía "se leerá del tenant autenticado cuando se implemente JWT". El JWT
  // hace meses que está: lo que faltaba era que /api/auth/me devolviera la
  // clínica. Ahora la devuelve, y lo único que se muestra es lo que existe
  // de verdad en la base: Tenant tiene nombre y slug, nada más.
  const { user } = useAuth();
  const tenant = user?.tenant;

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
                <p className="text-sm font-medium">{tenant?.name ?? '—'}</p>
              </div>
            </div>
            <Separator />
            <div className="flex items-center gap-3">
              <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Identificador (slug)</p>
                <p className="text-sm font-mono">{tenant?.slug ?? '—'}</p>
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
          Los datos de contacto, el CUIT y los horarios de atención todavía no se pueden
          cargar: la clínica solo guarda su nombre e identificador.
        </p>
      </div>
    </div>
  );
}
