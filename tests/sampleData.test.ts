import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import app from '../app';
import Customer from '../models/Customer';
import Vehicle from '../models/Vehicle';
import JobCard from '../models/JobCard';
import Invoice from '../models/Invoice';
import {
  SAMPLE_CUSTOMERS, SAMPLE_JOB_CARDS, SAMPLE_VEHICLES,
  sampleCustomerName, samplePhone, samplePlate
} from '../config/sampleData';
import { COUNTRIES, SUPPORTED_COUNTRY_CODES } from '../config/countries';
import { computeEstimationTotals } from '../usecases/jobCardUsecase';
import * as sampleDataUsecase from '../usecases/sampleDataUsecase';
import { createGarageWithOwner, authHeader, registerGarageOwner } from './helpers/factories';

describe('sample data seeding', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('seeds a new garage so the app is not empty on first open', async () => {
    const { garageId } = await createGarageWithOwner('seed');

    const [customers, vehicles, jobCards, invoices] = await Promise.all([
      Customer.countDocuments({ garage: garageId }),
      Vehicle.countDocuments({ garage: garageId }),
      JobCard.countDocuments({ garage: garageId }),
      Invoice.countDocuments({ garage: garageId })
    ]);

    expect(customers).toBe(SAMPLE_CUSTOMERS.length);
    expect(vehicles).toBe(SAMPLE_VEHICLES.length);
    expect(jobCards).toBe(SAMPLE_JOB_CARDS.length);
    expect(invoices).toBe(1);
  });

  it('flags every seeded document, so removal can be exact', async () => {
    const { garageId } = await createGarageWithOwner('flagged');

    const unflagged = await Promise.all([
      Customer.countDocuments({ garage: garageId, isSample: { $ne: true } }),
      Vehicle.countDocuments({ garage: garageId, isSample: { $ne: true } }),
      JobCard.countDocuments({ garage: garageId, isSample: { $ne: true } }),
      Invoice.countDocuments({ garage: garageId, isSample: { $ne: true } })
    ]);

    expect(unflagged).toEqual([0, 0, 0, 0]);
  });

  it('maintains the denormalised Customer.vehicles count', async () => {
    const { garageId } = await createGarageWithOwner('counts');

    const customers = await Customer.find({ garage: garageId }).sort({ createdAt: 1 }).lean();
    const counts = customers.map(c => c.vehicles.length);

    // Customer 0 owns two vehicles on purpose — it is the only way the vehicle
    // count column renders anything other than 1.
    expect(counts).toEqual([2, 1, 1]);
  });

  it('spreads job cards across statuses rather than leaving them all new', async () => {
    const { garageId } = await createGarageWithOwner('statuses');

    const jobCards = await JobCard.find({ garage: garageId }).lean();
    const statuses = new Set(jobCards.map(j => j.status));

    expect(statuses.size).toBeGreaterThanOrEqual(4);
    expect(statuses.has('delivered')).toBe(true);
  });

  it('raises the invoice against the delivered card with totals from the shared calculator', async () => {
    const { garageId } = await createGarageWithOwner('invoice');

    const invoice = await Invoice.findOne({ garage: garageId }).lean();
    expect(invoice).not.toBeNull();

    const jobCard = await JobCard.findById(invoice!.jobCard).lean();
    expect(jobCard!.status).toBe('delivered');
    expect(jobCard!.invoice?.toString()).toBe(invoice!._id.toString());

    // Recomputing through the same function the estimation editor uses is the
    // point: if the seeder ever grows its own copy of the tax maths, this fails.
    const expected = computeEstimationTotals({
      parts: jobCard!.estimation.parts,
      labor: jobCard!.estimation.labor,
      discount: jobCard!.estimation.discount,
      taxRate: jobCard!.estimation.taxRate
    });
    expect(invoice!.grandTotal).toBe(expected.grandTotal);
    expect(invoice!.taxAmount).toBe(expected.taxAmount);
    expect(invoice!.paymentStatus).toBe('paid');
  });

  it('gives each sample customer a distinct phone number', async () => {
    const { garageId } = await createGarageWithOwner('phones');

    const customers = await Customer.find({ garage: garageId }).lean();
    const phones = customers.map(c => c.phone);

    expect(new Set(phones).size).toBe(phones.length);
    // Derived from the country's own placeholder, so the mobile prefix survives.
    expect(phones).toContain(samplePhone('IN', 0));
  });

  it('still registers the owner when seeding fails', async () => {
    // A signup that dies because a demo customer could not be written is a far
    // worse outcome than an empty garage — the rollback above it in
    // registerNewGarage is deliberately not extended to cover this.
    vi.spyOn(sampleDataUsecase, 'seedSampleData').mockRejectedValueOnce(new Error('seed exploded'));

    const res = await registerGarageOwner({ email: 'seedfail@example.com' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.garage).toBeTruthy();
  });
});

describe('sample fixtures cover every supported country', () => {
  // A *missing* country key is already a compile error — PLATES_BY_COUNTRY and
  // REGION_BY_COUNTRY are exhaustive `Record<CountryCode, ...>`. What tsc cannot
  // see is a placeholder left blank, or a phoneExample whose shape breaks the
  // last-two-digits derivation. Both would seed a garage with unusable data, and
  // registerNewGarage swallows seeding failures, so the only production symptom
  // would be a quietly wrong demo set for one country.
  it.each(SUPPORTED_COUNTRY_CODES)('%s has plates, names and phone numbers', code => {
    for (let i = 0; i < SAMPLE_VEHICLES.length; i++) {
      expect(samplePlate(code, i)).toMatch(/\S/);
    }
    for (const spec of SAMPLE_CUSTOMERS) {
      expect(sampleCustomerName(code, spec.nameIndex)).toMatch(/\S/);
    }

    const phones = SAMPLE_CUSTOMERS.map((_, i) => samplePhone(code, i));
    expect(new Set(phones).size).toBe(phones.length);
    // The derivation replaces only the last two digits, so the country's own
    // mobile prefix has to survive — that is what keeps the number plausible.
    const example = COUNTRIES[code].phoneExample;
    expect(phones[0].length).toBe(example.length);
    expect(phones[0].slice(0, -2)).toBe(example.slice(0, -2));
  });
});

describe('DELETE /api/garage/sample-data', () => {
  it('removes every seeded row and leaves real data standing', async () => {
    const { token, garageId } = await createGarageWithOwner('remove');

    const realCustomer = await Customer.create({
      name: 'Genuine Customer',
      phone: '9111111111',
      garage: garageId
    });

    const res = await request(app)
      .delete('/api/garage/sample-data')
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      customers: SAMPLE_CUSTOMERS.length,
      vehicles: SAMPLE_VEHICLES.length,
      jobCards: SAMPLE_JOB_CARDS.length,
      invoices: 1
    });

    const remaining = await Customer.find({ garage: garageId }).lean();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]._id.toString()).toBe(realCustomer._id.toString());

    const [vehicles, jobCards, invoices] = await Promise.all([
      Vehicle.countDocuments({ garage: garageId }),
      JobCard.countDocuments({ garage: garageId }),
      Invoice.countDocuments({ garage: garageId })
    ]);
    expect([vehicles, jobCards, invoices]).toEqual([0, 0, 0]);
  });

  it('is a no-op on a garage whose sample data is already gone', async () => {
    const { token } = await createGarageWithOwner('twice');

    await request(app).delete('/api/garage/sample-data').set(authHeader(token));
    const second = await request(app).delete('/api/garage/sample-data').set(authHeader(token));

    expect(second.status).toBe(200);
    expect(second.body.data).toEqual({ customers: 0, vehicles: 0, jobCards: 0, invoices: 0 });
  });

  it('cannot clear another garage\'s sample data', async () => {
    const a = await createGarageWithOwner('tenant-a');
    const b = await createGarageWithOwner('tenant-b');

    await request(app).delete('/api/garage/sample-data').set(authHeader(a.token));

    // B is untouched — the delete is scoped by the caller's garage, and there is
    // no id in the request for a caller to tamper with in the first place.
    const bCustomers = await Customer.countDocuments({ garage: b.garageId });
    expect(bCustomers).toBe(SAMPLE_CUSTOMERS.length);
  });

  it('rejects an unauthenticated caller', async () => {
    const res = await request(app).delete('/api/garage/sample-data');
    expect(res.status).toBe(401);
  });
});
