import { describe, it, expect } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../app';
import Garage from '../models/Garage';
import User from '../models/User';
import ServiceReminder from '../models/ServiceReminder';
import { createGarageWithOwner, nextPhone, authHeader, loginAsSuperAdmin, adminHeader } from './helpers/factories';
import { SAMPLE_CUSTOMERS, SAMPLE_JOB_CARDS, SAMPLE_VEHICLES } from '../config/sampleData';

const adminLogin = loginAsSuperAdmin;

describe('Admin: delete user', () => {
  it('returns 404 for a non-existent user', async () => {
    const adminToken = await adminLogin();
    const res = await request(app)
      .delete(`/api/admin/users/${new mongoose.Types.ObjectId()}`)
      .set(adminHeader(adminToken));

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('deletes a staff user without touching the garage or its data', async () => {
    const owner = await createGarageWithOwner('admin-staff-del');
    const adminToken = await adminLogin();

    const staffPhone = nextPhone();
    const createStaff = await request(app)
      .post('/api/users')
      .set(authHeader(owner.token))
      .send({
        name: 'Doomed Mechanic', email: 'doomed-mechanic@example.com', phone: staffPhone,
        password: 'password123', role: 'mechanic'
      });
    const staffId = createStaff.body.data._id as string;

    const customer = await request(app)
      .post('/api/customers')
      .set(authHeader(owner.token))
      .send({ name: 'Kept Customer', phone: nextPhone() });
    expect(customer.status).toBe(201);

    const del = await request(app)
      .delete(`/api/admin/users/${staffId}`)
      .set(adminHeader(adminToken));

    expect(del.status).toBe(200);
    expect(del.body.data.deletedUser.role).toBe('mechanic');
    expect(del.body.data.cascadedGarages).toBeUndefined();

    // Staff account is gone
    const staffLogin = await request(app).post('/api/auth/login').send({ email: 'doomed-mechanic@example.com', password: 'password123' });
    expect(staffLogin.status).toBe(401);

    // Garage and its data are untouched
    const garageStillThere = await Garage.findById(owner.garageId);
    expect(garageStillThere).not.toBeNull();
    const customersStillThere = await request(app).get('/api/customers').set(authHeader(owner.token));
    expect(customersStillThere.body.data.some((c: { name: string }) => c.name === 'Kept Customer')).toBe(true);
  });

  it('cascades: deleting an owner removes their garage, its data, and its staff', async () => {
    const owner = await createGarageWithOwner('admin-owner-del');
    const adminToken = await adminLogin();

    const staffPhone = nextPhone();
    await request(app)
      .post('/api/users')
      .set(authHeader(owner.token))
      .send({
        name: 'Also Doomed', email: 'also-doomed@example.com', phone: staffPhone,
        password: 'password123', role: 'receptionist'
      });

    const customer = await request(app)
      .post('/api/customers')
      .set(authHeader(owner.token))
      .send({ name: 'Doomed Customer', phone: nextPhone() });
    const customerId = customer.body.data._id;

    const vehicle = await request(app)
      .post('/api/vehicles')
      .set(authHeader(owner.token))
      .send({ licensePlate: 'MH01DD0001', make: 'Toyota', model: 'Etios', customer: customerId });
    const vehicleId = vehicle.body.data._id;

    const jobCard = await request(app)
      .post('/api/jobcards')
      .set(authHeader(owner.token))
      .send({ serviceType: 'service', vehicle: vehicleId, customer: customerId, odometerAtIntake: 10000 });
    expect(jobCard.status).toBe(201);

    const item = await request(app)
      .post('/api/inventory')
      .set(authHeader(owner.token))
      .send({ partName: 'Brake Pad', unitPrice: 800, quantity: 10, threshold: 2 });
    expect(item.status).toBe(201);

    const reminder = await ServiceReminder.create({
      vehicle: vehicleId, customer: customerId, garage: owner.garageId,
      nextServiceDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    });
    expect(reminder._id).toBeTruthy();

    const del = await request(app)
      .delete(`/api/admin/users/${owner.userId}`)
      .set(adminHeader(adminToken));

    expect(del.status).toBe(200);
    expect(del.body.data.deletedUser.role).toBe('owner');
    expect(del.body.data.cascadedGarages).toBe(1);
    // Counts are the rows created above PLUS the demo dataset every garage is
    // seeded with at registration. Expressed against the fixtures rather than as
    // literals so growing the sample set does not silently look like a cascade
    // regression here.
    expect(del.body.data.cascadedCounts).toMatchObject({
      users: 2, // owner + the one staff member
      customers: 1 + SAMPLE_CUSTOMERS.length,
      vehicles: 1 + SAMPLE_VEHICLES.length,
      jobCards: 1 + SAMPLE_JOB_CARDS.length,
      inventory: 1,
      reminders: 1
    });

    // Everything under that garage is gone
    expect(await Garage.findById(owner.garageId)).toBeNull();
    expect(await User.findById(owner.userId)).toBeNull();

    const ownerLogin = await request(app).post('/api/auth/login').send({ email: `owner-admin-owner-del@example.com`, password: 'password123' });
    expect(ownerLogin.status).toBe(401);
    const staffLogin = await request(app).post('/api/auth/login').send({ email: 'also-doomed@example.com', password: 'password123' });
    expect(staffLogin.status).toBe(401);
  });

  it('does not touch a different owner\'s garage when deleting one owner', async () => {
    const ownerA = await createGarageWithOwner('admin-isolation-a');
    const ownerB = await createGarageWithOwner('admin-isolation-b');
    const adminToken = await adminLogin();

    const customerB = await request(app)
      .post('/api/customers')
      .set(authHeader(ownerB.token))
      .send({ name: 'Safe Customer', phone: nextPhone() });
    expect(customerB.status).toBe(201);

    const del = await request(app)
      .delete(`/api/admin/users/${ownerA.userId}`)
      .set(adminHeader(adminToken));
    expect(del.status).toBe(200);

    expect(await Garage.findById(ownerA.garageId)).toBeNull();
    expect(await Garage.findById(ownerB.garageId)).not.toBeNull();

    const stillWorks = await request(app).get('/api/customers').set(authHeader(ownerB.token));
    expect(stillWorks.status).toBe(200);
    expect(stillWorks.body.data.some((c: { name: string }) => c.name === 'Safe Customer')).toBe(true);
  });
});

describe('Admin: delete orphaned garage', () => {
  it('returns 404 for a non-existent garage', async () => {
    const adminToken = await adminLogin();
    const res = await request(app)
      .delete(`/api/admin/garages/${new mongoose.Types.ObjectId()}`)
      .set(adminHeader(adminToken));

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('deletes a garage that has no owner', async () => {
    const adminToken = await adminLogin();
    const orphan = await Garage.create({ name: 'Orphan Test Garage', phone: nextPhone(), address: {} });

    const del = await request(app)
      .delete(`/api/admin/garages/${orphan._id}`)
      .set(adminHeader(adminToken));

    expect(del.status).toBe(200);
    expect(del.body.data.deletedGarage.name).toBe('Orphan Test Garage');
    expect(await Garage.findById(orphan._id)).toBeNull();
  });

  it('refuses to delete a garage that has an owner', async () => {
    const owner = await createGarageWithOwner('admin-garage-protect');
    const adminToken = await adminLogin();

    const del = await request(app)
      .delete(`/api/admin/garages/${owner.garageId}`)
      .set(adminHeader(adminToken));

    expect(del.status).toBe(400);
    expect(del.body.success).toBe(false);
    expect(await Garage.findById(owner.garageId)).not.toBeNull();
  });
});
