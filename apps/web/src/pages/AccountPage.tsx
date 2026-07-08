import { useEffect } from 'react';
import { KeyRound, Mail, ShieldCheck, User, UserCog } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/contexts/AuthContext';
import type { UserRole } from '@ficha/shared';

const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: 'Administrador',
  THERAPIST: 'Fisioterapeuta',
};

// "María García" → "MG"; sin nombre, la inicial del email.
function getInitials(name: string | null, email: string): string {
  if (!name) return email.charAt(0).toUpperCase();
  return name
    .split(/\s+/)
    .map((w) => w.charAt(0))
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export default function AccountPage() {
  const { user } = useAuth();
  useEffect(() => { document.title = 'Mi cuenta'; }, []);

  // RequireAuth garantiza sesión, pero TypeScript no lo sabe.
  if (!user) return null;

  const profile = {
    name: user.name ?? user.email,
    email: user.email,
    role: ROLE_LABELS[user.role],
    initials: getInitials(user.name, user.email),
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold tracking-tight">Mi cuenta</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Información de tu perfil y credenciales de acceso
        </p>
      </div>

      <div className="space-y-4">
        {/* Avatar + perfil */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Perfil</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="flex items-center justify-center w-14 h-14 rounded-full bg-primary text-primary-foreground text-lg font-semibold shrink-0">
                {profile.initials}
              </div>
              <div>
                <p className="font-medium">{profile.name}</p>
                <p className="text-sm text-muted-foreground">{profile.email}</p>
                <Badge variant="outline" className="mt-1 text-xs">{profile.role}</Badge>
              </div>
            </div>

            <Separator />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex items-center gap-3">
                <User className="h-4 w-4 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Nombre completo</p>
                  <p className="text-sm font-medium">{profile.name}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Email</p>
                  <p className="text-sm font-medium">{profile.email}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <UserCog className="h-4 w-4 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Rol</p>
                  <p className="text-sm font-medium">{profile.role}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Seguridad */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Seguridad</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <KeyRound className="h-4 w-4 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-sm font-medium">Contraseña</p>
                  <p className="text-xs text-muted-foreground">Último cambio: nunca</p>
                </div>
              </div>
              <Button variant="outline" size="sm" disabled>
                Cambiar
              </Button>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <ShieldCheck className="h-4 w-4 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-sm font-medium">Autenticación en dos pasos</p>
                  <p className="text-xs text-muted-foreground">Capa extra de seguridad para tu cuenta</p>
                </div>
              </div>
              <Badge variant="secondary" className="text-xs">Próximamente</Badge>
            </div>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground">
          La edición de perfil y el cambio de contraseña estarán disponibles próximamente.
        </p>
      </div>
    </div>
  );
}
