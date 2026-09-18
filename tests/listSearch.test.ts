import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app';
import { createGarageWithOwner, nextPhone, authHeader } from './helpers/factories';

/**
 * The list searches. Vehicles: plate (spacing ignored), make, model or the
 * owner's name. Job cards: all of that plus the job card number. Both are
 * case-insensitive "contains" and scoped to the caller's garage.
 */
describe('list search', () => {
  let token: string;
  let numbers: { swift: string; creta: string };

  const post = (path: string, body: object) => request(app).post(path).set(authHeader(token)).send(body);
  const get = (path: string) => request(app).get(path).set(authHeader(token));
  const plates = (res: request.Response) => (res.body.data as { licensePlate: string }[]).map(v => v.licensePlate).sort();
  const jcNumbers = (res: request.Response) => (res.body.data as { jobCardNumber: string }[]).map(j => j.jobCardNumber).sort();

  beforeEach(async () => {
    token = (await createGarageWithOwner('search')).token;
    const anitha = (await post('/api/customers', { name: 'Anitha Krishnan', phone: nextPhone() })).body.data._id;
    const suresh = (await post('/api/customers', { name: 'Suresh Pillai', phone: nextPhone() })).body.data._id;
    const swift = (await post('/api/vehicles', { licensePlate: 'KL 07 BQ 4521', make: 'Maruti Suzuki', model: 'Swift', customer: anitha })).body.data._id;
    const creta = (await post('/api/vehicles', { licensePlate: 'KL01CA9087', make: 'Hyundai', model: 'Creta', customer: suresh })).body.data._id;
    await post('/api/vehicles', { licensePlate: 'MH 12 AB 0001', make: 'Toyota', model: 'Innova', customer: suresh });

    const jcSwift = (await post('/api/jobcards', { serviceType: 'service', vehicle: swift, customer: anitha, odometerAtIntake: 100 })).body.data;
    const jcCreta = (await post('/api/jobcards', { serviceType: 'repair', vehicle: creta, customer: suresh, odometerAtIntake: 200 })).body.data;
    numbers = { swift: jcSwift.jobCardNumber, creta: jcCreta.jobCardNumber };

    // Another garage with a look-alike vehicle that must never leak in.
    const other = await createGarageWithOwner('search-other');
    const c = (await request(app).post('/api/customers').set(authHeader(other.token)).send({ name: 'Anitha Menon', phone: nextPhone() })).body.data._id;
    await request(app).post('/api/vehicles').set(authHeader(other.token)).send({ licensePlate: 'KL 07 BQ 9999', make: 'Maruti Suzuki', model: 'Swift', customer: c });
  });

  describe('vehicles', () => {
    it('matches the plate with or without spaces, in any case', async () => {
      expect(plates(await get('/api/vehicles?search=kl07bq'))).toEqual(['KL 07 BQ 4521']);
      expect(plates(await get('/api/vehicles?search=KL 07 BQ'))).toEqual(['KL 07 BQ 4521']);
      expect(plates(await get('/api/vehicles?search=01 CA'))).toEqual(['KL01CA9087']);
    });

    it('matches make and model', async () => {
      expect(plates(await get('/api/vehicles?search=hyund'))).toEqual(['KL01CA9087']);
      expect(plates(await get('/api/vehicles?search=swift'))).toEqual(['KL 07 BQ 4521']);
    });

    it("matches the owner's name and returns all of their vehicles", async () => {
      expect(plates(await get('/api/vehicles?search=suresh'))).toEqual(['KL01CA9087', 'MH 12 AB 0001']);
      expect(plates(await get('/api/vehicles?search=krishnan'))).toEqual(['KL 07 BQ 4521']);
    });

    it('never crosses garages and treats blanks as no filter', async () => {
      expect(plates(await get('/api/vehicles?search=anitha'))).toEqual(['KL 07 BQ 4521']);
      expect((await get('/api/vehicles?search=%20')).body.total).toBe(3);
      expect((await get('/api/vehicles?search=zzz')).body.total).toBe(0);
    });
  });

  describe('job cards', () => {
    it('still matches the job card number', async () => {
      expect(jcNumbers(await get(`/api/jobcards?search=${numbers.creta.slice(-4)}`))).toEqual([numbers.creta]);
    });

    it('matches the vehicle plate, make and model', async () => {
      expect(jcNumbers(await get('/api/jobcards?search=kl07bq'))).toEqual([numbers.swift]);
      expect(jcNumbers(await get('/api/jobcards?search=Hyundai'))).toEqual([numbers.creta]);
      expect(jcNumbers(await get('/api/jobcards?search=cret'))).toEqual([numbers.creta]);
    });

    it("matches the customer's name", async () => {
      expect(jcNumbers(await get('/api/jobcards?search=pillai'))).toEqual([numbers.creta]);
    });

    it('combines with the status filter', async () => {
      const res = await get('/api/jobcards?search=pillai&status=cancelled');
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(0);
    });
  });
});
