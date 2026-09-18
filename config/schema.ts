/**
 * The Postgres schema — every table, index, foreign key and JSON shape.
 *
 * Conventions that keep the API contract identical to the Mongoose era:
 *
 * - Every primary key is `_id`, a `text` column holding a 24-hex ObjectId
 *   (`utils/ids.ts`). The TS property is literally `_id` so a row serialises
 *   with the key both clients already read; the SQL column is `id`. `text`
 *   rather than `char(24)` so a malformed id is simply "not found" instead of
 *   a truncation error.
 * - Reference columns are `<name>Id` (`customerId`); the relation that joins
 *   them is `<name>` (`customer`). `toApi()` in each model collapses the pair
 *   back into the single `customer` key Mongoose produced — an id string when
 *   not joined, an object when it was.
 * - Nested objects and arrays that were embedded subdocuments are JSONB with
 *   the same shape. None of them is queried by its contents.
 * - Numbers are `double precision`, because Mongoose stored JS doubles and
 *   `numeric` would come back as strings and change the tax parity.
 * - Enum-like columns are plain `text`; the allowed values live in
 *   `types/domain.ts` and are enforced by the zod schemas in `models/`. Adding
 *   an enum value therefore never needs a schema migration.
 *
 * Foreign keys are where behaviour deliberately changes from Mongo:
 * `garage_id` cascades (deleting a tenant wipes it, which `adminUsecase`
 * already did by hand), while customer/vehicle/job-card references RESTRICT —
 * an invoice is a financial record and must not vanish because a customer row
 * was removed. The usecases check for dependents first and answer 409.
 *
 * Column names are derived with `casing: 'snake_case'` (set on every
 * `drizzle()` instance and in `drizzle.config.ts`); only `_id` names its
 * column explicitly.
 */

import { relations, sql } from 'drizzle-orm';
import {
  pgTable, text, doublePrecision, integer, boolean, timestamp, jsonb, uniqueIndex, index,
  AnyPgColumn
} from 'drizzle-orm/pg-core';
import { newId } from '../utils/ids';
import { ExpenseCategory, PaymentMethod, Role, VerificationChannel } from '../types/domain';

// ─── JSON shapes ──────────────────────────────────────────────────────────

export interface Address {
  street: string;
  city: string;
  state: string;
  pincode: string;
}

export const EMPTY_ADDRESS: Address = { street: '', city: '', state: '', pincode: '' };

export interface GarageSettings {
  /** Presentation overrides — '' means "inherit from the country table". */
  currency: string;
  locale: string;
  taxLabel: string;
  timezone: string;
  /** Owned by the garage once seeded from its country at creation. */
  taxRate: number;
  laborRatePerHour: number;
  serviceReminderDays: number;
}

export const DEFAULT_GARAGE_SETTINGS: GarageSettings = {
  currency: '',
  locale: '',
  taxLabel: '',
  timezone: '',
  taxRate: 18,
  laborRatePerHour: 500,
  serviceReminderDays: 180
};

export interface Supplier {
  name: string;
  phone: string;
  email: string;
}

export const EMPTY_SUPPLIER: Supplier = { name: '', phone: '', email: '' };

export interface Complaint {
  description: string;
  priority: string;
}

export interface JobCardPhoto {
  url: string;
  caption: string;
  uploadedAt: string;
  uploadedBy: string | null;
}

export interface StatusHistoryEntry {
  status: string;
  changedBy: string | null;
  changedAt: string;
  notes: string;
}

export interface EstimationPart {
  inventoryItem: string | null;
  partName: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface EstimationLabor {
  description: string;
  hours: number;
  ratePerHour: number;
  total: number;
}

export interface Estimation {
  parts: EstimationPart[];
  labor: EstimationLabor[];
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  discount: number;
  grandTotal: number;
  approvedByCustomer: boolean;
  approvedAt: string | null;
  sentAt: string | null;
}

export const EMPTY_ESTIMATION: Estimation = {
  parts: [],
  labor: [],
  subtotal: 0,
  taxRate: 18,
  taxAmount: 0,
  discount: 0,
  grandTotal: 0,
  approvedByCustomer: false,
  approvedAt: null,
  sentAt: null
};

// ─── Shared column helpers ────────────────────────────────────────────────

const idColumn = () => text('id').primaryKey().$defaultFn(newId);

const ts = () => timestamp({ withTimezone: true, mode: 'date' });

/** Mongoose `timestamps: true`, including the touch-on-update. */
const timestamps = {
  createdAt: ts().notNull().defaultNow(),
  updatedAt: ts().notNull().defaultNow().$onUpdate(() => new Date())
};

// ─── Platform-level tables (no garage) ────────────────────────────────────

export const admins = pgTable('admins', {
  _id: idColumn(),
  name: text().notNull(),
  email: text().notNull(),
  password: text().notNull(),
  isActive: boolean().notNull().default(true),
  lastLoginAt: ts(),
  ...timestamps
}, (t) => [
  uniqueIndex('admins_email_unique').on(t.email)
]);

export const appReleases = pgTable('app_releases', {
  _id: idColumn(),
  platform: text().notNull(),
  latestVersion: text().notNull(),
  minSupportedVersion: text().notNull().default(''),
  storeUrl: text().notNull().default(''),
  updateMessage: text().notNull().default(''),
  blockingMessage: text().notNull().default(''),
  enabled: boolean().notNull().default(true),
  updatedBy: text().notNull().default(''),
  ...timestamps
}, (t) => [
  uniqueIndex('app_releases_platform_unique').on(t.platform)
]);

// ─── Tenant root ──────────────────────────────────────────────────────────

export const garages = pgTable('garages', {
  _id: idColumn(),
  name: text().notNull(),
  country: text().notNull().default('IN'),
  address: jsonb().$type<Address>().notNull().default(EMPTY_ADDRESS),
  phone: text().notNull(),
  email: text().notNull().default(''),
  gstNumber: text().notNull().default(''),
  logo: text().notNull().default(''),
  // Nullable: registration inserts the garage before its owner exists, and
  // an owner's deletion leaves the garage rather than cascading into it.
  ownerId: text().references((): AnyPgColumn => users._id, { onDelete: 'set null' }),
  settings: jsonb().$type<GarageSettings>().notNull().default(DEFAULT_GARAGE_SETTINGS),
  ...timestamps
}, (t) => [
  // A single owner cannot have two garages with the same name.
  uniqueIndex('garages_owner_name_unique').on(t.ownerId, t.name)
]);

export const users = pgTable('users', {
  _id: idColumn(),
  name: text().notNull(),
  email: text().notNull(),
  phone: text().notNull(),
  password: text().notNull(),
  role: text().$type<Role>().notNull().default('mechanic'),
  garageId: text().notNull().references(() => garages._id, { onDelete: 'cascade' }),
  avatar: text().notNull().default(''),
  isActive: boolean().notNull().default(true),
  resetPasswordToken: text(),
  resetPasswordExpire: ts(),
  // Null until the owner confirms a code sent to that address. Cleared again
  // by `updateUserProfile` when the address changes — a verified mark must
  // describe the current value. The subscription gate reads these.
  emailVerifiedAt: ts(),
  phoneVerifiedAt: ts(),
  ...timestamps
}, (t) => [
  uniqueIndex('users_email_unique').on(t.email),
  index('users_garage_idx').on(t.garageId)
]);

/**
 * An in-flight verification code. The code itself is stored only as a
 * SHA-256 hash; `target` records the address it was sent to so a code cannot
 * confirm an email or phone the owner has since changed. A row is spent by
 * `consumedAt` — success, too many wrong attempts, or superseded by a newer
 * code for the same channel.
 */
export const verificationChallenges = pgTable('verification_challenges', {
  _id: idColumn(),
  userId: text().notNull().references(() => users._id, { onDelete: 'cascade' }),
  channel: text().$type<VerificationChannel>().notNull(),
  target: text().notNull(),
  codeHash: text().notNull(),
  expiresAt: ts().notNull(),
  attempts: integer().notNull().default(0),
  consumedAt: ts(),
  ...timestamps
}, (t) => [
  index('verification_challenges_user_channel_idx').on(t.userId, t.channel, t.createdAt)
]);

// ─── Tenant data ──────────────────────────────────────────────────────────

export const customers = pgTable('customers', {
  _id: idColumn(),
  name: text().notNull(),
  phone: text().notNull(),
  email: text().notNull().default(''),
  address: jsonb().$type<Address>().notNull().default(EMPTY_ADDRESS),
  garageId: text().notNull().references(() => garages._id, { onDelete: 'cascade' }),
  totalVisits: doublePrecision().notNull().default(0),
  totalSpent: doublePrecision().notNull().default(0),
  notes: text().notNull().default(''),
  ...timestamps
}, (t) => [
  uniqueIndex('customers_garage_phone_unique').on(t.garageId, t.phone),
  index('customers_garage_name_idx').on(t.garageId, t.name)
]);

export const vehicles = pgTable('vehicles', {
  _id: idColumn(),
  licensePlate: text().notNull(),
  make: text().notNull(),
  model: text().notNull(),
  year: integer(),
  color: text().notNull().default(''),
  fuelType: text().notNull().default('petrol'),
  vin: text().notNull().default(''),
  engineNumber: text().notNull().default(''),
  currentOdometerReading: doublePrecision().notNull().default(0),
  customerId: text().notNull().references(() => customers._id, { onDelete: 'restrict' }),
  garageId: text().notNull().references(() => garages._id, { onDelete: 'cascade' }),
  ...timestamps
}, (t) => [
  uniqueIndex('vehicles_garage_plate_unique').on(t.garageId, t.licensePlate),
  index('vehicles_customer_idx').on(t.customerId)
]);

export const inventory = pgTable('inventory', {
  _id: idColumn(),
  partName: text().notNull(),
  partNumber: text().notNull().default(''),
  category: text().notNull().default('other'),
  quantity: doublePrecision().notNull().default(0),
  threshold: doublePrecision().notNull().default(5),
  unitPrice: doublePrecision().notNull(),
  sellingPrice: doublePrecision().notNull().default(0),
  supplier: jsonb().$type<Supplier>().notNull().default(EMPTY_SUPPLIER),
  location: text().notNull().default(''),
  garageId: text().notNull().references(() => garages._id, { onDelete: 'cascade' }),
  isActive: boolean().notNull().default(true),
  ...timestamps
}, (t) => [
  index('inventory_garage_category_idx').on(t.garageId, t.category),
  index('inventory_garage_name_idx').on(t.garageId, t.partName)
]);

export const jobCards = pgTable('job_cards', {
  _id: idColumn(),
  serviceType: text().notNull(),
  jobCardNumber: text().notNull(),
  vehicleId: text().notNull().references(() => vehicles._id, { onDelete: 'restrict' }),
  customerId: text().notNull().references(() => customers._id, { onDelete: 'restrict' }),
  garageId: text().notNull().references(() => garages._id, { onDelete: 'cascade' }),
  complaints: jsonb().$type<Complaint[]>().notNull().default([]),
  photos: jsonb().$type<JobCardPhoto[]>().notNull().default([]),
  // Staff references are `set null` so removing a mechanic never blocks on
  // the cards they once held.
  assignedMechanicId: text().references(() => users._id, { onDelete: 'set null' }),
  assignedAdvisorId: text().references(() => users._id, { onDelete: 'set null' }),
  status: text().notNull().default('new'),
  statusHistory: jsonb().$type<StatusHistoryEntry[]>().notNull().default([]),
  estimation: jsonb().$type<Estimation>().notNull().default(EMPTY_ESTIMATION),
  odometerAtIntake: doublePrecision().notNull(),
  expectedDeliveryDate: ts(),
  actualDeliveryDate: ts(),
  internalNotes: text().notNull().default(''),
  invoiceId: text().references((): AnyPgColumn => invoices._id, { onDelete: 'set null' }),
  createdById: text().references(() => users._id, { onDelete: 'set null' }),
  // Token used in the customer-facing estimation approval link.
  estimationToken: text(),
  ...timestamps
}, (t) => [
  uniqueIndex('job_cards_garage_number_unique').on(t.garageId, t.jobCardNumber),
  index('job_cards_garage_status_idx').on(t.garageId, t.status),
  index('job_cards_garage_created_idx').on(t.garageId, t.createdAt),
  index('job_cards_mechanic_status_idx').on(t.assignedMechanicId, t.status),
  index('job_cards_vehicle_idx').on(t.vehicleId),
  index('job_cards_customer_idx').on(t.customerId)
]);

export const invoices = pgTable('invoices', {
  _id: idColumn(),
  invoiceNumber: text().notNull(),
  jobCardId: text().notNull().references(() => jobCards._id, { onDelete: 'restrict' }),
  customerId: text().notNull().references(() => customers._id, { onDelete: 'restrict' }),
  vehicleId: text().notNull().references(() => vehicles._id, { onDelete: 'restrict' }),
  garageId: text().notNull().references(() => garages._id, { onDelete: 'cascade' }),
  parts: jsonb().$type<EstimationPart[]>().notNull().default([]),
  labor: jsonb().$type<EstimationLabor[]>().notNull().default([]),
  subtotal: doublePrecision().notNull().default(0),
  taxRate: doublePrecision().notNull().default(18),
  taxAmount: doublePrecision().notNull().default(0),
  discount: doublePrecision().notNull().default(0),
  grandTotal: doublePrecision().notNull().default(0),
  paymentStatus: text().notNull().default('unpaid'),
  paymentMethod: text().notNull().default(''),
  amountPaid: doublePrecision().notNull().default(0),
  paidAt: ts(),
  notes: text().notNull().default(''),
  createdById: text().references(() => users._id, { onDelete: 'set null' }),
  ...timestamps
}, (t) => [
  // Mongo never enforced this; the racy counter it replaced could not.
  uniqueIndex('invoices_garage_number_unique').on(t.garageId, t.invoiceNumber),
  index('invoices_garage_created_idx').on(t.garageId, t.createdAt),
  index('invoices_garage_payment_idx').on(t.garageId, t.paymentStatus),
  index('invoices_job_card_idx').on(t.jobCardId)
]);

export const serviceReminders = pgTable('service_reminders', {
  _id: idColumn(),
  vehicleId: text().notNull().references(() => vehicles._id, { onDelete: 'cascade' }),
  customerId: text().notNull().references(() => customers._id, { onDelete: 'cascade' }),
  garageId: text().notNull().references(() => garages._id, { onDelete: 'cascade' }),
  jobCardId: text().references(() => jobCards._id, { onDelete: 'set null' }),
  type: text().notNull().default('periodic_service'),
  nextServiceDate: ts().notNull(),
  nextServiceKm: doublePrecision().notNull().default(0),
  notes: text().notNull().default(''),
  status: text().notNull().default('pending'),
  reminderSentAt: ts(),
  // When the cron last TRIED to send, successful or not — see reminderUsecase.
  lastAttemptAt: ts(),
  ...timestamps
}, (t) => [
  index('service_reminders_garage_date_idx').on(t.garageId, t.nextServiceDate),
  index('service_reminders_garage_status_idx').on(t.garageId, t.status),
  index('service_reminders_vehicle_idx').on(t.vehicleId)
]);

// ─── Relations (what `.populate()` used to walk) ──────────────────────────

/**
 * Money going out, so the dashboard can show profit and not just revenue.
 * Owner/admin only. `expenseDate` is when the money left, which is what a
 * month's profit is about; `createdAt` is merely when it was typed in.
 */
export const expenses = pgTable('expenses', {
  _id: idColumn(),
  garageId: text().notNull().references(() => garages._id, { onDelete: 'cascade' }),
  title: text().notNull(),
  category: text().$type<ExpenseCategory>().notNull().default('other'),
  amount: doublePrecision().notNull(),
  expenseDate: ts().notNull(),
  paymentMethod: text().$type<PaymentMethod>().notNull().default(''),
  notes: text().notNull().default(''),
  createdById: text().references(() => users._id, { onDelete: 'set null' }),
  ...timestamps
}, (t) => [
  index('expenses_garage_date_idx').on(t.garageId, t.expenseDate)
]);

export const garagesRelations = relations(garages, ({ one, many }) => ({
  owner: one(users, { fields: [garages.ownerId], references: [users._id], relationName: 'garageOwner' }),
  staff: many(users, { relationName: 'userGarage' })
}));

export const usersRelations = relations(users, ({ one }) => ({
  garage: one(garages, { fields: [users.garageId], references: [garages._id], relationName: 'userGarage' })
}));

export const customersRelations = relations(customers, ({ one, many }) => ({
  garage: one(garages, { fields: [customers.garageId], references: [garages._id] }),
  vehicles: many(vehicles)
}));

export const vehiclesRelations = relations(vehicles, ({ one, many }) => ({
  customer: one(customers, { fields: [vehicles.customerId], references: [customers._id] }),
  garage: one(garages, { fields: [vehicles.garageId], references: [garages._id] }),
  jobCards: many(jobCards)
}));

export const inventoryRelations = relations(inventory, ({ one }) => ({
  garage: one(garages, { fields: [inventory.garageId], references: [garages._id] })
}));

export const jobCardsRelations = relations(jobCards, ({ one }) => ({
  vehicle: one(vehicles, { fields: [jobCards.vehicleId], references: [vehicles._id] }),
  customer: one(customers, { fields: [jobCards.customerId], references: [customers._id] }),
  garage: one(garages, { fields: [jobCards.garageId], references: [garages._id] }),
  assignedMechanic: one(users, { fields: [jobCards.assignedMechanicId], references: [users._id], relationName: 'jobCardMechanic' }),
  assignedAdvisor: one(users, { fields: [jobCards.assignedAdvisorId], references: [users._id], relationName: 'jobCardAdvisor' }),
  createdBy: one(users, { fields: [jobCards.createdById], references: [users._id], relationName: 'jobCardCreator' }),
  invoice: one(invoices, { fields: [jobCards.invoiceId], references: [invoices._id], relationName: 'jobCardInvoice' })
}));

export const invoicesRelations = relations(invoices, ({ one }) => ({
  jobCard: one(jobCards, { fields: [invoices.jobCardId], references: [jobCards._id], relationName: 'invoiceJobCard' }),
  customer: one(customers, { fields: [invoices.customerId], references: [customers._id] }),
  vehicle: one(vehicles, { fields: [invoices.vehicleId], references: [vehicles._id] }),
  garage: one(garages, { fields: [invoices.garageId], references: [garages._id] }),
  createdBy: one(users, { fields: [invoices.createdById], references: [users._id], relationName: 'invoiceCreator' })
}));

export const expensesRelations = relations(expenses, ({ one }) => ({
  garage: one(garages, { fields: [expenses.garageId], references: [garages._id] }),
  createdBy: one(users, { fields: [expenses.createdById], references: [users._id] })
}));

export const serviceRemindersRelations = relations(serviceReminders, ({ one }) => ({
  vehicle: one(vehicles, { fields: [serviceReminders.vehicleId], references: [vehicles._id] }),
  customer: one(customers, { fields: [serviceReminders.customerId], references: [customers._id] }),
  garage: one(garages, { fields: [serviceReminders.garageId], references: [garages._id] }),
  jobCard: one(jobCards, { fields: [serviceReminders.jobCardId], references: [jobCards._id] })
}));

/** Every table, in an order that satisfies foreign keys on insert. */
export const TABLES_IN_FK_ORDER = [
  admins, appReleases, garages, users, verificationChallenges, customers, vehicles, inventory, jobCards, invoices, serviceReminders
] as const;

/** `TRUNCATE` all tables at once — used by the test harness between tests. */
export const TRUNCATE_ALL = sql`TRUNCATE TABLE admins, app_releases, garages, users, verification_challenges, customers, vehicles, inventory, job_cards, invoices, service_reminders CASCADE`;
