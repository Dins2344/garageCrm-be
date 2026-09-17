import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app';
import { createGarageWithOwner, nextPhone, authHeader } from './helpers/factories';
import { listParam } from '../utils/query';

/**
 * `GET /jobcards?status=` accepts one status (what every shipped client
 * sends), a comma-separated list, or a repeated key. The three job cards
 * below cover new / in_progress / cancelled so each shape can be told apart
 * by which numbers come back.
 */
describe('job card list — status filter', () => {
  let token: string;
  let numbers: Record<'fresh' | 'working' | 'cancelled', string>;

  const post = (path: string, body: object) => request(app).post(path).set(authHeader(token)).send(body);
  const put = (path: string, body: object) => request(app).put(path).set(authHeader(token)).send(body);
  const list = (query: string) => request(app).get(`/api/jobcards${query}`).set(authHeader(token));
  const numbersOf = (res: request.Response) =>
    (res.body.data as { jobCardNumber: string }[]).map(jc => jc.jobCardNumber).sort();

  beforeEach(async () => {
    token = (await createGarageWithOwner('jc-filter')).token;

    const customer = (await post('/api/customers', { name: 'Filter Customer', phone: nextPhone() })).body.data._id;
    const carA = (await post('/api/vehicles', { licensePlate: 'KA01FA0001', make: 'Honda', model: 'City', customer })).body.data._id;
    const carB = (await post('/api/vehicles', { licensePlate: 'KA01FA0002', make: 'Suzuki', model: 'Swift', customer })).body.data._id;

    // A vehicle holds one active job card at a time, so the cancelled one
    // frees car A for the in-progress one.
    const cancelled = (await post('/api/jobcards', { serviceType: 'service', vehicle: carA, customer, odometerAtIntake: 100 })).body.data;
    await put(`/api/jobcards/${cancelled._id}`, { status: 'cancelled' });
    const working = (await post('/api/jobcards', { serviceType: 'repair', vehicle: carA, customer, odometerAtIntake: 200 })).body.data;
    await put(`/api/jobcards/${working._id}`, { status: 'in_progress' });
    const fresh = (await post('/api/jobcards', { serviceType: 'service', vehicle: carB, customer, odometerAtIntake: 300 })).body.data;

    numbers = { fresh: fresh.jobCardNumber, working: working.jobCardNumber, cancelled: cancelled.jobCardNumber };
  });

  it('still filters on a single status, as shipped clients send it', async () => {
    const res = await list('?status=new');
    expect(res.status).toBe(200);
    expect(numbersOf(res)).toEqual([numbers.fresh]);
    expect(res.body.total).toBe(1);
  });

  it('matches any of a comma-separated list', async () => {
    const res = await list('?status=cancelled,in_progress');
    expect(res.status).toBe(200);
    expect(numbersOf(res)).toEqual([numbers.cancelled, numbers.working].sort());
    expect(res.body.total).toBe(2);
  });

  it('accepts a repeated key too, and ignores blanks and duplicates', async () => {
    const res = await list('?status=new&status=cancelled&status=&status=new');
    expect(res.status).toBe(200);
    expect(numbersOf(res)).toEqual([numbers.cancelled, numbers.fresh].sort());
  });

  it('treats an empty status as no filter', async () => {
    const res = await list('?status=');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
  });

  it('rejects an unknown status with a 400 rather than an empty page', async () => {
    const res = await list('?status=new,finished');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/Status must be one of: new, estimation_sent/);
  });

  it('combines with the search filter', async () => {
    const res = await list(`?status=new,in_progress&search=${encodeURIComponent(numbers.working)}`);
    expect(res.status).toBe(200);
    expect(numbersOf(res)).toEqual([numbers.working]);
  });
});

describe('listParam', () => {
  it('normalises the three query shapes to one de-duplicated list', () => {
    expect(listParam(undefined)).toEqual([]);
    expect(listParam('')).toEqual([]);
    expect(listParam('new')).toEqual(['new']);
    expect(listParam('new, approved,,new')).toEqual(['new', 'approved']);
    expect(listParam(['new', 'approved,cancelled'])).toEqual(['new', 'approved', 'cancelled']);
    // A non-string (an object from `?status[x]=y`) is ignored, not thrown on.
    expect(listParam({ x: 'y' })).toEqual([]);
  });
});
