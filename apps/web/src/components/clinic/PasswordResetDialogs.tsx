import { useRef } from 'react';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import type { PasswordResetLink } from '@ficha/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { formatResetExpiry, passwordResetUrl } from '@/lib/passwordReset';

/** Why she cannot log in: she has a link waiting to be used. */
export function PendingResetBadge({ expiresAt }: { expiresAt: string | null }) {
  if (!expiresAt) return null;
  return (
    <Badge variant="outline" className="text-xs">
      Restablecimiento pendiente · vence {formatResetExpiry(expiresAt)}
    </Badge>
  );
}

/**
 * Shows a freshly generated link, once: the API never returns it again, and
 * the caller drops it on close.
 */
export function PasswordResetLinkDialog({
  link,
  name,
  onClose,
}: {
  link: PasswordResetLink | null;
  name: string;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const url = link ? passwordResetUrl(link.token) : '';

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Enlace copiado');
    } catch {
      // No clipboard (an insecure context, a denied permission): leave it
      // selected so it can be copied by hand.
      inputRef.current?.focus();
      inputRef.current?.select();
      toast.error('No se pudo copiar: copialo a mano');
    }
  }

  return (
    <Dialog open={!!link} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Enlace para {name}</DialogTitle>
          <DialogDescription>
            Compartilo por un canal seguro: quien tenga este enlace puede entrar a la cuenta. No se
            vuelve a mostrar.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              readOnly
              value={url}
              aria-label="Enlace para restablecer la contraseña"
              onFocus={(e) => e.currentTarget.select()}
              className="font-mono text-xs"
            />
            <Button variant="outline" size="sm" onClick={copy}>
              <Copy className="h-4 w-4" />
              Copiar
            </Button>
          </div>
          {link && (
            <p className="text-xs text-muted-foreground">
              Vence el {formatResetExpiry(link.expiresAt)} y sirve una sola vez.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Listo</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
