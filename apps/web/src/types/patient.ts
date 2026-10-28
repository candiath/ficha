export interface Patient {
  id: string;
  firstName: string;
  lastName: string;
  // "firstName lastName", built by the API for display.
  fullName: string;
  birthDate: string | null;
  sex: 'MALE' | 'FEMALE' | 'OTHER' | null;
  phone: string | null;
  occupation: string | null;
  referringDoctor: string | null;
  insuranceName: string | null;
  insuranceNumber: string | null;
  insurancePlan: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PatientFormData {
  firstName: string;
  lastName: string;
  birthDate?: string | null;
  sex?: 'MALE' | 'FEMALE' | 'OTHER' | null;
  phone?: string | null;
  occupation?: string | null;
  referringDoctor?: string | null;
  insuranceName?: string | null;
  insuranceNumber?: string | null;
  insurancePlan?: string | null;
}
