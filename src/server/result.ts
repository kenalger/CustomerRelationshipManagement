/**
 * Services return typed results rather than throwing for anything a user can
 * trigger — a validation failure is an outcome, not an exception.
 */
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });

export const err = <T = never>(
  error: string,
  fieldErrors?: Record<string, string[]>,
): Result<T> => ({ ok: false, error, fieldErrors });
