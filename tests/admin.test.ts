import { describe, it, expect } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../app';
import Garage from '../models/Garage';
import User from '../models/User';
import ServiceReminder from '../models/ServiceReminder';
import { createGarageWithOwner, nextPhone, authHeader } from './helpers/factories';

async function adminLogin() {
  const res = await request(app).post('/api/admin/login').send({
    email: process.env.SUPER_ADMIN_EMAIL,
    password: process.env.SUPER_ADMIN_PASSWORD
  });
  return res.body.token as string;
}

const adminHeader = (token: string) => ({ Authorization: `Bearer ${token}` });

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
    expect(del.body.data.cascadedCounts).toMatchObject({
      users: 2, // owner + the one staff member
      customers: 1,
      vehicles: 1,
      jobCards: 1,
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
