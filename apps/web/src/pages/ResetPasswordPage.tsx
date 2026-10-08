import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, Loader2 } from 'lucide-react';
import type { PasswordResetTarget } from '@ficha/shared';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { passwordResetApi } from '@/services/auth';

// The message LoginPage shows after a reset (SPEC-password-reset, decision 2).
export const PASSWORD_RESET_DONE = 'Listo, ya podés ingresar con tu contraseña nueva';

// The API's uniform message, for a URL that has no token at all.
const INVALID_LINK = 'El enlace no es válido o ya venció';

type LinkState =
  | { status: 'checking' }
  | { status: 'invalid'; message: string }
  | { status: 'valid'; target: PasswordResetTarget };

/**
 * Public page behind a reset link: /restablecer-contrasena#<token>
 * (docs/specs/SPEC-password-reset.md). The token travels in the fragment,
 * which never reaches a server, and from here only in request bodies.
 */
export default function ResetPasswordPage() {
  const location = useLocation();
  const navigate = useNavigate();

  // Read once: the effect below takes it out of the address bar.
  const [token] = useState(() => location.hash.replace(/^#/, ''));
  const [link, setLink] = useState<LinkState>(() =>
    token ? { status: 'checking' } : { status: 'invalid', message: INVALID_LINK },
  );
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.title = 'Restablecer contraseña — Ficha RPG';
  }, []);

  // Out of the address bar and the history entry, so it is not left on
  // screen, in a screenshot or for the back button.
  useEffect(() => {
    if (location.hash) navigate({ pathname: location.pathname }, { replace: true });
  }, [location.hash, location.pathname, navigate]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    passwordResetApi
      .check(token)
      .then((target) => !cancelled && setLink({ status: 'valid', target }))
      .catch(
        (err) =>
          !cancelled &&
          setLink({
            status: 'invalid',
            message: err instanceof Error ? err.message : INVALID_LINK,
          }),
      );
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    // The same minimum as the API, checked here so a typo costs no request.
    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres');
      return;
    }
    if (password !== confirmation) {
      setError('Las contraseñas no coinciden');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await passwordResetApi.reset(token, password);
      // To /login and not straight in: the login keeps its throttling and
      // the "trusted device" choice.
      navigate('/login', { replace: true, state: { notice: PASSWORD_RESET_DONE } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar la contraseña');
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <span className="font-semibold text-2xl tracking-tight">Ficha RPG</span>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Restablecer contraseña</CardTitle>
            {link.status === 'valid' && (
              <CardDescription>
                Nueva contraseña para <span className="font-medium">{link.target.email}</span>
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            {link.status === 'checking' && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Verificando el enlace...
              </p>
            )}

            {link.status === 'invalid' && (
              <div className="space-y-2 text-sm">
                <p className="flex items-center gap-2 text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {link.message}
                </p>
                <p className="text-muted-foreground">Pedile un enlace nuevo a quien te lo envió.</p>
              </div>
            )}

            {link.status === 'valid' && (
              <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                {/* For password managers: which account this password is for. */}
                <input
                  type="email"
                  autoComplete="username"
                  value={link.target.email}
                  readOnly
                  hidden
                />
                <div className="space-y-2">
                  <Label htmlFor="new-password">Contraseña nueva</Label>
                  <Input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Repetí la contraseña nueva</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                  />
                </div>

                {error && (
                  <div className="flex items-center gap-2 text-sm text-destructive">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {error}
                  </div>
                )}

                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Guardar contraseña
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
