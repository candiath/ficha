export interface InformedConsent {
  id: string;
  patientId: string;
  // Derived by the API: signed and not revoked.
  signed: boolean;
  signedAt: string;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
