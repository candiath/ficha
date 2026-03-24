export interface Technique {
  id: string;
  name: string;
  isGlobal: boolean;
  tenantId: string | null;
  createdAt: string;
}
