import { Badge } from '@/components/ui/badge';
import { SESSION_TYPE_CLASS, SESSION_TYPE_LABELS } from '@/lib/labels';
import { cn } from '@/lib/utils';
import type { SessionType } from '@/types/session';

/**
 * Etiqueta de tipo de sesión — y nada cuando el tipo es el común.
 *
 * SESSION es el default y, desde que el tipo se infiere en vez de elegirse, es
 * lo único que sale del flujo normal: una lista es casi toda "Sesión RPG". Un
 * badge que aparece en el 95% de las filas no distingue nada, así que se
 * reserva para la excepción — una nota rápida o un alta.
 */
export function SessionTypeBadge({
  type,
  className,
}: {
  type: SessionType;
  className?: string;
}) {
  if (type === 'SESSION') return null;
  return (
    <Badge variant="outline" className={cn(SESSION_TYPE_CLASS[type], className)}>
      {SESSION_TYPE_LABELS[type]}
    </Badge>
  );
}
