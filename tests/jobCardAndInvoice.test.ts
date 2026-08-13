import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app';
import { createGarageWithOwner, nextPhone, authHeader } from './helpers/factories';

describe('Job card lifecycle + invoice billing', () => {
  let token: string;
  let customerId: string;
  let vehicleId: string;
  let inventoryItemId: string;

  // Re-created before every test: the global afterEach in tests/setup.ts wipes
  // all collections between tests, so a beforeAll fixture here would only
  // survive the first `it()`.
  beforeEach(async () => {
    const garage = await createGarageWithOwner('jc-flow');
    token = garage.token;

    const customer = await request(app)
      .post('/api/customers')
      .set(authHeader(token))
      .send({ name: 'Billing Customer', phone: nextPhone() });
    customerId = customer.body.data._id;

    const vehicle = await request(app)
      .post('/api/vehicles')
      .set(authHeader(token))
      .send({ licensePlate: 'MH01ZZ1111', make: 'Honda', model: 'City', customer: customerId });
    vehicleId = vehicle.body.data._id;

    const item = await request(app)
      .post('/api/inventory')
      .set(authHeader(token))
      .send({ partName: 'Oil Filter', unitPrice: 350, quantity: 20, threshold: 5 });
    inventoryItemId = item.body.data._id;
  });

  it('rejects job card creation without an odometer reading', async () => {
    const jobCard = await request(app)
      .post('/api/jobcards')
      .set(authHeader(token))
      .send({ serviceType: 'service', vehicle: vehicleId, customer: customerId });

    expect(jobCard.status).toBe(400);
    expect(jobCard.body.success).toBe(false);
    expect(jobCard.body.message).toMatch(/odometer/i);
  });

  it('creates a job card, saves an estimation with correct totals, and generates an invoice', async () => {
    const jobCard = await request(app)
      .post('/api/jobcards')
      .set(authHeader(token))
      .send({ serviceType: 'service', vehicle: vehicleId, customer: customerId, odometerAtIntake: 10000 });
    expect(jobCard.status).toBe(201);
    const jobCardId = jobCard.body.data._id;

    const estimation = await request(app)
      .put(`/api/jobcards/${jobCardId}/estimation`)
      .set(authHeader(token))
      .send({
        parts: [{ inventoryItem: inventoryItemId, partName: 'Oil Filter', quantity: 2, unitPrice: 350 }],
        labor: [{ description: 'Oil change labor', hours: 1, ratePerHour: 500 }],
        discount: 0,
        taxRate: 18
      });
    expect(estimation.status).toBe(200);

    // subtotal = 2*350 + 1*500 = 1200; tax = 1200*0.18 = 216; grandTotal = 1416
    expect(estimation.body.data.estimation.subtotal).toBe(1200);
    expect(estimation.body.data.estimation.taxAmount).toBeCloseTo(216, 2);
    expect(estimation.body.data.estimation.grandTotal).toBeCloseTo(1416, 2);

    const invoice = await request(app)
      .post('/api/invoices')
      .set(authHeader(token))
      .send({ jobCardId });
    expect(invoice.status).toBe(201);
    expect(invoice.body.data.grandTotal).toBeCloseTo(1416, 2);
    expect(invoice.body.data.paymentStatus).toBe('unpaid');

    // Job card should now be marked delivered with the invoice linked
    const jobCardAfter = await request(app)
      .get(`/api/jobcards/${jobCardId}`)
      .set(authHeader(token));
    expect(jobCardAfter.body.data.status).toBe('delivered');

    // Inventory stock should have been decremented by the ordered quantity (2)
    const itemAfter = await request(app)
      .get(`/api/inventory/${inventoryItemId}`)
      .set(authHeader(token));
    expect(itemAfter.body.data.quantity).toBe(18);

    // Partial payment
    const partialPayment = await request(app)
      .put(`/api/invoices/${invoice.body.data._id}/payment`)
      .set(authHeader(token))
      .send({ amountPaid: 500 });
    expect(partialPayment.body.data.paymentStatus).toBe('partial');

    // Full payment
    const fullPayment = await request(app)
      .put(`/api/invoices/${invoice.body.data._id}/payment`)
      .set(authHeader(token))
      .send({ amountPaid: 1416 });
    expect(fullPayment.body.data.paymentStatus).toBe('paid');
    expect(fullPayment.body.data.paidAt).toBeTruthy();
  });

  it('does not allow a cancelled job card to be reopened', async () => {
    const jobCard = await request(app)
      .post('/api/jobcards')
      .set(authHeader(token))
      .send({ serviceType: 'repair', vehicle: vehicleId, customer: customerId, odometerAtIntake: 10000 });
    const jobCardId = jobCard.body.data._id;

    const cancel = await request(app)
      .put(`/api/jobcards/${jobCardId}`)
      .set(authHeader(token))
      .send({ status: 'cancelled' });
    expect(cancel.status).toBe(200);
    expect(cancel.body.data.status).toBe('cancelled');

    const reopen = await request(app)
      .put(`/api/jobcards/${jobCardId}`)
      .set(authHeader(token))
      .send({ status: 'in_progress' });
    expect(reopen.status).toBe(400);
  });

  it('rejects sending an estimation to the customer with no parts or labor', async () => {
    const jobCard = await request(app)
      .post('/api/jobcards')
      .set(authHeader(token))
      .send({ serviceType: 'service', vehicle: vehicleId, customer: customerId, odometerAtIntake: 10000 });
    const jobCardId = jobCard.body.data._id;

    const send = await request(app)
      .put(`/api/jobcards/${jobCardId}`)
      .set(authHeader(token))
      .send({ status: 'estimation_sent' });

    expect(send.status).toBe(400);
  });
});
