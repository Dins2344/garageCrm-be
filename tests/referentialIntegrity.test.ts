import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import app from '../app';
import { db, schema, countInGarage, findById } from './helpers/dbAccess';
import { createGarageWithOwner, nextPhone, authHeader } from './helpers/factories';

/**
 * Behaviour the move to Postgres changed on purpose. Mongo deleted a parent
 * and left every reference dangling; the foreign keys refuse that, and the
 * usecases turn the refusal into a 409 with a message the owner can act on.
 */

const makeCustomer = async (token: string, name = 'FK Customer') => {
  const res = await request(app).post('/api/customers').set(authHeader(token)).send({ name, phone: nextPhone() });
  expect(res.status).toBe(201);
  return res.body.data._id as string;
};

const makeVehicle = async (token: string, customerId: string, plate: string) => {
  const res = await request(app).post('/api/vehicles').set(authHeader(token))
    .send({ licensePlate: plate, make: 'Maruti', model: 'Swift', customer: customerId });
  expect(res.status).toBe(201);
  return res.body.data._id as string;
};

const makeJobCard = async (token: string, vehicleId: string, customerId: string) => {
  const res = await request(app).post('/api/jobcards').set(authHeader(token))
    .send({ serviceType: 'service', vehicle: vehicleId, customer: customerId, odometerAtIntake: 12000 });
  expect(res.status).toBe(201);
  return res.body.data as { _id: string; jobCardNumber: string };
};

describe('deleting a parent that still has dependents', () => {
  it('refuses to delete a customer who still owns a vehicle, and says so', async () => {
    const { token, garageId } = await createGarageWithOwner('fk-cust');
    const customerId = await makeCustomer(token);
    await makeVehicle(token, customerId, 'KA01FK0001');

    const res = await request(app).delete(`/api/customers/${customerId}`).set(authHeader(token));

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/1 vehicle/);
    expect(await findById(schema.customers, customerId)).not.toBeNull();
    expect(await countInGarage(schema.vehicles, garageId, eq(schema.vehicles.customerId, customerId))).toBe(1);
  });

  it('refuses to delete a vehicle that still has a job card', async () => {
    const { token } = await createGarageWithOwner('fk-veh');
    const customerId = await makeCustomer(token);
    const vehicleId = await makeVehicle(token, customerId, 'KA01FK0002');
    await makeJobCard(token, vehicleId, customerId);

    const res = await request(app).delete(`/api/vehicles/${vehicleId}`).set(authHeader(token));

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/1 job card/);
  });

  it('still deletes a customer with nothing attached', async () => {
    const { token } = await createGarageWithOwner('fk-free');
    const customerId = await makeCustomer(token);

    const res = await request(app).delete(`/api/customers/${customerId}`).set(authHeader(token));

    expect(res.status).toBe(200);
    expect(await findById(schema.customers, customerId)).toBeNull();
  });

  it('refuses to delete a job card that has been invoiced', async () => {
    const { token } = await createGarageWithOwner('fk-inv');
    const customerId = await makeCustomer(token);
    const vehicleId = await makeVehicle(token, customerId, 'KA01FK0003');
    const jobCard = await makeJobCard(token, vehicleId, customerId);
    const invoice = await request(app).post('/api/invoices').set(authHeader(token)).send({ jobCardId: jobCard._id });
    expect(invoice.status).toBe(201);

    const res = await request(app).delete(`/api/jobcards/${jobCard._id}`).set(authHeader(token));

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/invoice/i);
  });
});

describe('document numbering', () => {
  it('numbers a fresh garage from 0001 in the documented format', async () => {
    const { token } = await createGarageWithOwner('numbering');
    const customerId = await makeCustomer(token);
    const vehicleId = await makeVehicle(token, customerId, 'KA01NM0001');

    const card = await makeJobCard(token, vehicleId, customerId);

    expect(card.jobCardNumber).toMatch(/^JC-\d{6}-0001$/);
  });

  it('never reissues a number after a delete — the production duplicate', async () => {
    // `count + 1` collides as soon as anything is deleted: with 0001-0003
    // issued and 0002 removed, the count is 2 and the "next" number is 0003.
    // Mongo issued the duplicate silently (no unique index on invoices);
    // Postgres refused it, which is how this surfaced right after cutover.
    const { token } = await createGarageWithOwner('numbering-gap');
    const customerId = await makeCustomer(token);
    const plates = ['KA01GP0001', 'KA01GP0002', 'KA01GP0003'];
    const cards = [];
    for (const plate of plates) {
      const vehicleId = await makeVehicle(token, customerId, plate);
      cards.push(await makeJobCard(token, vehicleId, customerId));
    }

    const first = await request(app).post('/api/invoices').set(authHeader(token)).send({ jobCardId: cards[0]._id });
    const second = await request(app).post('/api/invoices').set(authHeader(token)).send({ jobCardId: cards[1]._id });
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(second.body.data.invoiceNumber.endsWith('0002')).toBe(true);

    // Cancel the first invoice — the row is deleted and the count drops by one.
    const cancel = await request(app).delete(`/api/invoices/${first.body.data._id}`).set(authHeader(token));
    expect(cancel.status).toBe(200);

    const third = await request(app).post('/api/invoices').set(authHeader(token)).send({ jobCardId: cards[2]._id });
    expect(third.status).toBe(201);
    expect(third.body.data.invoiceNumber).not.toBe(second.body.data.invoiceNumber);
    expect(third.body.data.invoiceNumber.endsWith('0003')).toBe(true);

    // Same rule for job cards: delete the (now uninvoiced) first card, open another.
    const del = await request(app).delete(`/api/jobcards/${cards[0]._id}`).set(authHeader(token));
    expect(del.status).toBe(200);
    const vehicleId = await makeVehicle(token, customerId, 'KA01GP0004');
    const fourth = await makeJobCard(token, vehicleId, customerId);
    const highest = Math.max(...cards.map(c => Number(c.jobCardNumber.slice(-4))));
    expect(Number(fourth.jobCardNumber.slice(-4))).toBe(highest + 1);
  });

  it('issues distinct numbers to concurrent creates in the same garage', async () => {
    // The Mongo hook read `count + 1` outside any lock, so two concurrent
    // creates could collide on the unique index. The garage row lock makes
    // them queue instead.
    //
    // Honest limit: PGlite runs on one connection, so its transactions are
    // serialised whatever the code does — this passes with the lock removed.
    // It pins the numbering contract and the unique index; the lock itself is
    // only exercised against a real multi-connection Postgres (Neon).
    const { token, garageId } = await createGarageWithOwner('numbering-race');
    const customerId = await makeCustomer(token);
    const plates = ['KA01RC0001', 'KA01RC0002', 'KA01RC0003'];
    const vehicleIds = await Promise.all(plates.map(p => makeVehicle(token, customerId, p)));

    const results = await Promise.all(vehicleIds.map(vehicleId =>
      request(app).post('/api/jobcards').set(authHeader(token))
        .send({ serviceType: 'service', vehicle: vehicleId, customer: customerId, odometerAtIntake: 100 })
    ));

    expect(results.map(r => r.status)).toEqual([201, 201, 201]);
    const numbers = results.map(r => r.body.data.jobCardNumber as string);
    expect(new Set(numbers).size).toBe(3);

    const rows = await db.select({ n: schema.jobCards.jobCardNumber }).from(schema.jobCards)
      .where(eq(schema.jobCards.garageId, garageId));
    expect(new Set(rows.map(r => r.n)).size).toBe(rows.length);
  });
});
