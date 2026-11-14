import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useBeforeUnload } from 'react-router-dom';

// Which forms on screen hold text the user has not saved. A form reports it
// with useUnsavedChanges(dirty), which also asks the browser to confirm before
// the page is closed or reloaded. The version notice reads it with
// useHasUnsavedChanges(), so it can warn before its own reload button throws
// that text away (lib/buildVersion.ts).

const dirtyForms = new Set<symbol>();
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

/** Reports whether this form has unsaved changes, while it is mounted. */
export function useUnsavedChanges(hasUnsavedChanges: boolean): void {
  useBeforeUnload(
    useCallback(
      (e: BeforeUnloadEvent) => {
        if (hasUnsavedChanges) e.preventDefault();
      },
      [hasUnsavedChanges],
    ),
  );

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const form = Symbol('dirty form');
    dirtyForms.add(form);
    notify();
    return () => {
      dirtyForms.delete(form);
      notify();
    };
  }, [hasUnsavedChanges]);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether any form on screen has unsaved changes. */
export function useHasUnsavedChanges(): boolean {
  return useSyncExternalStore(subscribe, () => dirtyForms.size > 0);
}
