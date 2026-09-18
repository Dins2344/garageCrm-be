import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../app';
import { createGarageWithOwner, addGarageToOwner, nextPhone, authHeader, authHeaderFor } from './helpers/factories';
import { findById, countRows, countInGarage } from './helpers/dbAccess';
import { users } from '../models/User';
import { garages } from '../models/Garage';
import { customers } from '../models/Customer';
import { vehicles } from '../models/Vehicle';
import { jobCards } from '../models/JobCard';
import { invoices } from '../models/Invoice';

/**
 * DELETE /auth/account. The password is the confirmation. Owners take every
 * garage they own (and everything inside) with them; staff lose only their
 * own row and the job cards they worked stay behind with the reference
 * cleared. Neither can touch another garage.
 */
describe('account deletion', () => {
  const post = (token: string, path: string, body: object) => request(app).post(path).set(authHeader(token)).send(body);
  const del = (token: string, body?: object) => request(app).delete('/api/auth/account').set(authHeader(token)).send(body ?? {});

  /** A garage with one staff member, one customer, one vehicle, one invoiced job card. */
  const populate = async (suffix: string) => {
    const owner = await createGarageWithOwner(suffix);
    const staffRes = await post(owner.token, '/api/users', {
      name: 'Mechanic', email: `mech-${suffix}@example.com`, phone: nextPhone(), password: 'password123', role: 'mechanic'
    });
    const mechanicId = staffRes.body.data._id as string;
    const staffLogin = await request(app).post('/api/auth/login').send({ email: `mech-${suffix}@example.com`, password: 'password123' });
    const customer = (await post(owner.token, '/api/customers', { name: 'Del Customer', phone: nextPhone() })).body.data._id;
    const vehicle = (await post(owner.token, '/api/vehicles', { licensePlate: `DL${suffix.slice(0, 4).toUpperCase()}1`, make: 'Honda', model: 'City', customer })).body.data._id;
    const jc = (await post(owner.token, '/api/jobcards', { serviceType: 'service', vehicle, customer, assignedMechanic: mechanicId, odometerAtIntake: 100 })).body.data;
    await request(app).put(`/api/jobcards/${jc._id}/estimation`).set(authHeader(owner.token))
      .send({ parts: [], labor: [{ description: 'Service', hours: 1, ratePerHour: 500 }], discount: 0, taxRate: 18 });
    await request(app).put(`/api/jobcards/${jc._id}`).set(authHeader(owner.token)).send({ status: 'estimation_sent' });
    await request(app).put(`/api/jobcards/${jc._id}/approve`).set(authHeader(owner.token));
    await post(owner.token, '/api/invoices', { jobCardId: jc._id });
    return { ...owner, mechanicId, staffToken: staffLogin.body.token as string, jobCardId: jc._id as string };
  };

  it('refuses without the right password and leaves everything in place', async () => {
    const g = await populate('del-wrongpw');

    expect((await del(g.token)).status).toBe(401);
    const wrong = await del(g.token, { password: 'not-it' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.message).toBe('Password is incorrect');

    expect(await findById(users, g.userId)).not.toBeNull();
    expect(await findById(garages, g.garageId)).not.toBeNull();
    expect(await countInGarage(jobCards, g.garageId)).toBe(1);
  });

  it('an owner takes every garage they own and everything inside with them', async () => {
    const g = await populate('del-owner');
    const branchRes = await addGarageToOwner(g.token, 'Second Branch');
    const branchId = branchRes.body.data._id as string;
    await request(app).post('/api/customers').set(authHeaderFor(g.token, branchId)).send({ name: 'Branch Customer', phone: nextPhone() });

    // A neighbouring garage that must be untouched.
    const other = await populate('del-other');

    const res = await del(g.token, { password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/deleted/i);
    expect(res.headers['set-cookie']?.join(';')).toMatch(/token=none/);

    // The owner, both garages and every tenant row are gone.
    expect(await findById(users, g.userId)).toBeNull();
    expect(await findById(users, g.mechanicId)).toBeNull();
    expect(await findById(garages, g.garageId)).toBeNull();
    expect(await findById(garages, branchId)).toBeNull();
    for (const table of [customers, vehicles, jobCards, invoices] as const) {
      expect(await countInGarage(table, g.garageId)).toBe(0);
      expect(await countInGarage(table, branchId)).toBe(0);
    }

    // The neighbour still has its owner, staff and data.
    expect(await findById(users, other.userId)).not.toBeNull();
    expect(await findById(users, other.mechanicId)).not.toBeNull();
    expect(await countInGarage(jobCards, other.garageId)).toBe(1);
    expect(await countInGarage(invoices, other.garageId)).toBe(1);

    // The token is dead: the user behind it no longer exists.
    expect((await request(app).get('/api/auth/me').set(authHeader(g.token))).status).toBe(401);
  });

  it('a staff member loses only their own row; the garage and their job cards stay', async () => {
    const g = await populate('del-staff');
    const before = await countRows(users);

    const res = await del(g.staffToken, { password: 'password123' });
    expect(res.status).toBe(200);

    expect(await findById(users, g.mechanicId)).toBeNull();
    expect(await countRows(users)).toBe(before - 1);
    expect(await findById(users, g.userId)).not.toBeNull();
    expect(await findById(garages, g.garageId)).not.toBeNull();
    expect(await countInGarage(jobCards, g.garageId)).toBe(1);
    expect(await countInGarage(invoices, g.garageId)).toBe(1);

    // The job card keeps its history with the mechanic reference cleared.
    const jc = await findById(jobCards, g.jobCardId);
    expect(jc?.assignedMechanicId).toBeNull();
    expect(jc?.status).toBe('delivered');

    // The owner still sees it, without a mechanic.
    const detail = await request(app).get(`/api/jobcards/${g.jobCardId}`).set(authHeader(g.token));
    expect(detail.status).toBe(200);
    expect(detail.body.data.assignedMechanic ?? null).toBeNull();

    expect((await request(app).get('/api/auth/me').set(authHeader(g.staffToken))).status).toBe(401);
  });
});
