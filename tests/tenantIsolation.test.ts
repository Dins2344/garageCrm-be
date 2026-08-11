import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../app';
import JobCard from '../models/JobCard';
import { createGarageWithOwner, nextPhone, authHeader, authHeaderFor, addGarageToOwner } from './helpers/factories';

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

describe('Owner multi-garage access', () => {
  it('lets an owner switch between their own garages via X-Garage-Id', async () => {
    const owner = await createGarageWithOwner('multi-a');
    const branch = await addGarageToOwner(owner.token, 'Branch 2 for A');
    expect(branch.status).toBe(201);
    const garage2Id = branch.body.data._id as string;

    const custHome = await request(app)
      .post('/api/customers')
      .set(authHeader(owner.token))
      .send({ name: 'Home Garage Customer', phone: nextPhone() });
    expect(custHome.status).toBe(201);

    const custBranch = await request(app)
      .post('/api/customers')
      .set(authHeaderFor(owner.token, garage2Id))
      .send({ name: 'Branch Customer', phone: nextPhone() });
    expect(custBranch.status).toBe(201);

    const listHome = await request(app).get('/api/customers').set(authHeader(owner.token));
    expect(listHome.body.data.some((c: { name: string }) => c.name === 'Home Garage Customer')).toBe(true);
    expect(listHome.body.data.some((c: { name: string }) => c.name === 'Branch Customer')).toBe(false);

    const listBranch = await request(app).get('/api/customers').set(authHeaderFor(owner.token, garage2Id));
    expect(listBranch.body.data.some((c: { name: string }) => c.name === 'Branch Customer')).toBe(true);
    expect(listBranch.body.data.some((c: { name: string }) => c.name === 'Home Garage Customer')).toBe(false);
  });

  it('rejects an owner supplying X-Garage-Id for a garage they do not own', async () => {
    const ownerA = await createGarageWithOwner('multi-b');
    const ownerB = await createGarageWithOwner('multi-c');

    const res = await request(app)
      .get('/api/customers')
      .set(authHeaderFor(ownerA.token, ownerB.garageId));
    expect(res.status).toBe(403);
  });

  it('ignores X-Garage-Id for non-owner roles, keeping them scoped to their own assigned garage', async () => {
    const owner = await createGarageWithOwner('multi-d');
    const branch = await addGarageToOwner(owner.token, 'Branch 2 for D');
    const garage2Id = branch.body.data._id as string;

    await request(app)
      .post('/api/customers')
      .set(authHeader(owner.token))
      .send({ name: 'D Home Customer', phone: nextPhone() });

    await request(app)
      .post('/api/customers')
      .set(authHeaderFor(owner.token, garage2Id))
      .send({ name: 'D Branch Customer', phone: nextPhone() });

    const staffEmail = `staff-multi-d-${Date.now()}@example.com`;
    const staff = await request(app)
      .post('/api/users')
      .set(authHeader(owner.token))
      .send({ name: 'Staff D', email: staffEmail, phone: nextPhone(), password: 'password123', role: 'mechanic' });
    expect(staff.status).toBe(201);

    const login = await request(app).post('/api/auth/login').send({ email: staffEmail, password: 'password123' });
    const staffToken = login.body.token as string;

    // Staff tries to view Branch 2's data by passing its ID — should be silently ignored.
    const staffList = await request(app)
      .get('/api/customers')
      .set(authHeaderFor(staffToken, garage2Id));
    expect(staffList.status).toBe(200);
    expect(staffList.body.data.some((c: { name: string }) => c.name === 'D Home Customer')).toBe(true);
    expect(staffList.body.data.some((c: { name: string }) => c.name === 'D Branch Customer')).toBe(false);
  });
});

describe('Free-plan usage limits', () => {
  it('rejects creating a 3rd garage for an owner (max 2 garages)', async () => {
    const owner = await createGarageWithOwner('quota-garages');
    const second = await addGarageToOwner(owner.token, 'Second Branch');
    expect(second.status).toBe(201);

    const third = await addGarageToOwner(owner.token, 'Third Branch');
    expect(third.status).toBe(403);
  });

  it('rejects a garage name that duplicates an existing one for the same owner', async () => {
    const owner = await createGarageWithOwner('quota-dupe');
    const dupe = await addGarageToOwner(owner.token, 'Garage quota-dupe');
    expect(dupe.status).toBe(400);
  });

  it('rejects creating a 4th job card in the same garage on the same day', async () => {
    const owner = await createGarageWithOwner('quota-jc');
    const customer = await request(app)
      .post('/api/customers')
      .set(authHeader(owner.token))
      .send({ name: 'JC Quota Cust', phone: nextPhone() });
    const vehicle = await request(app)
      .post('/api/vehicles')
      .set(authHeader(owner.token))
      .send({ licensePlate: 'MH01QC0001', make: 'Maruti', model: 'Swift', customer: customer.body.data._id });

    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post('/api/jobcards')
        .set(authHeader(owner.token))
        .send({ serviceType: 'service', vehicle: vehicle.body.data._id, customer: customer.body.data._id });
      expect(res.status).toBe(201);
    }

    const fourth = await request(app)
      .post('/api/jobcards')
      .set(authHeader(owner.token))
      .send({ serviceType: 'service', vehicle: vehicle.body.data._id, customer: customer.body.data._id });
    expect(fourth.status).toBe(403);
  });

  it('rejects creating a 4th invoice in the same garage on the same day', async () => {
    const owner = await createGarageWithOwner('quota-inv');
    const customer = await request(app)
      .post('/api/customers')
      .set(authHeader(owner.token))
      .send({ name: 'Inv Quota Cust', phone: nextPhone() });
    const vehicle = await request(app)
      .post('/api/vehicles')
      .set(authHeader(owner.token))
      .send({ licensePlate: 'MH01QI0001', make: 'Maruti', model: 'Swift', customer: customer.body.data._id });

    // Seed 4 job cards directly (bypassing the job-card daily cap, which is
    // covered separately above) so only the invoice cap is under test.
    const jobCardIds: string[] = [];
    for (let i = 0; i < 4; i++) {
      const jc = await JobCard.create({
        serviceType: 'service',
        vehicle: vehicle.body.data._id,
        customer: customer.body.data._id,
        garage: owner.garageId,
        createdBy: owner.userId
      });
      jobCardIds.push(jc._id.toString());
    }

    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post('/api/invoices')
        .set(authHeader(owner.token))
        .send({ jobCardId: jobCardIds[i] });
      expect(res.status).toBe(201);
    }

    const fourth = await request(app)
      .post('/api/invoices')
      .set(authHeader(owner.token))
      .send({ jobCardId: jobCardIds[3] });
    expect(fourth.status).toBe(403);
  });

  it('rejects creating a 3rd staff member in the same garage', async () => {
    const owner = await createGarageWithOwner('quota-staff');

    for (let i = 0; i < 2; i++) {
      const res = await request(app)
        .post('/api/users')
        .set(authHeader(owner.token))
        .send({
          name: `Staff ${i}`,
          email: `staff-quota-${i}-${Date.now()}@example.com`,
          phone: nextPhone(),
          password: 'password123',
          role: 'mechanic'
        });
      expect(res.status).toBe(201);
    }

    const third = await request(app)
      .post('/api/users')
      .set(authHeader(owner.token))
      .send({
        name: 'Staff 3',
        email: `staff-quota-3-${Date.now()}@example.com`,
        phone: nextPhone(),
        password: 'password123',
        role: 'mechanic'
      });
    expect(third.status).toBe(403);
  });
});
