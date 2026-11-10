import { bigint, index, integer, pgSequence, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';

export const syncSeq = pgSequence('sync_seq');

export const users = pgTable('users', {
  id: text().primaryKey(), // utils/ids.ts newId()
  googleSub: text().notNull().unique(),
  email: text().notNull(),
  name: text(),
  wrappedKey: text().notNull(), // base64(iv12 | ciphertext | tag16)
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow()
});

export const refreshTokens = pgTable('refresh_tokens', {
  tokenHash: text().primaryKey(), // sha256 hex
  userId: text().notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp({ withTimezone: true }).notNull()
});

export const syncRecords = pgTable('sync_records', {
  scope: text().notNull(), // 'u:<userId>' or 'g:<garageId>', see services/scope.ts
  writerId: text().references(() => users.id, { onDelete: 'set null' }),
  tbl: text().notNull(),
  id: text().notNull(),
  updatedAt: bigint({ mode: 'number' }).notNull(),
  deletedAt: bigint({ mode: 'number' }),
  payload: text().notNull(), // base64 ciphertext from the phone
  seq: bigint({ mode: 'number' }).notNull().default(sql`nextval('sync_seq')`)
}, (t) => [primaryKey({ columns: [t.scope, t.tbl, t.id] }), index().on(t.scope, t.seq)]);

export const cloudFiles = pgTable('cloud_files', {
  scope: text().notNull(),
  ownerId: text().notNull().references(() => users.id, { onDelete: 'cascade' }), // whose quota the file counts against
  fileId: text().notNull(),
  size: integer().notNull(),
  status: text({ enum: ['pending', 'uploaded'] }).notNull(),
  uploadedAt: timestamp({ withTimezone: true })
}, (t) => [primaryKey({ columns: [t.scope, t.fileId] }), index().on(t.ownerId)]);

export const sharedGarages = pgTable('shared_garages', {
  id: text().primaryKey(), // garage UUID made on the phone
  ownerId: text().notNull().references(() => users.id, { onDelete: 'cascade' }),
  wrappedKey: text().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow()
});

export const garageMembers = pgTable('garage_members', {
  garageId: text().notNull().references(() => sharedGarages.id, { onDelete: 'cascade' }),
  userId: text().notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text({ enum: ['owner', 'editor', 'viewer'] }).notNull(),
  addedAt: timestamp({ withTimezone: true }).notNull().defaultNow()
}, (t) => [primaryKey({ columns: [t.garageId, t.userId] }), index().on(t.userId)]);

export const garageInvites = pgTable('garage_invites', {
  id: text().primaryKey().$defaultFn(randomUUID), // random, not newId(): an invite id must not be guessable
  garageId: text().notNull().references(() => sharedGarages.id, { onDelete: 'cascade' }),
  email: text().notNull(),
  role: text({ enum: ['editor', 'viewer'] }).notNull(),
  tokenHash: text().notNull().unique(),
  garageName: text().notNull(),
  inviterName: text().notNull(),
  status: text({ enum: ['pending', 'accepted', 'declined', 'cancelled'] }).notNull(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow()
}, (t) => [index().on(t.email, t.status), index().on(t.garageId)]);
