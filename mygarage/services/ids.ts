import { z } from 'zod';

const uuid = z.string().uuid();

/** The only shape a file id may have. It ends up inside an R2 object key, so nothing else is allowed. */
export const isFileId = (value: unknown): value is string => uuid.safeParse(value).success;
