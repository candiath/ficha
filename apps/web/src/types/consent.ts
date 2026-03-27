export interface InformedConsent {
  id: string;
  patientId: string;
  signed: boolean;
  signedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
