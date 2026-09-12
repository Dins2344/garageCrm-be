/**
 * Turns a database row (plus whatever relations were joined) into the JSON
 * shape the clients have always received from Mongoose.
 *
 * The rules are small and mechanical:
 *
 * - A reference column `customerId` becomes `customer`. If the relation
 *   `customer` was joined it wins and the id column is dropped — exactly how a
 *   populated ref replaced the id in a Mongoose document. An un-joined ref is
 *   the id string, or `null`.
 * - Secrets never leave: `password` and the reset-token pair were
 *   `select: false` on the schema and are stripped unconditionally here.
 * - Nested relation objects and arrays are serialised recursively; JSONB
 *   payloads pass through untouched because their keys are already in API
 *   form (none of them ends in `Id`).
 * - Dates stay `Date` — Express serialises them to ISO strings, as before.
 *
 * `_id` is `_id` already; there is no `__v` and no virtual `id`, neither of
 * which either client reads.
 */

const HIDDEN_KEYS = new Set(['password', 'resetPasswordToken', 'resetPasswordExpire']);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);

const isRefKey = (key: string): boolean => key.length > 2 && key.endsWith('Id') && key !== '_id';

export type ApiObject = Record<string, unknown>;

export const serializeRow = (row: object): ApiObject => {
  const source = row as Record<string, unknown>;
  const out: ApiObject = {};

  for (const [key, value] of Object.entries(source)) {
    if (HIDDEN_KEYS.has(key)) continue;

    if (isRefKey(key)) {
      const bare = key.slice(0, -2);
      if (bare in source) continue; // the joined relation carries the object
      out[bare] = value ?? null;
      continue;
    }

    out[key] = serializeValue(value);
  }

  return out;
};

const serializeValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(serializeValue);
  if (isPlainObject(value)) return serializeRow(value);
  return value;
};

export const serializeRows = (rows: object[]): ApiObject[] => rows.map(serializeRow);
