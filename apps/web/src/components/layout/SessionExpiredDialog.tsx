import { useState, type FormEvent } from 'react';
import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';

// Shown when the session ended while a form held unsaved text
// (AuthContext's sessionExpired). The form stays mounted underneath with
// everything typed; this asks for the password again, and the user then
// saves as before. Leaving instead throws the text away, and says so.
export default function SessionExpiredDialog() {
  const { user, sessionExpired, relogin, logout } = useAuth();
  const [password, setPassword] = useState('');
  const [trustDevice, setTrustDevice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!sessionExpired || !user) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await relogin(password, trustDevice);
      setPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    // Nothing closes it but logging in or leaving: Escape and a click
    // outside ask onOpenChange, which ignores them.
    <Dialog open onOpenChange={() => {}}>
      <DialogContent showCloseButton={false} role="alertdialog">
        <DialogHeader>
          <DialogTitle>Tu sesión venció</DialogTitle>
          <DialogDescription>
            Lo que escribiste sigue acá. Ingresá tu contraseña y después guardá de nuevo.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="session-expired-password">Contraseña de {user.email}</Label>
            <Input
              id="session-expired-password"
              type="password"
              autoComplete="current-password"
              autoFocus
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Label className="flex items-center gap-2 font-normal cursor-pointer">
            <Checkbox checked={trustDevice} onCheckedChange={(checked) => setTrustDevice(checked === true)} />
            Mantener la sesión iniciada en este dispositivo
          </Label>
          {error && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={logout}>
              Salir sin guardar
            </Button>
            <Button type="submit" disabled={submitting || password === ''}>
              {submitting ? 'Ingresando…' : 'Ingresar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
