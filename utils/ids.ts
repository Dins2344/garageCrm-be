import crypto from 'crypto';

/**
 * Primary keys are 24-hex ObjectIds, generated here, even though the database
 * is Postgres.
 *
 * Both clients read `_id` on every entity and a published mobile build cannot
 * be forced to upgrade, so the id format is part of the API contract. Keeping
 * the ObjectId layout also let the Mongo data migrate 1:1 with no id mapping.
 *
 * Same layout as the original: 4-byte seconds since the epoch, 5 random bytes
 * fixed per process, 3-byte counter with a random start. Time-ordered, so a
 * sort on `_id` still roughly follows creation order.
 */

const PROCESS_RANDOM = crypto.randomBytes(5);
let counter = crypto.randomInt(0, 0xffffff);

export const newId = (): string => {
  const buf = Buffer.alloc(12);
  buf.writeUInt32BE(Math.floor(Date.now() / 1000), 0);
  PROCESS_RANDOM.copy(buf, 4);
  counter = (counter + 1) % 0x1000000;
  buf.writeUIntBE(counter, 9, 3);
  return buf.toString('hex');
};

const OBJECT_ID_HEX = /^[0-9a-fA-F]{24}$/;

/** Shape check only — replaces `Types.ObjectId.isValid`. */
export const isObjectIdHex = (value: unknown): value is string =>
  typeof value === 'string' && OBJECT_ID_HEX.test(value);
