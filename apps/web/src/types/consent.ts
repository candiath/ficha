export interface InformedConsent {
  id: string;
  patientId: string;
  // Derived by the API: signed and not revoked.
  signed: boolean;
  signedAt: string;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // The latest version (0: none yet).
  version: number;
}
