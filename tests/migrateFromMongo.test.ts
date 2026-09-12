import { describe, it, expect } from 'vitest';
import { ObjectId } from 'mongodb';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import app from '../app';
import { db, schema, countRows, findById } from './helpers/dbAccess';
import { preflight, transform, loadRows, verify, SourceCollections, Doc } from '../scripts/migrateFromMongo';
import { signUserToken } from '../models/User';
import { hashPassword } from '../utils/password';

/**
 * Drives fabricated Mongo documents — shaped exactly as Mongoose wrote them,
 * ObjectIds and embedded `_id`s included — through the migration script's
 * three phases against PGlite. The script runs once against production; this
 * is where it gets to fail first.
 */

const oid = () => new ObjectId();
const day = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

/** A small but complete tenant, the way Atlas holds it. */
const buildSource = async (): Promise<SourceCollections> => {
  const garage = oid();
  const owner = oid();
  const mechanic = oid();
  const customerA = oid();
  const customerB = oid();
  const vehicleA1 = oid();
  const vehicleA2 = oid();
  const vehicleB1 = oid();
  const part = oid();
  const card1 = oid();
  const card2 = oid();
  const invoice1 = oid();

  const password = await hashPassword('password123');

  return {
    admins: [{ _id: oid(), name: 'Platform Admin', email: 'Admin@Example.com', password, isActive: true, createdAt: day(30), updatedAt: day(30) }],
    appReleases: [{ _id: oid(), platform: 'android', latestVersion: '1.0.9', minSupportedVersion: '', storeUrl: '', updateMessage: 'Update available', blockingMessage: '', enabled: true, updatedBy: 'admin@example.com', createdAt: day(10), updatedAt: day(10) }],
    garages: [{
      _id: garage, name: 'Legacy Garage', phone: '9876543210', owner, country: 'IN',
      address: { city: 'Kochi' }, // partial — pre-dates the full address shape
      settings: { taxRate: 18, laborRatePerHour: 500 }, // partial — pre-dates the presentation keys
      createdAt: day(60), updatedAt: day(1)
    }],
    users: [
      { _id: owner, name: 'Owner', email: 'Owner@Example.com', phone: '9876543210', password, role: 'owner', garage, isActive: true, createdAt: day(60), updatedAt: day(60) },
      { _id: mechanic, name: 'Mech', email: 'mech@example.com', phone: '9876543211', password, role: 'mechanic', garage, isActive: true, createdAt: day(50), updatedAt: day(50) }
    ],
    customers: [
      // `vehicles` array is stale on purpose: it lists one car, but two point at this customer.
      { _id: customerA, name: 'Asha', phone: '9000000001', garage, vehicles: [vehicleA1], totalVisits: 1, totalSpent: 2360, createdAt: day(40), updatedAt: day(5) },
      { _id: customerB, name: 'Biju', phone: '9000000002', garage, vehicles: [vehicleB1], createdAt: day(30), updatedAt: day(30) }
    ],
    vehicles: [
      { _id: vehicleA1, licensePlate: 'kl07ab1234', make: 'Maruti', model: 'Swift', year: 2019, customer: customerA, garage, serviceHistory: [card1], createdAt: day(40), updatedAt: day(40) },
      { _id: vehicleA2, licensePlate: 'KL07CD5678', make: 'Honda', model: 'City', customer: customerA, garage, createdAt: day(20), updatedAt: day(20) },
      { _id: vehicleB1, licensePlate: 'KL08EF9012', make: 'Hyundai', model: 'i20', customer: customerB, garage, createdAt: day(30), updatedAt: day(30) }
    ],
    inventory: [{ _id: part, partName: 'Oil filter', partNumber: 'OF-1', category: 'filters', quantity: 8, threshold: 5, unitPrice: 300, sellingPrice: 400, garage, isActive: true, createdAt: day(30), updatedAt: day(30) }],
    jobCards: [
      {
        _id: card1, serviceType: 'service', jobCardNumber: 'JC-260801-0001', vehicle: vehicleA1, customer: customerA, garage,
        complaints: [{ _id: oid(), description: 'Noise from front', priority: 'high' }],
        assignedMechanic: mechanic, status: 'delivered',
        statusHistory: [
          { _id: oid(), status: 'new', changedBy: owner, changedAt: day(9), notes: 'Job card created' },
          { _id: oid(), status: 'delivered', changedBy: owner, changedAt: day(8), notes: 'Invoice INV-260801-0001 generated' }
        ],
        estimation: {
          parts: [{ _id: oid(), inventoryItem: part, partName: 'Oil filter', quantity: 1, unitPrice: 400, total: 400 }],
          labor: [{ _id: oid(), description: 'Service', hours: 2, ratePerHour: 800, total: 1600 }],
          subtotal: 2000, taxRate: 18, taxAmount: 360, discount: 0, grandTotal: 2360,
          approvedByCustomer: true, approvedAt: day(9), sentAt: day(9)
        },
        odometerAtIntake: 42000, invoice: invoice1, createdBy: owner, createdAt: day(9), updatedAt: day(8)
      },
      {
        _id: card2, serviceType: 'repair', jobCardNumber: 'JC-260810-0002', vehicle: vehicleB1, customer: customerB, garage,
        complaints: [], status: 'in_progress',
        statusHistory: [{ _id: oid(), status: 'new', changedBy: owner, changedAt: day(2), notes: 'Job card created' }],
        estimation: { parts: [], labor: [], subtotal: 0, taxRate: 18, taxAmount: 0, discount: 0, grandTotal: 0, approvedByCustomer: false, approvedAt: null, sentAt: null },
        odometerAtIntake: 15000, createdBy: owner, createdAt: day(2), updatedAt: day(2)
      }
    ],
    invoices: [{
      _id: invoice1, invoiceNumber: 'INV-260801-0001', jobCard: card1, customer: customerA, vehicle: vehicleA1, garage,
      parts: [{ _id: oid(), inventoryItem: part, partName: 'Oil filter', quantity: 1, unitPrice: 400, total: 400 }],
      labor: [{ _id: oid(), description: 'Service', hours: 2, ratePerHour: 800, total: 1600 }],
      subtotal: 2000, taxRate: 18, taxAmount: 360, discount: 0, grandTotal: 2360,
      paymentStatus: 'paid', paymentMethod: 'upi', amountPaid: 2360, paidAt: day(8), createdBy: owner, createdAt: day(8), updatedAt: day(8)
    }],
    serviceReminders: [{
      _id: oid(), vehicle: vehicleA1, customer: customerA, garage, jobCard: card1, type: 'service',
      nextServiceDate: day(-170), notes: 'Auto-created after Job Card JC-260801-0001 delivery', status: 'pending', createdAt: day(8), updatedAt: day(8)
    }]
  };
};

describe('migrateFromMongo', () => {
  it('pre-flight passes a clean tenant and only warns about the stale vehicles array', async () => {
    const src = await buildSource();
    const { aborts, warnings } = preflight(src);

    expect(aborts).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/"Asha".*stored vehicles/);
  });

  it('pre-flight aborts on every condition the new constraints would reject', async () => {
    const src = await buildSource();
    const ghostGarage = oid();
    // 1. duplicate customer phone in the same garage
    src.customers.push({ ...src.customers[0], _id: oid(), name: 'Dup' } as Doc);
    // 2. a user whose garage does not exist
    src.users.push({ ...src.users[1], _id: oid(), email: 'lost@example.com', garage: ghostGarage } as Doc);
    // 3. a duplicate (owner, name) garage — the "D garage" case
    src.garages.push({ ...src.garages[0], _id: oid() } as Doc);
    // 4. an invoice whose job card is gone
    src.invoices.push({ ...src.invoices[0], _id: oid(), invoiceNumber: 'INV-X', jobCard: oid() } as Doc);

    const { aborts } = preflight(src);

    expect(aborts.some(a => a.startsWith('customers (garage, phone): duplicate'))).toBe(true);
    expect(aborts.some(a => a.includes('lost@example.com'))).toBe(true);
    expect(aborts.some(a => a.startsWith('garages (owner, name): duplicate'))).toBe(true);
    expect(aborts.some(a => a.includes('INV-X') && a.includes('job card'))).toBe(true);
  });

  it('loads, links owners, fills partial sub-documents, and verifies clean', async () => {
    const src = await buildSource();
    const rows = transform(src);

    await loadRows(db, rows);
    const lines = await verify(db, rows);

    expect(lines.filter(l => !l.ok)).toEqual([]);
    expect(lines.find(l => l.label === 'garages with an owner')?.actual).toBe('1');

    const garage = await findById(schema.garages, rows.garages[0]._id);
    expect(garage!.ownerId).toBe(rows.users[0]._id);
    // Partial Mongo sub-documents come through with every key the schema expects.
    expect(garage!.address).toEqual({ street: '', city: 'Kochi', state: '', pincode: '' });
    expect(garage!.settings).toMatchObject({ taxRate: 18, laborRatePerHour: 500, currency: '', serviceReminderDays: 180 });

    const vehicle = await findById(schema.vehicles, rows.vehicles[0]._id);
    expect(vehicle!.licensePlate).toBe('KL07AB1234');

    const card = await findById(schema.jobCards, rows.jobCards[0]._id);
    expect(card!.invoiceId).toBe(rows.invoices[0]._id);
    expect(card!.statusHistory[1].changedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(card!.estimation.parts[0].inventoryItem).toBe(rows.inventory[0]._id);
    expect(card!.createdAt.getTime()).toBeLessThan(Date.now() - 8 * 24 * 60 * 60 * 1000);
  });

  it('is exactly what the API serves afterwards: the migrated owner can log in and read their data', async () => {
    const src = await buildSource();
    const rows = transform(src);
    await loadRows(db, rows);

    // The hash migrated untouched, so the original password still works.
    const login = await request(app).post('/api/auth/login').send({ email: 'owner@example.com', password: 'password123' });
    expect(login.status).toBe(200);
    expect(login.body.data._id).toBe(rows.users[0]._id);
    expect(login.body.data.garage).toBe(rows.garages[0]._id);

    const token = signUserToken({ _id: rows.users[0]._id, role: 'owner' });
    const customers = await request(app).get('/api/customers').set({ Authorization: `Bearer ${token}` });
    expect(customers.status).toBe(200);
    const asha = customers.body.data.find((c: { name: string }) => c.name === 'Asha');
    // Two vehicles point at Asha; the stale stored array said one. Derived wins.
    expect(asha.vehicles).toHaveLength(2);

    const detail = await request(app).get(`/api/jobcards/${rows.jobCards[0]._id}`).set({ Authorization: `Bearer ${token}` });
    expect(detail.status).toBe(200);
    expect(detail.body.data._id).toBe(rows.jobCards[0]._id);
    expect(detail.body.data.customer._id).toBe(rows.customers[0]._id);
    expect(detail.body.data.invoice._id).toBe(rows.invoices[0]._id);
    expect(detail.body.data.statusHistory[0].changedBy).toEqual({ _id: rows.users[0]._id, name: 'Owner' });
    expect(detail.body.data.estimation.parts[0].inventoryItem).toMatchObject({ partName: 'Oil filter' });

    const pdf = await request(app).get(`/api/invoices/${rows.invoices[0]._id}/pdf`).set({ Authorization: `Bearer ${token}` });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('pdf');

    // Numbering continues from the migrated count, in the same format.
    const next = await request(app).post('/api/jobcards').set({ Authorization: `Bearer ${token}` })
      .send({ serviceType: 'service', vehicle: rows.vehicles[1]._id, customer: rows.customers[0]._id, odometerAtIntake: 100 });
    expect(next.status).toBe(201);
    expect(next.body.data.jobCardNumber).toMatch(/^JC-\d{6}-0003$/);
  });

  it('with --wipe replaces a rehearsal copy instead of stacking a second one', async () => {
    const src = await buildSource();
    const rows = transform(src);
    await loadRows(db, rows);
    await loadRows(db, rows, { wipe: true });

    expect(await countRows(schema.garages)).toBe(1);
    expect(await countRows(schema.jobCards, eq(schema.jobCards.garageId, rows.garages[0]._id))).toBe(2);
  });
});
