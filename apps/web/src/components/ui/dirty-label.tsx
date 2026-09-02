import type { ReactNode } from 'react';

/**
 * Etiqueta de campo con marca de "modificado sin guardar".
 *
 * Vivía dentro de PatientDetailPage, pero la usa también el formulario de
 * sesión — y esa página importa ese formulario, así que importarla desde ahí
 * cerraba un ciclo. Al ser la marca compartida de toda la app, su lugar es
 * components/ui.
 */
export function DirtyLabel({ label, dirty }: { label: ReactNode; dirty?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      {label}
      {dirty && (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />
          Modificado
        </span>
      )}
    </span>
  );
}
