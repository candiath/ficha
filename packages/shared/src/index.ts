// Tipos e interfaces compartidos entre apps/api y apps/web.
// Prisma vive exclusivamente en apps/api. Lo que se exporta aquí son
// las interfaces planas que la API expone en sus responses al cliente.
//
// A medida que construyas la app, agregá los tipos acá. Ejemplo:
// export type { Patient } from './types/patient';
// export type { Session } from './types/session';

export interface ApiResponse<T> {
  data: T;
  error?: string;
}
