import { MongoClient, ObjectId } from 'mongodb';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { count, eq, sql } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import * as schema from '../config/schema';
import { Db, MIGRATIONS_FOLDER } from '../config/db';
import { DEFAULT_COUNTRY } from '../config/countries';

/**
 * One-shot copy of the MongoDB Atlas data into PostgreSQL.
 *
 * Runs from a developer machine with both connection strings, never inside the
 * image. It only ever READS the Mongo side. Ids are preserved as their 24-hex
 * strings, so nothing a client has cached or bookmarked changes meaning.
 *
 * Usage:
 *   MONGO_SOURCE_URI='mongodb+srv://...' PG_TARGET_URL='postgresql://...' \
 *     npx tsx scripts/migrateFromMongo.ts [--dry-run] [--wipe]
 *
 *   (or pass --from <mongo uri> --to <postgres url>; env vars keep the
 *   credentials out of the shell history.)
 *
 * Phases:
 *   1. Pre-flight — load every collection, print counts, run every check the
 *      new schema's constraints would otherwise fail on. Any "abort" finding
 *      stops here; nothing is written until the list is empty.
 *   2. Load — the target must be empty, or --wipe truncates it. Rows are
 *      inserted in foreign-key order inside one transaction.
 *   3. Verify — counts per table and per-garage checksums against the loaded
 *      Mongo documents. A mismatch exits non-zero.
 *
 * --dry-run stops after phase 1.
 *
 * The phases are exported so `tests/migrateFromMongo.test.ts` can drive
 * fabricated Mongo documents through them against PGlite.
 */

// ─── Helpers ──────────────────────────────────────────────────────────────

export type Doc = Record<string, any>;

export interface SourceCollections {
  admins: Doc[];
  appReleases: Doc[];
  garages: Doc[];
  users: Doc[];
  customers: Doc[];
  vehicles: Doc[];
  inventory: Doc[];
  jobCards: Doc[];
  invoices: Doc[];
  serviceReminders: Doc[];
}

/** An ObjectId, a string, or a populated `{ _id }` — as its 24-hex string, or null. */
export const hex = (value: unknown): string | null => {
  if (!value) return null;
  if (value instanceof ObjectId) return value.toHexString();
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && '_id' in (value as Doc)) return hex((value as Doc)._id);
  return null;
};

const iso = (value: unknown): string | null => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value as string);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const date = (value: unknown, fallback: Date = new Date()): Date => {
  if (!value) return fallback;
  const d = value instanceof Date ? value : new Date(value as string);
  return Number.isNaN(d.getTime()) ? fallback : d;
};

const str = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : value == null ? fallback : String(value));
const num = (value: unknown, fallback = 0): number => (typeof value === 'number' && !Number.isNaN(value) ? value : fallback);
const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);

/** Embedded sub-documents keep their `_id` (clients may key on it), as hex. */
const subdocId = (d: Doc): Doc => (d && d._id ? { _id: hex(d._id) } : {});

const chunk = <T>(rows: T[], size = 500): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
};

const idsOf = (docs: Doc[]) => new Set(docs.map(d => hex(d._id)!));

// ─── Phase 1: pre-flight ──────────────────────────────────────────────────

export interface Findings {
  /** The new schema would reject these; nothing is written while any exist. */
  aborts: string[];
  /** Migrated, with the stated adjustment. */
  warnings: string[];
}

export const preflight = (src: SourceCollections): Findings => {
  const aborts: string[] = [];
  const warnings: string[] = [];
  const abort = (msg: string) => aborts.push(msg);
  const warn = (msg: string) => warnings.push(msg);

  const garageIds = idsOf(src.garages);
  const userIds = idsOf(src.users);
  const customerIds = idsOf(src.customers);
  const vehicleIds = idsOf(src.vehicles);
  const jobCardIds = idsOf(src.jobCards);
  const invoiceIds = idsOf(src.invoices);

  // Existence of required parents — these become NOT NULL foreign keys.
  for (const u of src.users) {
    if (!garageIds.has(hex(u.garage) ?? '')) abort(`users ${hex(u._id)} (${u.email}): garage ${hex(u.garage)} does not exist`);
  }
  for (const g of src.garages) {
    if (!g.owner) warn(`garages ${hex(g._id)} "${g.name}": no owner (kept, owner_id will be null)`);
    else if (!userIds.has(hex(g.owner)!)) warn(`garages ${hex(g._id)} "${g.name}": owner ${hex(g.owner)} does not exist (owner_id will be null)`);
  }
  for (const c of src.customers) {
    if (!garageIds.has(hex(c.garage) ?? '')) abort(`customers ${hex(c._id)}: garage ${hex(c.garage)} does not exist`);
  }
  for (const v of src.vehicles) {
    if (!garageIds.has(hex(v.garage) ?? '')) abort(`vehicles ${hex(v._id)}: garage ${hex(v.garage)} does not exist`);
    if (!customerIds.has(hex(v.customer) ?? '')) abort(`vehicles ${hex(v._id)} (${v.licensePlate}): customer ${hex(v.customer)} does not exist`);
  }
  for (const i of src.inventory) {
    if (!garageIds.has(hex(i.garage) ?? '')) abort(`inventory ${hex(i._id)}: garage ${hex(i.garage)} does not exist`);
  }
  for (const j of src.jobCards) {
    if (!garageIds.has(hex(j.garage) ?? '')) abort(`jobcards ${hex(j._id)} (${j.jobCardNumber}): garage ${hex(j.garage)} does not exist`);
    if (!vehicleIds.has(hex(j.vehicle) ?? '')) abort(`jobcards ${hex(j._id)} (${j.jobCardNumber}): vehicle ${hex(j.vehicle)} does not exist`);
    if (!customerIds.has(hex(j.customer) ?? '')) abort(`jobcards ${hex(j._id)} (${j.jobCardNumber}): customer ${hex(j.customer)} does not exist`);
    for (const field of ['assignedMechanic', 'assignedAdvisor', 'createdBy']) {
      if (j[field] && !userIds.has(hex(j[field])!)) warn(`jobcards ${hex(j._id)}: ${field} ${hex(j[field])} does not exist (will be null)`);
    }
    if (j.invoice && !invoiceIds.has(hex(j.invoice)!)) warn(`jobcards ${hex(j._id)}: invoice ${hex(j.invoice)} does not exist (will be null)`);
  }
  for (const inv of src.invoices) {
    if (!garageIds.has(hex(inv.garage) ?? '')) abort(`invoices ${hex(inv._id)} (${inv.invoiceNumber}): garage ${hex(inv.garage)} does not exist`);
    if (!jobCardIds.has(hex(inv.jobCard) ?? '')) abort(`invoices ${hex(inv._id)} (${inv.invoiceNumber}): job card ${hex(inv.jobCard)} does not exist`);
    if (!customerIds.has(hex(inv.customer) ?? '')) abort(`invoices ${hex(inv._id)} (${inv.invoiceNumber}): customer ${hex(inv.customer)} does not exist`);
    if (!vehicleIds.has(hex(inv.vehicle) ?? '')) abort(`invoices ${hex(inv._id)} (${inv.invoiceNumber}): vehicle ${hex(inv.vehicle)} does not exist`);
    if (inv.createdBy && !userIds.has(hex(inv.createdBy)!)) warn(`invoices ${hex(inv._id)}: createdBy ${hex(inv.createdBy)} does not exist (will be null)`);
  }
  for (const r of src.serviceReminders) {
    if (!garageIds.has(hex(r.garage) ?? '')) abort(`servicereminders ${hex(r._id)}: garage ${hex(r.garage)} does not exist`);
    if (!vehicleIds.has(hex(r.vehicle) ?? '')) abort(`servicereminders ${hex(r._id)}: vehicle ${hex(r.vehicle)} does not exist`);
    if (!customerIds.has(hex(r.customer) ?? '')) abort(`servicereminders ${hex(r._id)}: customer ${hex(r.customer)} does not exist`);
    if (r.jobCard && !jobCardIds.has(hex(r.jobCard)!)) warn(`servicereminders ${hex(r._id)}: jobCard ${hex(r.jobCard)} does not exist (will be null)`);
    if (!r.nextServiceDate) abort(`servicereminders ${hex(r._id)}: no nextServiceDate`);
  }

  // Unique indexes.
  const findDuplicates = (docs: Doc[], key: (d: Doc) => string | null, label: string) => {
    const seen = new Map<string, string[]>();
    for (const d of docs) {
      const k = key(d);
      if (k === null) continue;
      seen.set(k, [...(seen.get(k) ?? []), hex(d._id)!]);
    }
    for (const [k, ids] of seen) {
      if (ids.length > 1) abort(`${label}: duplicate ${k} on ids ${ids.join(', ')}`);
    }
  };
  findDuplicates(src.admins, d => str(d.email).toLowerCase() || null, 'admins.email');
  findDuplicates(src.users, d => str(d.email).toLowerCase() || null, 'users.email');
  findDuplicates(src.appReleases, d => str(d.platform) || null, 'appreleases.platform');
  findDuplicates(src.garages, d => (d.owner ? `${hex(d.owner)}/${str(d.name)}` : null), 'garages (owner, name)');
  findDuplicates(src.customers, d => `${hex(d.garage)}/${str(d.phone)}`, 'customers (garage, phone)');
  findDuplicates(src.vehicles, d => `${hex(d.garage)}/${str(d.licensePlate).toUpperCase()}`, 'vehicles (garage, licensePlate)');
  findDuplicates(src.jobCards, d => `${hex(d.garage)}/${str(d.jobCardNumber)}`, 'jobcards (garage, jobCardNumber)');
  findDuplicates(src.invoices, d => `${hex(d.garage)}/${str(d.invoiceNumber)}`, 'invoices (garage, invoiceNumber)');

  // Required scalars the new schema will not accept empty.
  for (const g of src.garages) if (!str(g.name)) abort(`garages ${hex(g._id)}: empty name`);
  for (const g of src.garages) if (!str(g.phone)) abort(`garages ${hex(g._id)} "${g.name}": empty phone`);
  for (const u of src.users) if (!str(u.password)) abort(`users ${hex(u._id)} (${u.email}): empty password hash`);
  for (const j of src.jobCards) if (!str(j.jobCardNumber)) abort(`jobcards ${hex(j._id)}: empty jobCardNumber`);
  for (const inv of src.invoices) if (!str(inv.invoiceNumber)) abort(`invoices ${hex(inv._id)}: empty invoiceNumber`);

  // The denormalised array is not migrated; report where it disagreed with the truth.
  const vehiclesByCustomer = new Map<string, Set<string>>();
  for (const v of src.vehicles) {
    const c = hex(v.customer)!;
    vehiclesByCustomer.set(c, (vehiclesByCustomer.get(c) ?? new Set()).add(hex(v._id)!));
  }
  for (const c of src.customers) {
    const stored = new Set((c.vehicles ?? []).map(hex));
    const actual = vehiclesByCustomer.get(hex(c._id)!) ?? new Set();
    if (stored.size !== actual.size || [...stored].some(id => !actual.has(id as string))) {
      warn(`customers ${hex(c._id)} "${c.name}": stored vehicles [${[...stored].join(', ')}] vs actual [${[...actual].join(', ')}] — derived value wins`);
    }
  }

  return { aborts, warnings };
};

// ─── Phase 2: transform + load ────────────────────────────────────────────

export const transform = (src: SourceCollections) => {
  const userIds = idsOf(src.users);
  const jobCardIds = idsOf(src.jobCards);
  const invoiceIds = idsOf(src.invoices);
  const userOrNull = (value: unknown) => (userIds.has(hex(value) ?? '') ? hex(value) : null);

  const lineItem = (p: Doc) => ({
    ...subdocId(p), inventoryItem: hex(p.inventoryItem), partName: str(p.partName),
    quantity: num(p.quantity, 1), unitPrice: num(p.unitPrice), total: num(p.total)
  });
  const laborItem = (l: Doc) => ({
    ...subdocId(l), description: str(l.description), hours: num(l.hours, 1),
    ratePerHour: num(l.ratePerHour), total: num(l.total)
  });

  return {
    admins: src.admins.map(a => ({
      _id: hex(a._id)!,
      name: str(a.name),
      email: str(a.email).toLowerCase(),
      password: str(a.password),
      isActive: bool(a.isActive, true),
      lastLoginAt: a.lastLoginAt ? date(a.lastLoginAt) : null,
      createdAt: date(a.createdAt),
      updatedAt: date(a.updatedAt)
    })),
    appReleases: src.appReleases.map(r => ({
      _id: hex(r._id)!,
      platform: str(r.platform),
      latestVersion: str(r.latestVersion),
      minSupportedVersion: str(r.minSupportedVersion),
      storeUrl: str(r.storeUrl),
      updateMessage: str(r.updateMessage),
      blockingMessage: str(r.blockingMessage),
      enabled: bool(r.enabled, true),
      updatedBy: str(r.updatedBy),
      createdAt: date(r.createdAt),
      updatedAt: date(r.updatedAt)
    })),
    garages: src.garages.map(g => ({
      _id: hex(g._id)!,
      name: str(g.name),
      // Missing on documents that pre-date the field — the resolver already fell back to India.
      country: str(g.country, DEFAULT_COUNTRY).toUpperCase() || DEFAULT_COUNTRY,
      address: { ...schema.EMPTY_ADDRESS, ...(g.address ?? {}) },
      phone: str(g.phone),
      email: str(g.email),
      gstNumber: str(g.gstNumber),
      logo: str(g.logo),
      // Set after the users exist — see `owners` below.
      ownerId: null as string | null,
      settings: { ...schema.DEFAULT_GARAGE_SETTINGS, ...(g.settings ?? {}) },
      createdAt: date(g.createdAt),
      updatedAt: date(g.updatedAt)
    })),
    owners: src.garages
      .map(g => ({ garageId: hex(g._id)!, ownerId: userOrNull(g.owner) }))
      .filter((o): o is { garageId: string; ownerId: string } => !!o.ownerId),
    users: src.users.map(u => ({
      _id: hex(u._id)!,
      name: str(u.name),
      email: str(u.email).toLowerCase(),
      phone: str(u.phone),
      password: str(u.password),
      role: str(u.role, 'mechanic') as (typeof schema.users.$inferInsert)['role'],
      garageId: hex(u.garage)!,
      avatar: str(u.avatar),
      isActive: bool(u.isActive, true),
      resetPasswordToken: u.resetPasswordToken ? str(u.resetPasswordToken) : null,
      resetPasswordExpire: u.resetPasswordExpire ? date(u.resetPasswordExpire) : null,
      createdAt: date(u.createdAt),
      updatedAt: date(u.updatedAt)
    })),
    customers: src.customers.map(c => ({
      _id: hex(c._id)!,
      name: str(c.name),
      phone: str(c.phone),
      email: str(c.email),
      address: { ...schema.EMPTY_ADDRESS, ...(c.address ?? {}) },
      garageId: hex(c.garage)!,
      totalVisits: num(c.totalVisits),
      totalSpent: num(c.totalSpent),
      notes: str(c.notes),
      createdAt: date(c.createdAt),
      updatedAt: date(c.updatedAt)
    })),
    vehicles: src.vehicles.map(v => ({
      _id: hex(v._id)!,
      licensePlate: str(v.licensePlate).toUpperCase(),
      make: str(v.make),
      model: str(v.model),
      year: typeof v.year === 'number' ? Math.trunc(v.year) : null,
      color: str(v.color),
      fuelType: str(v.fuelType, 'petrol'),
      vin: str(v.vin),
      engineNumber: str(v.engineNumber),
      currentOdometerReading: num(v.currentOdometerReading),
      customerId: hex(v.customer)!,
      garageId: hex(v.garage)!,
      createdAt: date(v.createdAt),
      updatedAt: date(v.updatedAt)
    })),
    inventory: src.inventory.map(i => ({
      _id: hex(i._id)!,
      partName: str(i.partName),
      partNumber: str(i.partNumber),
      category: str(i.category, 'other'),
      quantity: num(i.quantity),
      threshold: num(i.threshold, 5),
      unitPrice: num(i.unitPrice),
      sellingPrice: num(i.sellingPrice),
      supplier: { ...schema.EMPTY_SUPPLIER, ...(i.supplier ?? {}) },
      location: str(i.location),
      garageId: hex(i.garage)!,
      isActive: bool(i.isActive, true),
      createdAt: date(i.createdAt),
      updatedAt: date(i.updatedAt)
    })),
    jobCards: src.jobCards.map(j => {
      const est: Doc = j.estimation ?? {};
      return {
        _id: hex(j._id)!,
        serviceType: str(j.serviceType, 'service'),
        jobCardNumber: str(j.jobCardNumber),
        vehicleId: hex(j.vehicle)!,
        customerId: hex(j.customer)!,
        garageId: hex(j.garage)!,
        complaints: (j.complaints ?? []).map((c: Doc) => ({
          ...subdocId(c), description: str(c.description), priority: str(c.priority, 'medium')
        })),
        photos: (j.photos ?? []).map((p: Doc) => ({
          ...subdocId(p), url: str(p.url), caption: str(p.caption),
          uploadedAt: iso(p.uploadedAt) ?? new Date().toISOString(), uploadedBy: hex(p.uploadedBy)
        })),
        assignedMechanicId: userOrNull(j.assignedMechanic),
        assignedAdvisorId: userOrNull(j.assignedAdvisor),
        status: str(j.status, 'new'),
        statusHistory: (j.statusHistory ?? []).map((h: Doc) => ({
          ...subdocId(h), status: str(h.status), changedBy: hex(h.changedBy),
          changedAt: iso(h.changedAt) ?? iso(j.createdAt) ?? new Date().toISOString(), notes: str(h.notes)
        })),
        estimation: {
          parts: (est.parts ?? []).map(lineItem),
          labor: (est.labor ?? []).map(laborItem),
          subtotal: num(est.subtotal),
          taxRate: num(est.taxRate, 18),
          taxAmount: num(est.taxAmount),
          discount: num(est.discount),
          grandTotal: num(est.grandTotal),
          approvedByCustomer: bool(est.approvedByCustomer, false),
          approvedAt: iso(est.approvedAt),
          sentAt: iso(est.sentAt)
        },
        odometerAtIntake: num(j.odometerAtIntake),
        expectedDeliveryDate: j.expectedDeliveryDate ? date(j.expectedDeliveryDate) : null,
        actualDeliveryDate: j.actualDeliveryDate ? date(j.actualDeliveryDate) : null,
        internalNotes: str(j.internalNotes),
        // Set after the invoices exist — see `invoiceLinks` below.
        invoiceId: null as string | null,
        createdById: userOrNull(j.createdBy),
        estimationToken: j.estimationToken ? str(j.estimationToken) : null,
        createdAt: date(j.createdAt),
        updatedAt: date(j.updatedAt)
      };
    }),
    // `job_cards.invoice_id` and `invoices.job_card_id` point at each other, so
    // the job cards go in unlinked and are patched once the invoices exist.
    invoiceLinks: src.jobCards
      .map(j => ({ jobCardId: hex(j._id)!, invoiceId: invoiceIds.has(hex(j.invoice) ?? '') ? hex(j.invoice)! : null }))
      .filter((l): l is { jobCardId: string; invoiceId: string } => !!l.invoiceId),
    invoices: src.invoices.map(inv => ({
      _id: hex(inv._id)!,
      invoiceNumber: str(inv.invoiceNumber),
      jobCardId: hex(inv.jobCard)!,
      customerId: hex(inv.customer)!,
      vehicleId: hex(inv.vehicle)!,
      garageId: hex(inv.garage)!,
      parts: (inv.parts ?? []).map(lineItem),
      labor: (inv.labor ?? []).map(laborItem),
      subtotal: num(inv.subtotal),
      taxRate: num(inv.taxRate, 18),
      taxAmount: num(inv.taxAmount),
      discount: num(inv.discount),
      grandTotal: num(inv.grandTotal),
      paymentStatus: str(inv.paymentStatus, 'unpaid'),
      paymentMethod: str(inv.paymentMethod),
      amountPaid: num(inv.amountPaid),
      paidAt: inv.paidAt ? date(inv.paidAt) : null,
      notes: str(inv.notes),
      createdById: userOrNull(inv.createdBy),
      createdAt: date(inv.createdAt),
      updatedAt: date(inv.updatedAt)
    })),
    serviceReminders: src.serviceReminders.map(r => ({
      _id: hex(r._id)!,
      vehicleId: hex(r.vehicle)!,
      customerId: hex(r.customer)!,
      garageId: hex(r.garage)!,
      jobCardId: jobCardIds.has(hex(r.jobCard) ?? '') ? hex(r.jobCard) : null,
      type: str(r.type, 'periodic_service'),
      nextServiceDate: date(r.nextServiceDate),
      nextServiceKm: num(r.nextServiceKm),
      notes: str(r.notes),
      status: str(r.status, 'pending'),
      reminderSentAt: r.reminderSentAt ? date(r.reminderSentAt) : null,
      lastAttemptAt: r.lastAttemptAt ? date(r.lastAttemptAt) : null,
      createdAt: date(r.createdAt),
      updatedAt: date(r.updatedAt)
    }))
  };
};

export type TransformedRows = ReturnType<typeof transform>;

export const countTable = async (db: Db, table: PgTable): Promise<number> => {
  const [{ value }] = await db.select({ value: count() }).from(table);
  return value;
};

export const targetRowCount = async (db: Db): Promise<number> => {
  const counts = await Promise.all(schema.TABLES_IN_FK_ORDER.map(t => countTable(db, t)));
  return counts.reduce((a, b) => a + b, 0);
};

/** Inserts everything in foreign-key order inside one transaction. */
export const loadRows = async (db: Db, rows: TransformedRows, { wipe = false, log = (_: string) => {} } = {}): Promise<void> => {
  await db.transaction(async tx => {
    if (wipe) {
      await tx.execute(schema.TRUNCATE_ALL);
    }
    const insert = async (table: PgTable, list: Doc[], name: string) => {
      for (const part of chunk(list)) {
        if (part.length) await tx.insert(table).values(part as never);
      }
      log(`  ${name.padEnd(18)} ${list.length}`);
    };
    await insert(schema.admins, rows.admins, 'admins');
    await insert(schema.appReleases, rows.appReleases, 'app_releases');
    await insert(schema.garages, rows.garages, 'garages');
    await insert(schema.users, rows.users, 'users');
    for (const o of rows.owners) {
      await tx.update(schema.garages).set({ ownerId: o.ownerId }).where(eq(schema.garages._id, o.garageId));
    }
    await insert(schema.customers, rows.customers, 'customers');
    await insert(schema.vehicles, rows.vehicles, 'vehicles');
    await insert(schema.inventory, rows.inventory, 'inventory');
    await insert(schema.jobCards, rows.jobCards, 'job_cards');
    await insert(schema.invoices, rows.invoices, 'invoices');
    for (const l of rows.invoiceLinks) {
      await tx.update(schema.jobCards).set({ invoiceId: l.invoiceId }).where(eq(schema.jobCards._id, l.jobCardId));
    }
    await insert(schema.serviceReminders, rows.serviceReminders, 'service_reminders');
  });
};

// ─── Phase 3: verify ──────────────────────────────────────────────────────

export interface VerifyLine {
  label: string;
  expected: string;
  actual: string;
  ok: boolean;
}

export const verify = async (db: Db, rows: TransformedRows): Promise<VerifyLine[]> => {
  const lines: VerifyLine[] = [];
  const check = (label: string, expected: number | string, actual: number | string) =>
    lines.push({ label, expected: String(expected), actual: String(actual), ok: String(expected) === String(actual) });

  const tables: [string, PgTable, number][] = [
    ['admins', schema.admins, rows.admins.length],
    ['app_releases', schema.appReleases, rows.appReleases.length],
    ['garages', schema.garages, rows.garages.length],
    ['users', schema.users, rows.users.length],
    ['customers', schema.customers, rows.customers.length],
    ['vehicles', schema.vehicles, rows.vehicles.length],
    ['inventory', schema.inventory, rows.inventory.length],
    ['job_cards', schema.jobCards, rows.jobCards.length],
    ['invoices', schema.invoices, rows.invoices.length],
    ['service_reminders', schema.serviceReminders, rows.serviceReminders.length]
  ];
  for (const [name, table, expected] of tables) check(name, expected, await countTable(db, table));

  const [{ linked }] = await db.select({ linked: count() }).from(schema.garages).where(sql`${schema.garages.ownerId} is not null`);
  check('garages with an owner', rows.owners.length, linked);
  const [{ invoiced }] = await db.select({ invoiced: count() }).from(schema.jobCards).where(sql`${schema.jobCards.invoiceId} is not null`);
  check('job cards linked to their invoice', rows.invoiceLinks.length, invoiced);

  for (const g of rows.garages) {
    const gid = g._id;
    const expectCustomers = rows.customers.filter(c => c.garageId === gid).length;
    const expectVehicles = rows.vehicles.filter(v => v.garageId === gid).length;
    const expectCards = rows.jobCards.filter(j => j.garageId === gid);
    const expectRevenue = rows.invoices.filter(i => i.garageId === gid).reduce((s, i) => s + i.grandTotal, 0);
    const byStatus: Record<string, number> = {};
    for (const j of expectCards) byStatus[j.status] = (byStatus[j.status] ?? 0) + 1;

    const [{ c }] = await db.select({ c: count() }).from(schema.customers).where(eq(schema.customers.garageId, gid));
    const [{ v }] = await db.select({ v: count() }).from(schema.vehicles).where(eq(schema.vehicles.garageId, gid));
    const [{ rev }] = await db.select({ rev: sql<string | null>`coalesce(sum(${schema.invoices.grandTotal}), 0)` })
      .from(schema.invoices).where(eq(schema.invoices.garageId, gid));
    const statusRows = await db.select({ status: schema.jobCards.status, n: count() }).from(schema.jobCards)
      .where(eq(schema.jobCards.garageId, gid)).groupBy(schema.jobCards.status);
    const gotStatus: Record<string, number> = {};
    for (const r of statusRows) gotStatus[r.status] = r.n;

    const sortKeys = (o: Record<string, number>) => JSON.stringify(Object.fromEntries(Object.entries(o).sort()));
    check(`${g.name} customers`, expectCustomers, c);
    check(`${g.name} vehicles`, expectVehicles, v);
    check(`${g.name} invoice total`, expectRevenue.toFixed(2), Number(rev).toFixed(2));
    check(`${g.name} job cards by status`, sortKeys(byStatus), sortKeys(gotStatus));
  }

  return lines;
};

// ─── CLI ──────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i === -1 ? undefined : args[i + 1];
  };
  const dryRun = args.includes('--dry-run');
  const wipe = args.includes('--wipe');
  const mongoUri = flag('--from') || process.env.MONGO_SOURCE_URI;
  const pgUrl = flag('--to') || process.env.PG_TARGET_URL;

  if (!mongoUri || !pgUrl) {
    console.error('Need both a source and a target: --from/--to or MONGO_SOURCE_URI/PG_TARGET_URL.');
    process.exit(1);
  }

  console.log(`Mode: ${dryRun ? 'DRY RUN (nothing will be written)' : wipe ? 'LOAD, wiping target first' : 'LOAD into empty target'}\n`);

  const mongo = new MongoClient(mongoUri);
  await mongo.connect();
  const mdb = mongo.db();
  const load = async (name: string): Promise<Doc[]> => mdb.collection(name).find({}).toArray();
  const src: SourceCollections = {
    admins: await load('admins'),
    appReleases: await load('appreleases'),
    garages: await load('garages'),
    users: await load('users'),
    customers: await load('customers'),
    vehicles: await load('vehicles'),
    inventory: await load('inventories'),
    jobCards: await load('jobcards'),
    invoices: await load('invoices'),
    serviceReminders: await load('servicereminders')
  };
  await mongo.close();

  console.log('Source collections:');
  for (const [name, docs] of Object.entries(src)) console.log(`  ${name.padEnd(18)} ${docs.length}`);
  console.log();

  const { aborts, warnings } = preflight(src);
  if (warnings.length) {
    console.log(`Warnings (${warnings.length}) — migrated with the noted adjustment:`);
    for (const w of warnings) console.log(`  - ${w}`);
    console.log();
  }
  if (aborts.length) {
    console.log(`ABORT — ${aborts.length} finding(s) the new schema would reject. Fix these in Atlas and re-run:`);
    for (const a of aborts) console.log(`  - ${a}`);
    process.exit(2);
  }
  console.log('Pre-flight: clean.\n');

  if (dryRun) {
    console.log('Dry run complete. Nothing written.');
    return;
  }

  const pool = new Pool({ connectionString: pgUrl, max: 3 });
  const db = drizzle(pool, { schema, casing: 'snake_case' }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS_FOLDER });

  const existing = await targetRowCount(db);
  if (existing > 0 && !wipe) {
    console.error(`Target already holds ${existing} rows. Pass --wipe to replace them (a rehearsal copy), or point at an empty database.`);
    await pool.end();
    process.exit(3);
  }

  const rows = transform(src);
  console.log('Loading...');
  await loadRows(db, rows, { wipe, log: console.log });
  console.log();

  console.log('Verify:');
  const lines = await verify(db, rows);
  for (const l of lines) console.log(`  ${l.ok ? 'OK  ' : 'FAIL'} ${l.label.padEnd(50)} expected ${l.expected}, got ${l.actual}`);
  await pool.end();

  const mismatches = lines.filter(l => !l.ok).length;
  if (mismatches) {
    console.error(`\n${mismatches} verification mismatch(es). Investigate before cutting over.`);
    process.exit(4);
  }
  console.log('\nMigration complete and verified.');
}

if (require.main === module) {
  main().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}
