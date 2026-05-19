import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { patientApi, patientKeys } from '@/services/patients';
import type { Patient } from '@/types/patient';
import { toast } from 'sonner';

const schema = z.object({
  fullName: z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
  birthDate: z.string().optional().or(z.literal('')),
  sex: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
  phone: z.string().optional().or(z.literal('')),
  occupation: z.string().optional().or(z.literal('')),
  referringDoctor: z.string().optional().or(z.literal('')),
  insuranceName: z.string().optional().or(z.literal('')),
  insuranceNumber: z.string().optional().or(z.literal('')),
  insurancePlan: z.string().optional().or(z.literal('')),
});

import { SEX_LABELS } from '@/lib/labels';

type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onClose: () => void;
  patient?: Patient;
}

export default function PatientFormDialog({ open, onClose, patient }: Props) {
  const queryClient = useQueryClient();
  const isEditing = !!patient;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      fullName: '',
      birthDate: '',
      sex: undefined,
      phone: '',
      occupation: '',
      referringDoctor: '',
      insuranceName: '',
      insuranceNumber: '',
      insurancePlan: '',
    },
  });

  // Reinicializa el form cada vez que se abre (o cambia el paciente a editar)
  useEffect(() => {
    if (open) {
      form.reset({
        fullName: patient?.fullName ?? '',
        birthDate: patient?.birthDate ? patient.birthDate.slice(0, 10) : '',
        sex: patient?.sex ?? undefined,
        phone: patient?.phone ?? '',
        occupation: patient?.occupation ?? '',
        referringDoctor: patient?.referringDoctor ?? '',
        insuranceName: patient?.insuranceName ?? '',
        insuranceNumber: patient?.insuranceNumber ?? '',
        insurancePlan: patient?.insurancePlan ?? '',
      });
    }
  }, [open, patient]);

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const data = {
        ...values,
        birthDate: values.birthDate || null,
        phone: values.phone || null,
        occupation: values.occupation || null,
        referringDoctor: values.referringDoctor || null,
        insuranceName: values.insuranceName || null,
        insuranceNumber: values.insuranceNumber || null,
        insurancePlan: values.insurancePlan || null,
      };
      return isEditing
        ? patientApi.update(patient.id, data)
        : patientApi.create(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: patientKeys.all });
      toast.success(isEditing ? 'Paciente actualizado' : 'Paciente creado');
      form.reset();
      onClose();
    },
    onError: () => {
      toast.error('Error al guardar el paciente');
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Editar paciente' : 'Nuevo paciente'}
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
            className="space-y-4"
          >
            <FormField
              control={form.control}
              name="fullName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre completo *</FormLabel>
                  <FormControl>
                    <Input placeholder="María García" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="birthDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fecha de nacimiento</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="sex"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sexo</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? ''}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccionar" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {Object.entries(SEX_LABELS).map(([val, label]) => (
                          <SelectItem key={val} value={val}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Teléfono</FormLabel>
                  <FormControl>
                    <Input placeholder="+54 11 1234-5678" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="occupation"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Ocupación</FormLabel>
                  <FormControl>
                    <Input placeholder="Docente" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="referringDoctor"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Médico derivante</FormLabel>
                  <FormControl>
                    <Input placeholder="Dr. López" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Cobertura médica */}
            <div className="border-t pt-4">
              <p className="text-sm font-medium mb-3">Cobertura médica</p>
              <div className="space-y-3">
                <FormField
                  control={form.control}
                  name="insuranceName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Obra social / Prepaga</FormLabel>
                      <FormControl>
                        <Input placeholder="OSDE, Swiss Medical, IOMA…" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="insuranceNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Número de afiliado</FormLabel>
                        <FormControl>
                          <Input placeholder="1234567" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="insurancePlan"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Plan</FormLabel>
                        <FormControl>
                          <Input placeholder="210, Gold…" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            </div>

            {mutation.isError && (
              <p className="text-destructive text-sm">
                {mutation.error?.message ?? 'Error al guardar'}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancelar
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? 'Guardando...' : 'Guardar'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
