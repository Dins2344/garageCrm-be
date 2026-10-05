import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app';
import { eq } from 'drizzle-orm';
import { createGarageWithOwner, nextPhone, authHeader } from './helpers/factories';
import { db, schema } from './helpers/dbAccess';

/**
 * A new job card's reading may not go below the vehicle's last visit that
 * counts — the newest one not cancelled, ignoring 0 ("not recorded"). The way
 * past it is a correction after creation: owner/admin only, remarks required,
 * recorded on the timeline.
 */
describe('job card odometer validation', () => {
  let token: string;
  let customer: string;
  let vehicle: string;
  let plate = 0;

  const post = (path: string, body: object, t = token) => request(app).post(path).set(authHeader(t)).send(body);
  const put = (path: string, body: object, t = token) => request(app).put(path).set(authHeader(t)).send(body);
  const open = (odometerAtIntake: number, v = vehicle) =>
    post('/api/jobcards', { serviceType: 'service', vehicle: v, customer, odometerAtIntake });
  /**
   * A finished visit at this reading, dated on an earlier day as a real one
   * would be — which also keeps it out of today's free-plan cap of 3 cards.
   */
  let daysAgo = 1000;
  const visit = async (odometerAtIntake: number, status: 'delivered' | 'cancelled' = 'delivered') => {
    const jc = (await open(odometerAtIntake)).body.data;
    await put(`/api/jobcards/${jc._id}`, { status });
    await db.update(schema.jobCards)
      .set({ createdAt: new Date(Date.now() - --daysAgo * 86_400_000) })
      .where(eq(schema.jobCards._id, jc._id));
    return jc;
  };
  const newVehicle = async () =>
    (await post('/api/vehicles', { licensePlate: `KA01OD${String(++plate).padStart(4, '0')}`, make: 'Honda', model: 'City', customer })).body.data._id as string;

  beforeEach(async () => {
    token = (await createGarageWithOwner(`odo-${plate}`)).token;
    customer = (await post('/api/customers', { name: 'Odo Customer', phone: nextPhone() })).body.data._id;
    vehicle = await newVehicle();
  });

  describe('on creation', () => {
    it('accepts any reading on a first visit', async () => {
      expect((await open(500)).status).toBe(201);
    });

    it('rejects a reading below the last visit and names it', async () => {
      const last = await visit(45200);

      const res = await open(40000);

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('45200 km');
      expect(res.body.message).toContain(last.jobCardNumber);
    });

    it('accepts a reading equal to the last visit', async () => {
      await visit(45200);
      expect((await open(45200)).status).toBe(201);
    });

    it('skips cancelled visits and compares with the one before them', async () => {
      await visit(45200);
      await visit(90000, 'cancelled');
      await visit(95000, 'cancelled');

      const res = await open(40000);
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('45200 km');
      expect((await open(46000)).status).toBe(201);
    });

    it('does not check when every earlier visit was cancelled', async () => {
      await visit(45200, 'cancelled');
      expect((await open(100)).status).toBe(201);
    });

    it('ignores a recorded 0 and compares with the visit before it', async () => {
      await visit(30000);
      // Creation can no longer record 0 after a real reading; legacy rows can,
      // and so can an owner's correction.
      const unknown = await visit(30000);
      await put(`/api/jobcards/${unknown._id}`, { odometerAtIntake: 0, odometerRemarks: 'Reading not recorded' });

      const res = await open(25000);
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('30000 km');
    });

    it('only looks at the same vehicle', async () => {
      await visit(45200);
      expect((await open(100, await newVehicle())).status).toBe(201);
    });

    it('compares with the corrected reading after an owner fixes a visit', async () => {
      const jc = await visit(45200);
      await put(`/api/jobcards/${jc._id}`, { odometerAtIntake: 4520, odometerRemarks: 'Extra digit typed at intake' });

      expect((await open(5000)).status).toBe(201);
    });
  });

  describe('correcting a recorded reading', () => {
    let jobCardId: string;
    beforeEach(async () => {
      jobCardId = (await open(45200)).body.data._id;
    });

    it('lets the owner lower it with remarks and records it on the timeline', async () => {
      const res = await put(`/api/jobcards/${jobCardId}`, { odometerAtIntake: 12000, odometerRemarks: 'Odometer replaced' });

      expect(res.status).toBe(200);
      expect(res.body.data.odometerAtIntake).toBe(12000);
      const last = res.body.data.statusHistory.at(-1);
      expect(last.status).toBe('new');
      expect(last.notes).toBe('Odometer corrected from 45200 km to 12000 km. Remarks: Odometer replaced');
    });

    it('requires remarks', async () => {
      const blank = await put(`/api/jobcards/${jobCardId}`, { odometerAtIntake: 12000, odometerRemarks: '   ' });
      const missing = await put(`/api/jobcards/${jobCardId}`, { odometerAtIntake: 12000 });

      expect(blank.status).toBe(400);
      expect(missing.status).toBe(400);
    });

    it('refuses other roles', async () => {
      await post('/api/users', {
        name: 'Advisor', email: `adv-${plate}@example.com`, phone: nextPhone(), password: 'password123', role: 'service_advisor'
      });
      const advisor = (await request(app).post('/api/auth/login').send({ email: `adv-${plate}@example.com`, password: 'password123' })).body.token;

      const res = await put(`/api/jobcards/${jobCardId}`, { odometerAtIntake: 12000, odometerRemarks: 'x' }, advisor);

      expect(res.status).toBe(403);
    });

    it('treats an unchanged reading as no change, for any role and without remarks', async () => {
      const res = await put(`/api/jobcards/${jobCardId}`, { odometerAtIntake: 45200, internalNotes: 'hi' });

      expect(res.status).toBe(200);
      expect(res.body.data.statusHistory).toHaveLength(1);
    });

    it('records both entries when the reading and status change together', async () => {
      const res = await put(`/api/jobcards/${jobCardId}`, { odometerAtIntake: 12000, odometerRemarks: 'Meter swap', status: 'in_progress' });

      expect(res.body.data.statusHistory.map((h: { status: string }) => h.status)).toEqual(['new', 'new', 'in_progress']);
    });
  });
});
