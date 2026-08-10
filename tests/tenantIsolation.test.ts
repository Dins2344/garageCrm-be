import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../app';
import { createGarageWithOwner, nextPhone, authHeader } from './helpers/factories';

/**
 * The entire multi-tenant model relies on every query being scoped by
 * `garage`. These tests exist because a regression here is a data-leak
 * between paying customers, not just a broken feature.
 */
describe('Multi-tenant isolation', () => {
  it('prevents Garage B from reading Garage A\'s customer', async () => {
    const garageA = await createGarageWithOwner('tenant-a1');
    const garageB = await createGarageWithOwner('tenant-b1');

    const created = await request(app)
      .post('/api/customers')
      .set(authHeader(garageA.token))
      .send({ name: 'Garage A Customer', phone: nextPhone() });
    expect(created.status).toBe(201);
    const customerId = created.body.data._id;

    const crossRead = await request(app)
      .get(`/api/customers/${customerId}`)
      .set(authHeader(garageB.token));

    expect(crossRead.status).toBe(404);
  });

  it('prevents Garage B from updating or deleting Garage A\'s customer', async () => {
    const garageA = await createGarageWithOwner('tenant-a2');
    const garageB = await createGarageWithOwner('tenant-b2');

    const created = await request(app)
      .post('/api/customers')
      .set(authHeader(garageA.token))
      .send({ name: 'Garage A Customer 2', phone: nextPhone() });
    const customerId = created.body.data._id;

    const crossUpdate = await request(app)
      .put(`/api/customers/${customerId}`)
      .set(authHeader(garageB.token))
      .send({ name: 'Hijacked Name' });
    expect(crossUpdate.status).toBe(404);

    const crossDelete = await request(app)
      .delete(`/api/customers/${customerId}`)
      .set(authHeader(garageB.token));
    expect(crossDelete.status).toBe(404);

    // Confirm Garage A's data is untouched
    const stillThere = await request(app)
      .get(`/api/customers/${customerId}`)
      .set(authHeader(garageA.token));
    expect(stillThere.status).toBe(200);
    expect(stillThere.body.data.name).toBe('Garage A Customer 2');
  });

  it('excludes Garage B\'s customers from Garage A\'s list results', async () => {
    const garageA = await createGarageWithOwner('tenant-a3');
    const garageB = await createGarageWithOwner('tenant-b3');

    await request(app).post('/api/customers').set(authHeader(garageA.token)).send({ name: 'A-Cust', phone: nextPhone() });
    await request(app).post('/api/customers').set(authHeader(garageB.token)).send({ name: 'B-Cust', phone: nextPhone() });

    const listA = await request(app).get('/api/customers').set(authHeader(garageA.token));
    expect(listA.status).toBe(200);
    expect(listA.body.data.every((c: { name: string }) => c.name !== 'B-Cust')).toBe(true);
  });

  it('prevents Garage B from reading Garage A\'s job card', async () => {
    const garageA = await createGarageWithOwner('tenant-a4');
    const garageB = await createGarageWithOwner('tenant-b4');

    const customer = await request(app)
      .post('/api/customers')
      .set(authHeader(garageA.token))
      .send({ name: 'JC Customer', phone: nextPhone() });

    const vehicle = await request(app)
      .post('/api/vehicles')
      .set(authHeader(garageA.token))
      .send({ licensePlate: 'MH01AB9999', make: 'Maruti', model: 'Swift', customer: customer.body.data._id });

    const jobCard = await request(app)
      .post('/api/jobcards')
      .set(authHeader(garageA.token))
      .send({ serviceType: 'service', vehicle: vehicle.body.data._id, customer: customer.body.data._id });
    expect(jobCard.status).toBe(201);

    const crossRead = await request(app)
      .get(`/api/jobcards/${jobCard.body.data._id}`)
      .set(authHeader(garageB.token));

    expect(crossRead.status).toBe(404);
  });
});
