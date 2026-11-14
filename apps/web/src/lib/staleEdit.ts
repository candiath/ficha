import { ApiError } from '@/lib/api'

// Someone else saved the record after this form loaded it: the API answers 409
// (SPEC-clinical-revisions.md §5).
export function isStaleEdit(err: unknown): err is ApiError {
  return err instanceof ApiError && err.status === 409
}
