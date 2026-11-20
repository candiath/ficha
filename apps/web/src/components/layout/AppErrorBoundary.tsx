import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Without a boundary, an error while rendering unmounts the whole app and
// leaves a blank page with no message: the user cannot tell a bug from a
// network problem, and we cannot tell what she saw. This one catches it,
// says so in Spanish, and offers a reload.
//
// The case that made it necessary: a browser translator (Chrome's) rewrites
// the page's text nodes behind React's back, and React then fails to update
// them (`removeChild` / `insertBefore` on a node that is no longer there).
// index.html marks the page as Spanish and not to be translated; the hint
// below covers a translator that ignores it.
export default class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    // React logs the error too; this keeps the component stack next to it.
    console.error('App crashed while rendering', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <div role="alert" className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-md space-y-4 text-center">
          <h1 className="text-xl font-semibold">Algo salió mal al mostrar esta pantalla</h1>
          <p className="text-sm text-muted-foreground">
            Recargá la página para seguir. Si tenés activado el traductor del navegador, desactivalo
            para este sitio: puede romper la pantalla.
          </p>
          <Button onClick={() => window.location.reload()}>
            <RefreshCw />
            Recargar
          </Button>
        </div>
      </div>
    );
  }
}
