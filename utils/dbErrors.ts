/**
 * Postgres error plumbing.
 *
 * Drizzle wraps every driver failure in a `DrizzleQueryError` whose `cause` is
 * the raw `pg` error — the object that carries the SQLSTATE `code`, the
 * violated `constraint` and the `detail` line. Both `errorHandler` and any
 * usecase that wants to turn a constraint into a friendlier message go through
 * `pgError()` so nobody has to remember the unwrapping.
 */

export interface PgError extends Error {
  code: string;
  detail?: string;
  constraint?: string;
  table?: string;
  column?: string;
}

/** SQLSTATE codes this codebase reacts to. */
export const PG_UNIQUE_VIOLATION = '23505';
/** `ON DELETE NO ACTION` (and an insert naming a missing parent) raises this… */
export const PG_FOREIGN_KEY_VIOLATION = '23503';
/** …while `ON DELETE RESTRICT`, which this schema uses, raises this one. Same meaning. */
export const PG_RESTRICT_VIOLATION = '23001';

const looksLikePgError = (value: unknown): value is PgError =>
  typeof value === 'object' && value !== null && typeof (value as PgError).code === 'string';

/** The underlying driver error, whether or not Drizzle wrapped it. */
export const pgError = (err: unknown): PgError | null => {
  if (looksLikePgError(err)) return err;
  const cause = (err as { cause?: unknown } | null)?.cause;
  return looksLikePgError(cause) ? cause : null;
};

export const isUniqueViolation = (err: unknown, constraint?: string): boolean => {
  const pg = pgError(err);
  return !!pg && pg.code === PG_UNIQUE_VIOLATION && (!constraint || pg.constraint === constraint);
};

export const isForeignKeyViolation = (err: unknown): boolean => {
  const code = pgError(err)?.code;
  return code === PG_FOREIGN_KEY_VIOLATION || code === PG_RESTRICT_VIOLATION;
};

/**
 * The column a unique violation names, parsed from Postgres's
 * `Key (garage_id, phone)=(…) already exists.` detail line. The last column
 * is the one that varies within a tenant scope — `phone`, `license_plate`,
 * `email` — which is the one worth telling the user about. Reported in
 * camelCase, the way the API names fields.
 */
export const uniqueViolationField = (err: unknown): string => {
  const detail = pgError(err)?.detail ?? '';
  const match = detail.match(/^Key \(([^)]+)\)=/);
  if (!match) return 'field';
  const columns = match[1].split(',').map(c => c.trim());
  const last = columns[columns.length - 1];
  return last.replace(/_([a-z])/g, (_m, ch: string) => ch.toUpperCase());
};
