import { bigint, index, integer, pgSequence, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const syncSeq = pgSequence('sync_seq');

export const users = pgTable('users', {
  id: text().primaryKey(), // utils/ids.ts newId()
  googleSub: text().notNull().unique(),
  email: text().notNull(),
  wrappedKey: text().notNull(), // base64(iv12 | ciphertext | tag16)
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow()
});

export const refreshTokens = pgTable('refresh_tokens', {
  tokenHash: text().primaryKey(), // sha256 hex
  userId: text().notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp({ withTimezone: true }).notNull()
});

export const syncRecords = pgTable('sync_records', {
  userId: text().notNull().references(() => users.id, { onDelete: 'cascade' }),
  tbl: text().notNull(),
  id: text().notNull(),
  updatedAt: bigint({ mode: 'number' }).notNull(),
  deletedAt: bigint({ mode: 'number' }),
  payload: text().notNull(), // base64 ciphertext from the phone
  seq: bigint({ mode: 'number' }).notNull().default(sql`nextval('sync_seq')`)
}, (t) => [primaryKey({ columns: [t.userId, t.tbl, t.id] }), index().on(t.userId, t.seq)]);

export const cloudFiles = pgTable('cloud_files', {
  userId: text().notNull().references(() => users.id, { onDelete: 'cascade' }),
  fileId: text().notNull(),
  size: integer().notNull(),
  status: text({ enum: ['pending', 'uploaded'] }).notNull(),
  uploadedAt: timestamp({ withTimezone: true })
}, (t) => [primaryKey({ columns: [t.userId, t.fileId] })]);
