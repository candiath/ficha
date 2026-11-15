import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
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
import RevisionReasonField from '@/components/patients/RevisionReasonField';
import { useRevisionReason } from '@/hooks/useRevisionReason';
import StaleRecordNotice from '@/components/patients/StaleRecordNotice'
import { isStaleEdit } from '@/lib/staleEdit';
import { ApiError } from '@/lib/api';
import { DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS, normalizeDocumentNumber } from '@ficha/shared';

// The select's value for "no document": a Select has no empty value.
const NO_DOCUMENT = 'NONE';

const schema = z
  .object({
  firstName: z.string().trim().min(1, 'El nombre es obligatorio'),
  lastName: z.string().trim().min(1, 'El apellido es obligatorio'),
  birthDate: z.string().optional().or(z.literal('')),
  sex: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
  documentType: z.enum([NO_DOCUMENT, ...DOCUMENT_TYPES]),
  documentNumber: z.string(),
  phone: z.string().optional().or(z.literal('')),
  occupation: z.string().optional().or(z.literal('')),
  referringDoctor: z.string().optional().or(z.literal('')),
  insuranceName: z.string().optional().or(z.literal('')),
  insuranceNumber: z.string().optional().or(z.literal('')),
  insurancePlan: z.string().optional().or(z.literal('')),
  })
  // The same rules as the API, with the same function, so the form says it
  // before sending: a type and a number go together, and the number is one
  // its type accepts.
  .superRefine((values, ctx) => {
    const number = values.documentNumber.trim();
    if (values.documentType === NO_DOCUMENT) {
      if (number) ctx.addIssue({ code: 'custom', path: ['documentType'], message: 'Elegí el tipo de documento' });
      return;
    }
    if (!number) {
      ctx.addIssue({ code: 'custom', path: ['documentNumber'], message: 'Ingresá el número de documento' });
      return;
    }
    const normalized = normalizeDocumentNumber(values.documentType, number);
    if (!normalized.ok) ctx.addIssue({ code: 'custom', path: ['documentNumber'], message: normalized.error });
  });

import { SEX_LABELS } from '@/lib/labels';

// The API's 409 for a document another patient of the clinic has: its body
// names her. Any other 409 on an edit is a stale version.
function isDocumentTaken(err: unknown): err is ApiError {
  return err instanceof ApiError && err.status === 409 && 'holder' in err.body;
}

type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onClose: () => void;
  // The patient to edit, from a list or the record: the form reads the record
  // itself, with its version, and renders from it.
  patient?: Patient;
}

function valuesOf(patient: Patient | undefined): FormValues {
  return {
    firstName: patient?.firstName ?? '',
    lastName: patient?.lastName ?? '',
    birthDate: patient?.birthDate ?? '',
    sex: patient?.sex ?? undefined,
    documentType: patient?.documentType ?? NO_DOCUMENT,
    documentNumber: patient?.documentNumber ?? '',
    phone: patient?.phone ?? '',
    occupation: patient?.occupation ?? '',
    referringDoctor: patient?.referringDoctor ?? '',
    insuranceName: patient?.insuranceName ?? '',
    insuranceNumber: patient?.insuranceNumber ?? '',
    insurancePlan: patient?.insurancePlan ?? '',
  };
}

export default function PatientFormDialog({ open, onClose, patient }: Props) {
  const queryClient = useQueryClient();
  const isEditing = !!patient;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      firstName: '',
      lastName: '',
      birthDate: '',
      sex: undefined,
      documentType: NO_DOCUMENT,
      documentNumber: '',
      phone: '',
      occupation: '',
      referringDoctor: '',
      insuranceName: '',
      insuranceNumber: '',
      insurancePlan: '',
    },
  });

  // An edit renders from the record, read fresh each time the dialog opens: a
  // list item has no version (SPEC-clinical-revisions.md §5). Its own key, so a
  // refetch of the record page does not replace what is being typed.
  const recordQuery = useQuery({
    queryKey: [...patientKeys.detail(patient?.id ?? ''), 'edit'],
    queryFn: () => patientApi.get(patient!.id),
    enabled: open && isEditing,
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const record = isEditing ? recordQuery.data : undefined;
  const loading = isEditing && (!record || recordQuery.isFetching);

  const revision = useRevisionReason();
  // The API's message when someone else saved first; what was typed stays.
  const [staleMessage, setStaleMessage] = useState<string | null>(null);

  // Reinicializa el form cada vez que se abre, y con la versión recién leída.
  useEffect(() => {
    if (open && (!isEditing || record)) form.reset(valuesOf(record));
  }, [open, isEditing, record, form]);

  const mutation = useMutation({
    mutationFn: ({ documentType, documentNumber, ...values }: FormValues) => {
      // Type and number travel together; "no document" is both empty.
      const data = {
        ...values,
        documentType: documentType === NO_DOCUMENT ? null : documentType,
        documentNumber: documentType === NO_DOCUMENT ? null : documentNumber,
      };
      return isEditing
        ? patientApi.update(patient.id, {
            ...data,
            expectedVersion: record?.version,
            reason: revision.reason ?? undefined,
            reasonNote: revision.note,
          })
        : patientApi.create(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: patientKeys.all });
      toast.success(isEditing ? 'Paciente actualizado' : 'Paciente creado');
      form.reset();
      close();
    },
    onError: (err: Error) => {
      // Another patient has that document: said on the field, with her name,
      // and what was typed stays.
      if (isDocumentTaken(err)) {
        form.setError('documentNumber', { message: err.message });
        return;
      }
      if (isEditing && isStaleEdit(err)) {
        setStaleMessage(err.message);
        return;
      }
      toast.error(err.message || 'Error al guardar el paciente');
    },
  });

  function close() {
    setStaleMessage(null);
    revision.reset();
    onClose();
  }

  async function reload() {
    await recordQuery.refetch();
    setStaleMessage(null);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Editar paciente' : 'Nuevo paciente'}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <p className="py-6 text-sm text-muted-foreground">Cargando...</p>
        ) : (
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((v) => {
              if (isEditing && !revision.require()) return;
              mutation.mutate(v);
            })}
            className="space-y-4"
          >
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="firstName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nombre *</FormLabel>
                    <FormControl>
                      <Input placeholder="María José" autoComplete="off" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="lastName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Apellido *</FormLabel>
                    <FormControl>
                      <Input placeholder="García López" autoComplete="off" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

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

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="documentType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo de documento</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger aria-label="Tipo de documento">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NO_DOCUMENT}>Sin documento</SelectItem>
                        {DOCUMENT_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {DOCUMENT_TYPE_LABELS[type]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="documentNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Número de documento</FormLabel>
                    <FormControl>
                      <Input placeholder="30.123.456" autoComplete="off" {...field} />
                    </FormControl>
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

            {isEditing && (
              <div className="space-y-3 border-t pt-4">
                <RevisionReasonField {...revision.fieldProps} />
                {staleMessage && (
                  <StaleRecordNotice message={staleMessage} reloading={recordQuery.isFetching} onReload={() => void reload()} />
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={close}>
                Cancelar
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? 'Guardando...' : 'Guardar'}
              </Button>
            </div>
          </form>
        </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
