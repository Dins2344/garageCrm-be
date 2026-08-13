import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app';
import { createGarageWithOwner, nextPhone, authHeader } from './helpers/factories';

// PDFKit embeds a subsetted font and encodes text as glyph-index hex strings
// (CID/TJ operators), not literal ASCII — so asserting on rendered text would
// need a real font-aware PDF parser. These tests instead confirm: the new
// fields (odometerAtIntake, a non-fallback taxRate) actually reach the PDF
// generator without throwing, and the underlying numbers driving the PDF
// (taxRate/taxAmount) are computed correctly — see pdfService.ts's `?? 18`
// fallback and the odometerAtIntake wiring in invoiceUsecase/jobCardUsecase.
describe('PDF generation', () => {
  let token: string;
  let customerId: string;
  let vehicleId: string;

  beforeEach(async () => {
    const garage = await createGarageWithOwner('pdf-gen');
    token = garage.token;

    const customer = await request(app)
      .post('/api/customers')
      .set(authHeader(token))
      .send({ name: 'PDF Test Customer', phone: nextPhone() });
    customerId = customer.body.data._id;

    const vehicle = await request(app)
      .post('/api/vehicles')
      .set(authHeader(token))
      .send({ licensePlate: 'MH01PD0001', make: 'Maruti', model: 'Swift', customer: customerId });
    vehicleId = vehicle.body.data._id;
  });

  it('generates an estimation PDF for a job card with a genuinely 0% tax rate and an odometer reading', async () => {
    const jobCard = await request(app)
      .post('/api/jobcards')
      .set(authHeader(token))
      .send({ serviceType: 'service', vehicle: vehicleId, customer: customerId, odometerAtIntake: 15000 });
    expect(jobCard.status).toBe(201);
    const jobCardId = jobCard.body.data._id;
    expect(jobCard.body.data.odometerAtIntake).toBe(15000);

    const estimation = await request(app)
      .put(`/api/jobcards/${jobCardId}/estimation`)
      .set(authHeader(token))
      .send({
        parts: [],
        labor: [{ description: 'Tax-exempt inspection', hours: 1, ratePerHour: 500 }],
        discount: 0,
        taxRate: 0
      });
    expect(estimation.status).toBe(200);
    // A 0% rate must survive as an actual 0, not fall back to the 18% default.
    expect(estimation.body.data.estimation.taxRate).toBe(0);
    expect(estimation.body.data.estimation.taxAmount).toBe(0);
    expect(estimation.body.data.estimation.grandTotal).toBe(500);

    const pdf = await request(app)
      .get(`/api/jobcards/${jobCardId}/estimation/download`)
      .set(authHeader(token))
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).length).toBeGreaterThan(1000);
    expect((pdf.body as Buffer).subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('carries a custom tax rate and odometer reading through onto the invoice PDF', async () => {
    const jobCard = await request(app)
      .post('/api/jobcards')
      .set(authHeader(token))
      .send({ serviceType: 'repair', vehicle: vehicleId, customer: customerId, odometerAtIntake: 42500 });
    const jobCardId = jobCard.body.data._id;

    await request(app)
      .put(`/api/jobcards/${jobCardId}/estimation`)
      .set(authHeader(token))
      .send({
        parts: [],
        labor: [{ description: 'Custom rate service', hours: 2, ratePerHour: 500 }],
        discount: 0,
        taxRate: 12
      });

    const invoice = await request(app)
      .post('/api/invoices')
      .set(authHeader(token))
      .send({ jobCardId });
    expect(invoice.status).toBe(201);
    expect(invoice.body.data.taxRate).toBe(12);
    expect(invoice.body.data.taxAmount).toBeCloseTo(120, 2); // 1000 * 0.12
    const invoiceId = invoice.body.data._id;

    const pdf = await request(app)
      .get(`/api/invoices/${invoiceId}/pdf`)
      .set(authHeader(token))
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).length).toBeGreaterThan(1000);
    expect((pdf.body as Buffer).subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });
});
