import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { setToken } from '@/lib/api';
import { authApi } from '@/services/auth';
import { toast } from 'sonner';
import type { ChangePasswordResponse } from '@ficha/shared';

// De qué sesión es la contraseña que se cambia: contra qué endpoint se manda
// y dónde se guarda el token nuevo. El formulario, la validación y los
// mensajes son los mismos para la clínica y para el operador de plataforma;
// lo único distinto es esto, así que es lo único que se inyecta. Por defecto,
// la sesión de la clínica (AccountPage no pasa nada).
export interface PasswordSession {
  changePassword: (currentPassword: string, newPassword: string) => Promise<ChangePasswordResponse>;
  setToken: (token: string) => void;
}

const clinicSession: PasswordSession = {
  changePassword: (currentPassword, newPassword) =>
    authApi.changePassword(currentPassword, newPassword),
  setToken,
};

const schema = z
  .object({
    currentPassword: z.string().min(1, 'Ingresá tu contraseña actual'),
    newPassword: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres'),
    confirmPassword: z.string().min(1, 'Repetí la contraseña nueva'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Las contraseñas no coinciden',
    path: ['confirmPassword'],
  })
  .refine((d) => d.newPassword !== d.currentPassword, {
    message: 'La contraseña nueva debe ser distinta de la actual',
    path: ['newPassword'],
  });

type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onClose: () => void;
  session?: PasswordSession;
}

export default function ChangePasswordDialog({ open, onClose, session = clinicSession }: Props) {
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  // Reinicializa el form cada vez que se abre: nunca dejar contraseñas
  // escritas de un intento anterior.
  useEffect(() => {
    if (open) form.reset();
  }, [open, form]);

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      session.changePassword(values.currentPassword, values.newPassword),
    onSuccess: ({ token }) => {
      // El cambio invalidó todos los tokens anteriores, incluido el de esta
      // sesión; guardar el nuevo evita quedar deslogueado.
      session.setToken(token);
      toast.success('Contraseña actualizada');
      form.reset();
      onClose();
    },
    // El mensaje del servidor distingue los casos útiles (contraseña actual
    // incorrecta, demasiados intentos) sin filtrar nada sensible.
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Error al cambiar la contraseña');
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cambiar contraseña</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
            className="space-y-4"
          >
            <FormField
              control={form.control}
              name="currentPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Contraseña actual</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="current-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="newPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Contraseña nueva</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Repetir contraseña nueva</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancelar
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? 'Guardando…' : 'Guardar'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
