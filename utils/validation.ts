import { z } from 'zod';
import { HttpError } from './httpError';

/**
 * Runs a zod schema and turns a failure into the 400 the API has always sent
 * for bad input: every message joined with '. ', which is exactly what
 * `errorHandler` used to build from a Mongoose `ValidationError`. Clients
 * display that string verbatim, so the format is part of the contract.
 */
export const runSchema = <T extends z.ZodTypeAny>(schema: T, input: unknown): z.output<T> => {
  const result = schema.safeParse(input);
  if (result.success) return result.data;

  const messages = result.error.issues.map(issue => issue.message);
  throw new HttpError(messages.join('. '), 400);
};

/**
 * The building blocks the model schemas share, each carrying the message the
 * corresponding Mongoose validator carried.
 */

/** `required: [true, msg]` + `trim: true`. */
export const requiredString = (message: string) =>
  z.string({ error: message }).trim().min(1, { error: message });

/** `default: ''` + `trim: true` — optional, never null. */
export const optionalString = () => z.string().trim().default('');

/** Mongoose's email regex, unchanged: a 2-3 character TLD is a real constraint on registered users. */
export const EMAIL_PATTERN = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/;

/** `enum: VALUES` — Mongoose's message for a bad enum value was unhelpful; keep ours short. */
export const oneOf = <const T extends readonly [string, ...string[]]>(values: T, label: string) =>
  z.enum(values, { error: `${label} must be one of: ${values.join(', ')}` });

/**
 * Mongoose cast numeric strings from form posts ("12345" -> 12345) before
 * validating. Only a non-empty numeric string is converted; anything else is
 * left for the number check to reject with the field's own message.
 */
const castNumeric = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value)) ? Number(value) : value;

export const numberField = (message = 'Must be a number') =>
  z.preprocess(castNumeric, z.number({ error: message }));

/** `numberField` with Mongoose's `min`/`max` validators and their messages. */
export const boundedNumber = (
  message: string,
  bounds: { min?: [number, string]; max?: [number, string] }
) => {
  let inner = z.number({ error: message });
  if (bounds.min) inner = inner.min(bounds.min[0], { error: bounds.min[1] });
  if (bounds.max) inner = inner.max(bounds.max[0], { error: bounds.max[1] });
  return z.preprocess(castNumeric, inner);
};

/** A date column: ISO strings and epoch numbers cast, `''`/`null` clear it. */
const castDate = (value: unknown): unknown => (value === '' || value === undefined ? null : value);

export const nullableDate = () =>
  z.preprocess(castDate, z.coerce.date({ error: 'Invalid date' }).nullable());

/** An `_id`-shaped reference. Presence is the only check; existence is the FK's job. */
export const idField = (message: string) =>
  z.string({ error: message }).trim().min(1, { error: message });
