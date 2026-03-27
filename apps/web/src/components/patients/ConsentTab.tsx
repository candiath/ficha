import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FileCheck,
  Download,
  Printer,
  ShieldCheck,
  AlertCircle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import type { Patient } from '@/types/patient';
import { consentApi, consentKeys } from '@/services/consent';

interface Props {
  patient: Patient;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export default function ConsentTab({ patient }: Props) {
  const queryClient = useQueryClient();
  const { data: consent } = useQuery({
    queryKey: consentKeys.detail(patient.id),
    queryFn: () => consentApi.get(patient.id),
  });

  const signMutation = useMutation({
    mutationFn: () => consentApi.sign(patient.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: consentKeys.detail(patient.id) }),
  });

  const signed = consent?.signed ?? false;
  const signedAt = consent?.signedAt ?? null;

  return (
    <div className="space-y-4">
      {/* Estado del consentimiento */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-muted-foreground" />
          <span className="text-sm font-medium">Estado del consentimiento</span>
        </div>
        <Badge
          variant="outline"
          className={
            signed
              ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300'
              : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300'
          }
        >
          {signed ? 'Firmado' : 'Pendiente'}
        </Badge>
      </div>

      {/* Documento */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Consentimiento informado para tratamiento de RPG
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Documento requerido antes de iniciar el plan de tratamiento
          </p>
        </CardHeader>

        <CardContent className="space-y-4 text-sm leading-relaxed">
          {/* Datos del paciente */}
          <div className="bg-muted/50 rounded-lg px-4 py-3 space-y-1 text-sm">
            <p>
              <span className="font-medium text-muted-foreground">Paciente:</span>{' '}
              {patient.fullName}
            </p>
            {patient.birthDate && (
              <p>
                <span className="font-medium text-muted-foreground">
                  Fecha de nacimiento:
                </span>{' '}
                {formatDate(patient.birthDate)}
              </p>
            )}
            <p>
              <span className="font-medium text-muted-foreground">Fecha:</span>{' '}
              {formatDate(new Date().toISOString())}
            </p>
          </div>

          <Separator />

          {/* Cuerpo del consentimiento */}
          <div className="space-y-4">
            <section className="space-y-1.5">
              <h4 className="font-medium">1. Información sobre el tratamiento</h4>
              <p className="text-muted-foreground">
                La Reeducación Postural Global (RPG) es un método de fisioterapia que
                consiste en posturas de estiramiento global y progresivo, realizadas con la
                participación activa del paciente, con el objetivo de tratar las alteraciones
                morfológicas y funcionales del aparato locomotor.
              </p>
            </section>

            <section className="space-y-1.5">
              <h4 className="font-medium">2. Objetivos del tratamiento</h4>
              <p className="text-muted-foreground">
                El tratamiento tiene como objetivo la mejora de la postura global, el alivio
                del dolor, la recuperación de la flexibilidad y la función articular, y la
                prevención de recurrencias. Los resultados varían según cada paciente y su
                compromiso con el tratamiento.
              </p>
            </section>

            <section className="space-y-1.5">
              <h4 className="font-medium">3. Posibles molestias</h4>
              <p className="text-muted-foreground">
                Durante y después de las sesiones puede experimentar molestias musculares
                temporales, sensación de tensión o fatiga. Estas son reacciones normales del
                proceso terapéutico y suelen remitir en las 24–48 horas posteriores.
              </p>
            </section>

            <section className="space-y-1.5">
              <h4 className="font-medium">4. Derechos del paciente</h4>
              <p className="text-muted-foreground">
                El paciente tiene derecho a recibir información completa sobre su
                tratamiento, a realizar preguntas en cualquier momento, y a revocar este
                consentimiento retirándose del tratamiento sin necesidad de justificación.
              </p>
            </section>

            <section className="space-y-1.5">
              <h4 className="font-medium">5. Confidencialidad</h4>
              <p className="text-muted-foreground">
                Toda la información clínica del paciente será tratada de forma confidencial
                y no será compartida con terceros sin su autorización expresa, salvo en los
                casos previstos por la legislación vigente.
              </p>
            </section>

            <section className="space-y-1.5">
              <h4 className="font-medium">6. Declaración</h4>
              <p className="text-muted-foreground">
                Declaro que he sido informado/a de forma clara y comprensible sobre el
                tratamiento de RPG propuesto, sus beneficios esperados, posibles molestias y
                alternativas. He tenido la oportunidad de formular preguntas y todas han sido
                respondidas satisfactoriamente. Acepto de forma voluntaria someterme al
                tratamiento indicado.
              </p>
            </section>
          </div>

          <Separator />

          {/* Zona de firma */}
          {!signed ? (
            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                  Firma pendiente
                </p>
              </div>
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Al confirmar, se registra que el paciente fue informado sobre el tratamiento
                y aceptó las condiciones descritas en este documento.
              </p>
              <Button
                onClick={() => signMutation.mutate()}
                disabled={signMutation.isPending}
              >
                <FileCheck className="h-4 w-4 mr-2" />
                {signMutation.isPending ? 'Registrando...' : 'Registrar consentimiento'}
              </Button>
            </div>
          ) : (
            <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-green-600 dark:text-green-400" />
                <p className="text-sm font-medium text-green-800 dark:text-green-300">
                  Consentimiento registrado
                </p>
              </div>
              {signedAt && (
                <p className="text-xs text-green-700 dark:text-green-400">
                  Firmado el{' '}
                  {new Date(signedAt).toLocaleDateString('es-AR', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              )}
            </div>
          )}

          {/* Acciones */}
          <div className="flex gap-2 pt-1">
            <Button variant="outline" size="sm" disabled>
              <Download className="h-4 w-4 mr-1.5" />
              Descargar PDF
            </Button>
            <Button variant="outline" size="sm" disabled>
              <Printer className="h-4 w-4 mr-1.5" />
              Imprimir
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
