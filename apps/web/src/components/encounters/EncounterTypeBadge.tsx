import { Badge } from '@/components/ui/badge';
import { ENCOUNTER_TYPE_CLASS, ENCOUNTER_TYPE_LABELS } from '@/lib/labels';
import { cn } from '@/lib/utils';
import type { EncounterType } from '@/types/encounter';

/**
 * Etiqueta de tipo de sesión — y nada cuando el tipo es el común.
 *
 * SESSION es el default y, desde que el tipo se infiere en vez de elegirse, es
 * lo único que sale del flujo normal: una lista es casi toda "Sesión RPG". Un
 * badge que aparece en el 95% de las filas no distingue nada, así que se
 * reserva para la excepción — una nota rápida o un alta.
 */
export function EncounterTypeBadge({
  type,
  className,
}: {
  type: EncounterType;
  className?: string;
}) {
  if (type === 'SESSION') return null;
  return (
    <Badge variant="outline" className={cn(ENCOUNTER_TYPE_CLASS[type], className)}>
      {ENCOUNTER_TYPE_LABELS[type]}
    </Badge>
  );
}
