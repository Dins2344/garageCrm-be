import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app';
import { eq } from 'drizzle-orm';
import { createGarageWithOwner, nextPhone, authHeader } from './helpers/factories';
import { db, schema, findById } from './helpers/dbAccess';

/**
 * Changes made to a job card after creation land on its timeline: who it is
 * assigned to and every change to the estimation. Assignees must be staff of
 * the same garage with a fitting role — the pickers only offer those, and a
 * foreign key alone would accept anyone's id.
 */
describe('job card timeline for post-creation changes', () => {
  let token: string;
  let jobCardId: string;
  let ravi: string;
  let raviEmail: string;
  let seq = 0;

  const post = (path: string, body: object, t = token) => request(app).post(path).set(authHeader(t)).send(body);
  const put = (path: string, body: object, t = token) => request(app).put(path).set(authHeader(t)).send(body);
  const staff = async (t: string, name: string, role: string) =>
    (await post('/api/users', { name, email: `${role}-${++seq}@example.com`, phone: nextPhone(), password: 'password123', role }, t)).body.data._id as string;
  const notes = (res: request.Response) => (res.body.data.statusHistory as { notes: string }[]).map(h => h.notes);
  const lastEntry = (res: request.Response) => res.body.data.statusHistory.at(-1) as { status: string; notes: string };

  beforeEach(async () => {
    token = (await createGarageWithOwner(`timeline-${++seq}`)).token;
    // The free plan allows two staff, so each test adds its own second one.
    ravi = await staff(token, 'Ravi Kumar', 'mechanic');
    raviEmail = `mechanic-${seq}@example.com`;
    const customer = (await post('/api/customers', { name: 'TL Customer', phone: nextPhone() })).body.data._id;
    const vehicle = (await post('/api/vehicles', { licensePlate: `KA01TL${String(seq).padStart(4, '0')}`, make: 'Honda', model: 'City', customer })).body.data._id;
    jobCardId = (await post('/api/jobcards', { serviceType: 'service', vehicle, customer, odometerAtIntake: 100 })).body.data._id;
  });

  describe('mechanic assignment', () => {
    it('records assign, change and unassign, keeping the current status', async () => {
      const anil = await staff(token, 'Anil Joseph', 'mechanic');
      const assigned = await put(`/api/jobcards/${jobCardId}`, { assignedMechanic: ravi });
      expect(lastEntry(assigned)).toMatchObject({ status: 'new', notes: 'Mechanic assigned: Ravi Kumar' });

      const changed = await put(`/api/jobcards/${jobCardId}`, { assignedMechanic: anil });
      expect(lastEntry(changed).notes).toBe('Mechanic changed from Ravi Kumar to Anil Joseph');

      const cleared = await put(`/api/jobcards/${jobCardId}`, { assignedMechanic: '' });
      expect(lastEntry(cleared).notes).toBe('Mechanic unassigned (was Anil Joseph)');
      expect(cleared.body.data.assignedMechanic).toBeNull();
    });

    it('records nothing when the same mechanic is sent again', async () => {
      await put(`/api/jobcards/${jobCardId}`, { assignedMechanic: ravi });
      const again = await put(`/api/jobcards/${jobCardId}`, { assignedMechanic: ravi });

      expect(notes(again)).toEqual(['Job card created', 'Mechanic assigned: Ravi Kumar']);
    });

    it("refuses another garage's mechanic", async () => {
      const other = (await createGarageWithOwner(`timeline-other-${++seq}`)).token;
      const outsider = await staff(other, 'Outsider', 'mechanic');

      const res = await put(`/api/jobcards/${jobCardId}`, { assignedMechanic: outsider });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Mechanic not found in this garage');
    });

    it('refuses a staff member without the mechanic role', async () => {
      const advisor = await staff(token, 'Priya Nair', 'service_advisor');
      expect((await put(`/api/jobcards/${jobCardId}`, { assignedMechanic: advisor })).status).toBe(400);
    });

    it('validates the assignee at creation too', async () => {
      const other = (await createGarageWithOwner(`timeline-other-${++seq}`)).token;
      const outsider = await staff(other, 'Outsider', 'mechanic');
      const customer = (await post('/api/customers', { name: 'TL Two', phone: nextPhone() })).body.data._id;
      const vehicle = (await post('/api/vehicles', { licensePlate: `KA02TL${String(seq).padStart(4, '0')}`, make: 'Honda', model: 'City', customer })).body.data._id;

      const res = await post('/api/jobcards', { serviceType: 'service', vehicle, customer, odometerAtIntake: 1, assignedMechanic: outsider });

      expect(res.status).toBe(400);
    });

    it('records a service advisor change the same way', async () => {
      const advisor = await staff(token, 'Priya Nair', 'service_advisor');
      const res = await put(`/api/jobcards/${jobCardId}`, { assignedAdvisor: advisor });
      expect(lastEntry(res).notes).toBe('Service advisor assigned: Priya Nair');
    });
  });

  describe('estimation', () => {
    const save = (body: object) => request(app).put(`/api/jobcards/${jobCardId}/estimation`).set(authHeader(token)).send(body);
    const quote = { parts: [{ partName: 'Oil filter', quantity: 1, unitPrice: 400 }], labor: [{ description: 'Service', hours: 1, ratePerHour: 600 }], discount: 0, taxRate: 0 };

    it('records the first estimate without a previous total', async () => {
      const res = await save(quote);

      expect(lastEntry(res).status).toBe('new');
      expect(lastEntry(res).notes).toMatch(/^Estimation updated: 1 part, 1 labour item, total .*1,000\.00$/);
    });

    it('records every change with the previous total', async () => {
      await save(quote);
      const res = await save({ ...quote, parts: [{ partName: 'Oil filter', quantity: 2, unitPrice: 400 }] });

      expect(lastEntry(res).notes).toMatch(/total .*1,400\.00 \(was .*1,000\.00\)$/);
    });

    it('records a change that leaves the total the same', async () => {
      await save(quote);
      const res = await save({ ...quote, parts: [{ partName: 'Air filter', quantity: 1, unitPrice: 400 }] });

      expect(notes(res).filter(n => n.startsWith('Estimation updated'))).toHaveLength(2);
    });

    it('records nothing when saved unchanged', async () => {
      await save(quote);
      const res = await save(quote);

      expect(notes(res).filter(n => n.startsWith('Estimation updated'))).toHaveLength(1);
    });
  });
  describe('who made the change', () => {
    const get = () => request(app).get(`/api/jobcards/${jobCardId}`).set(authHeader(token));
    const byNote = async (note: string | RegExp) =>
      ((await get()).body.data.statusHistory as { notes: string; changedBy: { name: string } | null }[])
        .find(h => (typeof note === 'string' ? h.notes === note : note.test(h.notes)))!;
    const quoteAndSend = async () => {
      await request(app).put(`/api/jobcards/${jobCardId}/estimation`).set(authHeader(token))
        .send({ parts: [], labor: [{ description: 'Service', hours: 1, ratePerHour: 600 }], discount: 0, taxRate: 0 });
      await put(`/api/jobcards/${jobCardId}`, { status: 'estimation_sent' });
    };

    it('names the signed-in staff member', async () => {
      expect((await byNote('Job card created')).changedBy?.name).toBe('Test Owner');
    });

    it('names a deleted staff member "Former staff member", not a generic label', async () => {
      const mechToken = (await request(app).post('/api/auth/login').send({ email: raviEmail, password: 'password123' })).body.token;
      await put(`/api/jobcards/${jobCardId}`, { status: 'in_progress', statusNotes: 'Started by Ravi' }, mechToken);
      await request(app).delete(`/api/users/${ravi}`).set(authHeader(token));

      expect((await byNote('Started by Ravi')).changedBy?.name).toBe('Former staff member');
    });

    it('names the customer when they approve through the link', async () => {
      await quoteAndSend();
      const { estimationToken } = (await findById(schema.jobCards, jobCardId))!;
      expect((await request(app).post(`/api/public/estimate/${estimationToken}/approve`)).status).toBe(200);

      expect((await byNote('Estimation approved by customer via approval link')).changedBy?.name).toBe('Customer');
    });

    it('names the customer on link approvals saved before the marker existed', async () => {
      const row = (await findById(schema.jobCards, jobCardId))!;
      await db.update(schema.jobCards).set({
        statusHistory: [...row.statusHistory, { status: 'approved', changedBy: null, changedAt: new Date().toISOString(), notes: 'Estimation approved by customer via approval link' }]
      }).where(eq(schema.jobCards._id, jobCardId));

      expect((await byNote('Estimation approved by customer via approval link')).changedBy?.name).toBe('Customer');
    });

    it('records staff approving for the customer as that staff member', async () => {
      await quoteAndSend();
      await request(app).put(`/api/jobcards/${jobCardId}/approve`).set(authHeader(token));

      const entry = await byNote('Estimation approved on behalf of the customer');
      expect(entry.changedBy?.name).toBe('Test Owner');
    });
  });
});
