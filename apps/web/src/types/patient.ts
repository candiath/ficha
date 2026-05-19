export interface Patient {
  id: string;
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
  fullName: string;
  birthDate?: string | null;
  sex?: 'MALE' | 'FEMALE' | 'OTHER' | null;
  phone?: string | null;
  occupation?: string | null;
  referringDoctor?: string | null;
  insuranceName?: string | null;
  insuranceNumber?: string | null;
  insurancePlan?: string | null;
}
