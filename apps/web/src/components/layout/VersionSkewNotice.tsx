import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { recheckApiVersion } from '@/lib/api';
import { reloadForNewVersion, useVersionSkew, type VersionSkew } from '@/lib/buildVersion';
import { useHasUnsavedChanges } from '@/lib/unsavedChanges';

// While the API's deploy is still running, how often to ask it again.
export const RECHECK_INTERVAL_MS = 30_000;

const COPY: Record<VersionSkew['kind'], { title: string; description: string; canReload: boolean }> = {
  reload: {
    title: 'Hay una versión nueva de Ficha',
    description: 'Recargá para seguir.',
    canReload: true,
  },
  'web-deploying': {
    title: 'Estamos actualizando Ficha',
    description: 'Probá en unos minutos.',
    canReload: true,
  },
  'api-deploying': {
    title: 'Estamos actualizando Ficha',
    description: 'Probá en unos minutos. Este aviso se va solo cuando termine.',
    canReload: false,
  },
};

// Blocks the app while this web is out of step with the API it talks to
// (lib/buildVersion.ts). It never reloads by itself: a form may hold text
// the user has not saved, and then the notice says so and lets her go back to
// it, leaving a banner with the reload button.
export default function VersionSkewNotice() {
  const skew = useVersionSkew();
  const hasUnsavedChanges = useHasUnsavedChanges();
  const [backToForm, setBackToForm] = useState(false);

  const kind = skew?.kind;
  useEffect(() => {
    if (kind !== 'api-deploying') return;
    const timer = window.setInterval(() => void recheckApiVersion(), RECHECK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [kind]);

  if (!kind) return null;
  const copy = COPY[kind];

  const reloadButton = copy.canReload && (
    <Button onClick={reloadForNewVersion}>
      <RefreshCw />
      Recargar
    </Button>
  );

  if (backToForm) {
    return (
      <div
        role="alert"
        className="fixed inset-x-0 top-0 z-[60] flex flex-wrap items-center justify-center gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
      >
        <span>
          {copy.title}. {copy.description}
        </span>
        {reloadButton}
      </div>
    );
  }

  return (
    // Nothing closes it: no close button, and Escape or a click outside ask
    // onOpenChange, which ignores them.
    <Dialog open onOpenChange={() => {}}>
      <DialogContent showCloseButton={false} role="alertdialog">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        {hasUnsavedChanges && (
          <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            {copy.canReload
              ? 'Tenés cambios sin guardar: si recargás, se pierden. Volvé al formulario y copiá lo que escribiste antes de recargar.'
              : 'Tenés cambios sin guardar: no cierres ni recargues esta pestaña hasta que termine la actualización.'}
          </p>
        )}
        <DialogFooter>
          {hasUnsavedChanges && (
            <Button variant="outline" onClick={() => setBackToForm(true)}>
              Volver al formulario
            </Button>
          )}
          {reloadButton}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
