import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import ExcelJS from 'exceljs';
import app from '../app';
import { excelDay } from '../utils/excel';
import { db, schema } from './helpers/dbAccess';
import { createGarageWithOwner, nextPhone, authHeader } from './helpers/factories';

/** Downloads an export endpoint and parses the first worksheet into rows of cell values. */
async function fetchSheet(url: string, token: string) {
  const res = await request(app)
    .get(url)
    .set(authHeader(token))
    .buffer(true)
    .parse((r, callback) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => callback(null, Buffer.concat(chunks)));
    });
  if (res.status !== 200) return { res, rows: [] as unknown[][] };

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(res.body);
  const rows: unknown[][] = [];
  workbook.worksheets[0].eachRow((row) => rows.push((row.values as unknown[]).slice(1)));
  return { res, rows };
}

async function seedCustomerWithVehicle(token: string, name: string, plate: string) {
  const customer = await request(app)
    .post('/api/customers')
    .set(authHeader(token))
    .send({ name, phone: nextPhone(), email: 'c@example.com', address: { city: 'Kochi' } });
  const vehicle = await request(app)
    .post('/api/vehicles')
    .set(authHeader(token))
    .send({ licensePlate: plate, make: 'Maruti', model: 'Swift', customer: customer.body.data._id });
  return { ...(customer.body.data as { _id: string; phone: string }), vehicleId: vehicle.body.data._id as string };
}

/**
 * Job cards inserted directly: the API allows one open card per vehicle and
 * stamps "now", while these tests need several closed cards on known dates.
 */
let cardNumber = 0;
async function insertJobCard(
  ids: { garageId: string; customerId: string; vehicleId: string },
  serviceType: string, status: string, createdAt: string
) {
  cardNumber += 1;
  await db.insert(schema.jobCards).values({
    garageId: ids.garageId, customerId: ids.customerId, vehicleId: ids.vehicleId,
    serviceType, status, jobCardNumber: `JC-TEST-${cardNumber}`, odometerAtIntake: 0,
    createdAt: new Date(createdAt)
  });
}

/** One row as { header: value }, so assertions name columns instead of counting them. */
const byHeader = (rows: unknown[][], row: unknown[]) =>
  Object.fromEntries((rows[0] as string[]).map((h, i) => [h, row[i]]));

describe('Customer and vehicle Excel export', () => {
  let owner: Awaited<ReturnType<typeof createGarageWithOwner>>;

  beforeEach(async () => {
    owner = await createGarageWithOwner(`export-${Date.now()}`);
  });

  it('exports every customer of the garage, ignoring pagination', async () => {
    const seeded = await seedCustomerWithVehicle(owner.token, 'Asha Menon', 'KL07BQ0001');
    for (let i = 0; i < 25; i += 1) {
      await request(app).post('/api/customers').set(authHeader(owner.token)).send({ name: `Bulk ${i}`, phone: nextPhone() });
    }

    const { res, rows } = await fetchSheet('/api/customers/export', owner.token);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml.sheet');
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="customers-\d{4}-\d{2}-\d{2}\.xlsx"/);
    expect(rows[0]).toContain('Total spent (INR)');
    expect(rows).toHaveLength(1 + 26);

    const asha = byHeader(rows, rows.find((r) => r[0] === 'Asha Menon')!);
    // Phone stays text, so Excel keeps it exactly as stored.
    expect(asha.Phone).toBe(seeded.phone);
    expect(asha.City).toBe('Kochi');
    expect(asha.Vehicles).toBe(1);
    expect(asha.Created).toBeInstanceOf(Date);
  });

  it('lists every plate a customer owns', async () => {
    const asha = await seedCustomerWithVehicle(owner.token, 'Asha Menon', 'KL07BQ0010');
    await request(app).post('/api/vehicles').set(authHeader(owner.token))
      .send({ licensePlate: 'KL07BQ0011', make: 'Honda', model: 'City', customer: asha._id });
    await request(app).post('/api/customers').set(authHeader(owner.token)).send({ name: 'No Car', phone: nextPhone() });

    const { rows } = await fetchSheet('/api/customers/export', owner.token);
    const plates = (name: string) => byHeader(rows, rows.find((r) => r[0] === name)!)['Vehicle numbers'];

    expect(String(plates('Asha Menon')).split(', ').sort()).toEqual(['KL07BQ0010', 'KL07BQ0011']);
    expect(plates('No Car')).toBeUndefined();
  });

  it('exports vehicles with their owner', async () => {
    const seeded = await seedCustomerWithVehicle(owner.token, 'Ravi Kumar', 'KL07BQ0002');

    const { res, rows } = await fetchSheet('/api/vehicles/export', owner.token);

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/filename="vehicles-/);
    expect(rows).toHaveLength(2);
    expect(rows[1].slice(0, 3)).toEqual(['KL07BQ0002', 'Maruti', 'Swift']);
    expect(rows[1]).toContain('Ravi Kumar');
    expect(rows[1]).toContain(seeded.phone);
  });

  it('gives each service type its latest non-cancelled intake date', async () => {
    const seeded = await seedCustomerWithVehicle(owner.token, 'Ravi Kumar', 'KL07BQ0020');
    const ids = { garageId: owner.garageId, customerId: seeded._id, vehicleId: seeded.vehicleId };
    await insertJobCard(ids, 'service', 'delivered', '2026-03-10T06:00:00Z');
    await insertJobCard(ids, 'service', 'delivered', '2026-08-12T06:00:00Z');
    await insertJobCard(ids, 'repair', 'delivered', '2026-05-05T06:00:00Z');
    // Newer than both services, but cancelled: must not count anywhere.
    await insertJobCard(ids, 'accident', 'cancelled', '2026-09-01T06:00:00Z');
    await insertJobCard(ids, 'service', 'cancelled', '2026-09-02T06:00:00Z');

    const { rows } = await fetchSheet('/api/vehicles/export', owner.token);
    const row = byHeader(rows, rows[1]);

    expect((row['Last service'] as Date).toISOString().slice(0, 10)).toBe('2026-08-12');
    expect((row['Last repair'] as Date).toISOString().slice(0, 10)).toBe('2026-05-05');
    expect(row['Last accident']).toBeUndefined();
  });

  it('writes a formula-looking name as plain text, not a formula', async () => {
    await request(app).post('/api/customers').set(authHeader(owner.token))
      .send({ name: '=HYPERLINK("http://evil.example","x")', phone: nextPhone() });

    const { rows } = await fetchSheet('/api/customers/export', owner.token);

    expect(rows[1][0]).toBe('=HYPERLINK("http://evil.example","x")');
  });

  it('never includes another garage\'s rows', async () => {
    await seedCustomerWithVehicle(owner.token, 'Garage A Customer', 'KL07BQ0003');
    const other = await createGarageWithOwner(`export-other-${Date.now()}`);
    await seedCustomerWithVehicle(other.token, 'Garage B Customer', 'KL07BQ0004');

    const customersA = await fetchSheet('/api/customers/export', owner.token);
    const vehiclesA = await fetchSheet('/api/vehicles/export', owner.token);

    expect(customersA.rows.map((r) => r[0])).not.toContain('Garage B Customer');
    expect(customersA.rows).toHaveLength(2);
    expect(vehiclesA.rows.map((r) => r[0])).not.toContain('KL07BQ0004');
    expect(vehiclesA.rows).toHaveLength(2);
  });

  it.each(['mechanic', 'service_advisor', 'receptionist'])('refuses a %s with 403', async (role) => {
    const email = `export-${role}-${Date.now()}@example.com`;
    await request(app).post('/api/users').set(authHeader(owner.token))
      .send({ name: 'Staff', email, phone: nextPhone(), password: 'password123', role });
    const login = await request(app).post('/api/auth/login').send({ email, password: 'password123' });

    for (const url of ['/api/customers/export', '/api/vehicles/export']) {
      const res = await request(app).get(url).set(authHeader(login.body.token));
      expect(res.status).toBe(403);
    }
  });
});

describe('excelDay', () => {
  it('names the garage calendar day, not the UTC one', () => {
    // 19:00 UTC on the 2nd is 00:30 on the 3rd in Kochi.
    const at = new Date('2026-10-02T19:00:00Z');
    expect(excelDay(at, 'Asia/Kolkata').toISOString()).toBe('2026-10-03T00:00:00.000Z');
    expect(excelDay(at, 'UTC').toISOString()).toBe('2026-10-02T00:00:00.000Z');
  });
});
