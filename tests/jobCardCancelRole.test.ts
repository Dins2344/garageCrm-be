import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app';
import { createGarageWithOwner, insertStaff, nextPhone, authHeader } from './helpers/factories';
import { findById, schema } from './helpers/dbAccess';

/**
 * Cancelling closes a job card out for good, so it is owner/admin only. Staff
 * raise a cancellation request instead; an old mobile build that still offers
 * staff the button gets this message as its error toast.
 */
describe('job card cancellation is owner/admin only', () => {
  let owner: Awaited<ReturnType<typeof createGarageWithOwner>>;
  let jobCardId: string;
  const cancelAs = (token: string) =>
    request(app).put(`/api/jobcards/${jobCardId}`).set(authHeader(token)).send({ status: 'cancelled' });

  beforeEach(async () => {
    owner = await createGarageWithOwner('cancel-role');
    const post = (path: string, body: object) => request(app).post(path).set(authHeader(owner.token)).send(body);
    const customer = (await post('/api/customers', { name: 'Cancel Customer', phone: nextPhone() })).body.data._id;
    const vehicle = (await post('/api/vehicles', { licensePlate: 'KA01CN0001', make: 'Honda', model: 'City', customer })).body.data._id;
    jobCardId = (await post('/api/jobcards', { serviceType: 'service', vehicle, customer, odometerAtIntake: 1000 })).body.data._id;
  });

  it.each(['mechanic', 'service_advisor', 'receptionist'] as const)('refuses a %s and points them at a request', async (role) => {
    const staff = await insertStaff(owner.garageId, role, `cancel-${role}`);

    const res = await cancelAs(staff.token);

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Only an owner or admin can cancel a job card. Raise a cancellation request instead.');
    expect((await findById(schema.jobCards, jobCardId))?.status).toBe('new');
  });

  it('still lets an admin cancel', async () => {
    const admin = await insertStaff(owner.garageId, 'admin', 'cancel-admin');
    expect((await cancelAs(admin.token)).status).toBe(200);
  });

  it('still lets the owner cancel', async () => {
    expect((await cancelAs(owner.token)).status).toBe(200);
  });

  it('still lets a mechanic move the job forward', async () => {
    const mechanic = await insertStaff(owner.garageId, 'mechanic', 'cancel-forward');
    const res = await request(app).put(`/api/jobcards/${jobCardId}`).set(authHeader(mechanic.token)).send({ status: 'in_progress' });
    expect(res.status).toBe(200);
  });
});
