import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app';
import { createGarageWithOwner, addGarageToOwner, nextPhone, authHeader, authHeaderFor } from './helpers/factories';
import { monthKey, monthRange, previousMonthKey } from '../utils/dates';

/**
 * Expenses are owner/admin only, live in one garage, and feed the monthly
 * metrics: revenue (paid invoices by paid date), services (invoices raised),
 * expenses (by expense date), net profit, with last month alongside.
 */
describe('expenses', () => {
  let token: string;

  const post = (t: string, path: string, body: object) => request(app).post(path).set(authHeader(t)).send(body);
  const get = (t: string, path: string) => request(app).get(path).set(authHeader(t));

  const thisMonth = monthKey(new Date());
  const lastMonth = previousMonthKey(thisMonth);
  const dayIn = (month: string, day: number) => {
    const { start } = monthRange(month)!;
    return new Date(start.getFullYear(), start.getMonth(), day, 12).toISOString();
  };

  beforeEach(async () => {
    token = (await createGarageWithOwner('exp')).token;
  });

  describe('CRUD and access', () => {
    it('records, lists, updates and deletes an expense', async () => {
      const created = await post(token, '/api/expenses', {
        title: 'Engine oil stock', category: 'parts', amount: 12500, expenseDate: dayIn(thisMonth, 3), paymentMethod: 'upi'
      });
      expect(created.status).toBe(201);
      expect(created.body.data).toMatchObject({ title: 'Engine oil stock', category: 'parts', amount: 12500, paymentMethod: 'upi' });
      expect(created.body.data.createdBy?.name).toBe('Test Owner');
      const id = created.body.data._id;

      const list = await get(token, '/api/expenses');
      expect(list.status).toBe(200);
      expect(list.body.total).toBe(1);
      expect(list.body.totalAmount).toBe(12500);

      const updated = await request(app).put(`/api/expenses/${id}`).set(authHeader(token)).send({ amount: 13000, notes: 'Two drums' });
      expect(updated.status).toBe(200);
      expect(updated.body.data).toMatchObject({ amount: 13000, notes: 'Two drums', title: 'Engine oil stock' });

      expect((await request(app).delete(`/api/expenses/${id}`).set(authHeader(token))).status).toBe(200);
      expect((await get(token, `/api/expenses/${id}`)).status).toBe(404);
    });

    it('rejects a missing title, a zero amount, a bad category and a bad date', async () => {
      const cases = [
        { amount: 100, expenseDate: dayIn(thisMonth, 1) },
        { title: 'x', amount: 0, expenseDate: dayIn(thisMonth, 1) },
        { title: 'x', amount: 100, expenseDate: dayIn(thisMonth, 1), category: 'bribes' },
        { title: 'x', amount: 100, expenseDate: 'not a date' }
      ];
      for (const body of cases) {
        const res = await post(token, '/api/expenses', body);
        expect(res.status, JSON.stringify(body)).toBe(400);
      }
    });

    it('is open to owners and admins, closed to everyone else', async () => {
      // The free plan allows two staff per garage, so the four roles go two
      // to a garage.
      const second = await createGarageWithOwner('exp-roles');
      const homes = { admin: token, service_advisor: token, mechanic: second.token, receptionist: second.token } as const;
      for (const [role, ownerToken] of Object.entries(homes)) {
        const email = `${role}-exp@example.com`;
        const made = await post(ownerToken, '/api/users', { name: role, email, phone: nextPhone(), password: 'password123', role });
        expect(made.status, role).toBe(201);
        const login = await request(app).post('/api/auth/login').send({ email, password: 'password123' });
        const res = await get(login.body.token, '/api/expenses');
        expect(res.status, role).toBe(role === 'admin' ? 200 : 403);
        const monthly = await get(login.body.token, '/api/dashboard/monthly');
        expect(monthly.status, role).toBe(role === 'admin' ? 200 : 403);
      }
    });

    it('keeps each branch\'s expenses to itself', async () => {
      const branch = (await addGarageToOwner(token, 'Branch Two')).body.data._id as string;
      await post(token, '/api/expenses', { title: 'Main rent', amount: 20000, expenseDate: dayIn(thisMonth, 1), category: 'rent' });
      await request(app).post('/api/expenses').set(authHeaderFor(token, branch))
        .send({ title: 'Branch rent', amount: 8000, expenseDate: dayIn(thisMonth, 1), category: 'rent' });

      const main = await get(token, '/api/expenses');
      expect(main.body.data.map((e: { title: string }) => e.title)).toEqual(['Main rent']);
      const other = await request(app).get('/api/expenses').set(authHeaderFor(token, branch));
      expect(other.body.data.map((e: { title: string }) => e.title)).toEqual(['Branch rent']);

      // A row from the other branch is not reachable by id either.
      const foreignId = other.body.data[0]._id;
      expect((await get(token, `/api/expenses/${foreignId}`)).status).toBe(404);
      expect((await request(app).delete(`/api/expenses/${foreignId}`).set(authHeader(token))).status).toBe(404);
    });
  });

  describe('list filters', () => {
    beforeEach(async () => {
      await post(token, '/api/expenses', { title: 'Rent', category: 'rent', amount: 20000, expenseDate: dayIn(thisMonth, 1) });
      await post(token, '/api/expenses', { title: 'Brake pads', category: 'parts', amount: 3200, expenseDate: dayIn(thisMonth, 10) });
      await post(token, '/api/expenses', { title: 'Old rent', category: 'rent', amount: 20000, expenseDate: dayIn(lastMonth, 1) });
    });

    it('filters by month and reports that month\'s total', async () => {
      const res = await get(token, `/api/expenses?month=${thisMonth}`);
      expect(res.body.total).toBe(2);
      expect(res.body.totalAmount).toBe(23200);
      // Newest expense date first.
      expect(res.body.data.map((e: { title: string }) => e.title)).toEqual(['Brake pads', 'Rent']);
      expect((await get(token, `/api/expenses?month=${lastMonth}`)).body.total).toBe(1);
    });

    it('filters by category and title, and rejects a malformed month', async () => {
      expect((await get(token, '/api/expenses?category=rent')).body.total).toBe(2);
      expect((await get(token, '/api/expenses?search=brake')).body.total).toBe(1);
      expect((await get(token, '/api/expenses?month=2026-13')).status).toBe(400);
      expect((await get(token, '/api/expenses?month=sept')).status).toBe(400);
      expect((await get(token, '/api/expenses?category=fun')).status).toBe(400);
    });
  });

  describe('monthly metrics', () => {
    /** An invoiced job card whose invoice is paid; returns its total. */
    const billAndPay = async (plate: string, pay: boolean) => {
      const customer = (await post(token, '/api/customers', { name: `C ${plate}`, phone: nextPhone() })).body.data._id;
      const vehicle = (await post(token, '/api/vehicles', { licensePlate: plate, make: 'Honda', model: 'City', customer })).body.data._id;
      const jc = (await post(token, '/api/jobcards', { serviceType: 'service', vehicle, customer, odometerAtIntake: 100 })).body.data;
      await request(app).put(`/api/jobcards/${jc._id}/estimation`).set(authHeader(token))
        .send({ parts: [], labor: [{ description: 'Service', hours: 2, ratePerHour: 500 }], discount: 0, taxRate: 0 });
      await request(app).put(`/api/jobcards/${jc._id}`).set(authHeader(token)).send({ status: 'estimation_sent' });
      await request(app).put(`/api/jobcards/${jc._id}/approve`).set(authHeader(token));
      const inv = (await post(token, '/api/invoices', { jobCardId: jc._id })).body.data;
      if (pay) {
        await request(app).put(`/api/invoices/${inv._id}/payment`).set(authHeader(token))
          .send({ paymentStatus: 'paid', paymentMethod: 'cash', amountPaid: inv.grandTotal });
      }
      return inv.grandTotal as number;
    };

    it('adds up revenue, services, expenses and profit for the month, with last month beside it', async () => {
      const paid = await billAndPay('MM01AA0001', true);      // 1000 revenue, 1 service
      await billAndPay('MM01AA0002', false);                    // unpaid: a service, no revenue
      await post(token, '/api/expenses', { title: 'Rent', category: 'rent', amount: 400, expenseDate: dayIn(thisMonth, 1) });
      await post(token, '/api/expenses', { title: 'Pads', category: 'parts', amount: 150.5, expenseDate: dayIn(thisMonth, 2) });
      await post(token, '/api/expenses', { title: 'Old rent', category: 'rent', amount: 400, expenseDate: dayIn(lastMonth, 1) });

      const res = await get(token, '/api/dashboard/monthly');
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        month: thisMonth,
        revenue: paid,
        services: 2,
        expenses: 550.5,
        netProfit: Math.round((paid - 550.5) * 100) / 100,
        previous: { month: lastMonth, revenue: 0, services: 0, expenses: 400, netProfit: -400 }
      });
      expect(res.body.data.expensesByCategory).toEqual([
        { category: 'rent', total: 400, count: 1 },
        { category: 'parts', total: 150.5, count: 1 }
      ]);
    });

    it('answers any month asked for and rejects a malformed one', async () => {
      await post(token, '/api/expenses', { title: 'Old rent', category: 'rent', amount: 400, expenseDate: dayIn(lastMonth, 1) });

      const res = await get(token, `/api/dashboard/monthly?month=${lastMonth}`);
      expect(res.body.data).toMatchObject({ month: lastMonth, expenses: 400, netProfit: -400 });
      expect(res.body.data.previous.month).toBe(previousMonthKey(lastMonth));

      expect((await get(token, '/api/dashboard/monthly?month=2026-00')).status).toBe(400);
    });
  });
});

describe('month helpers', () => {
  it('parse, bound and step back', () => {
    expect(monthRange('2026-09')!.start).toEqual(new Date(2026, 8, 1));
    expect(monthRange('2026-09')!.end).toEqual(new Date(2026, 9, 1));
    expect(monthRange('2026-12')!.end).toEqual(new Date(2027, 0, 1));
    expect(monthRange('2026-13')).toBeNull();
    expect(monthRange('26-09')).toBeNull();
    expect(previousMonthKey('2026-01')).toBe('2025-12');
    expect(monthKey(new Date(2026, 0, 31))).toBe('2026-01');
  });
});
