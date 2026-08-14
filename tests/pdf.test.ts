import { describe, it, expect, beforeEach } from 'vitest';
import zlib from 'zlib';
import request from 'supertest';
import app from '../app';
import Garage from '../models/Garage';
import { createGarageWithOwner, nextPhone, authHeader } from './helpers/factories';

/** Downloads a PDF endpoint as a raw Buffer. */
async function fetchPdf(url: string, token: string) {
  return request(app)
    .get(url)
    .set(authHeader(token))
    .buffer(true)
    .parse((res, callback) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
    });
}

/**
 * Pull the visible text out of a PDFKit document.
 *
 * Two layers hide the text from a raw buffer search:
 *   1. PDFKit Flate-compresses each content stream; and
 *   2. it writes strings as hex inside a kerning array, e.g.
 *      `[<47535420> 20 <283132> 0] TJ` — one logical word split across runs.
 *
 * pdfService uses only the built-in Helvetica (no embedded/subsetted font), so
 * those hex bytes are plain ASCII rather than font-specific glyph ids. Undoing
 * both layers therefore recovers the real customer-facing wording, which is
 * what lets these tests assert on labels and amounts instead of only `%PDF-`.
 */
function extractPdfText(pdf: Buffer): string {
  const streams: string[] = [];
  let idx = 0;
  while (true) {
    const start = pdf.indexOf('stream', idx);
    if (start === -1) break;
    // Skip the EOL after the `stream` keyword (\r\n or \n).
    let bodyStart = start + 'stream'.length;
    if (pdf[bodyStart] === 0x0d) bodyStart++;
    if (pdf[bodyStart] === 0x0a) bodyStart++;
    const end = pdf.indexOf('endstream', bodyStart);
    if (end === -1) break;
    try {
      streams.push(zlib.inflateSync(pdf.subarray(bodyStart, end)).toString('latin1'));
    } catch {
      // Not a Flate stream (fonts, images) — skip it.
    }
    idx = end + 'endstream'.length;
  }

  const decodeHex = (hex: string) => Buffer.from(hex, 'hex').toString('latin1');
  const lines: string[] = [];

  for (const stream of streams) {
    // `[<hex> kern <hex> ...] TJ` — join the runs with nothing between them so
    // kerning doesn't split a word the assertions look for.
    for (const [, body] of stream.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
      lines.push([...body.matchAll(/<([0-9a-fA-F]*)>/g)].map(m => decodeHex(m[1])).join(''));
    }
    // `(literal) Tj` — the uncompressed spelling, in case PDFKit emits it.
    for (const [, body] of stream.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g)) {
      lines.push(body.replace(/\\([()\\])/g, '$1'));
    }
  }

  return lines.join('\n');
}

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
    await Garage.findByIdAndUpdate(garage.garageId, { gstNumber: '29ABCDE1234F1Z5' });

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

    const pdf = await fetchPdf(`/api/invoices/${invoiceId}/pdf`, token);

    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).length).toBeGreaterThan(1000);
    expect((pdf.body as Buffer).subarray(0, 5).toString('ascii')).toBe('%PDF-');

    const text = extractPdfText(pdf.body as Buffer);
    // An India garage keeps every label it had before: only the money format
    // changed, from the hardcoded "Rs." to the ISO code (Helvetica has no ₹).
    // 'GSTIN:' is exactly what the old hardcoded label printed — the tax-ID
    // line for an Indian garage is unchanged, only its source moved.
    expect(text).toContain('GSTIN: 29ABCDE1234F1Z5');
    expect(text).toContain('GST (12%)');
    expect(text).toContain('INR 1,000.00');
    expect(text).not.toContain('Rs.');
    expect(text).not.toContain('₹');
    expect(text).toContain('42,500 km');
  });
});

// ── Country-aware output ──────────────────────────────────────────────────
// The formal Phase 2 acceptance check: a non-Indian garage must produce a PDF
// with its own currency and tax label, and no trace of the India-only strings.
describe('PDF generation for a non-Indian garage', () => {
  it('renders a GB invoice in GBP with VAT, and never GST or Rs.', async () => {
    const { token, garageId } = await createGarageWithOwner('pdf-gb');
    // Registration doesn't take a country until Phase 3 ships the picker, so
    // set it directly — this test is about output, not onboarding. The tax ID
    // keeps the field name `gstNumber` on purpose (published mobile builds
    // send it); only the printed label follows the country.
    await Garage.findByIdAndUpdate(garageId, { country: 'GB', gstNumber: 'GB123456789' });

    const customer = await request(app)
      .post('/api/customers')
      .set(authHeader(token))
      .send({ name: 'London Customer', phone: nextPhone() });

    const vehicle = await request(app)
      .post('/api/vehicles')
      .set(authHeader(token))
      .send({ licensePlate: 'LN51ABC', make: 'Ford', model: 'Focus', customer: customer.body.data._id });

    const jobCard = await request(app)
      .post('/api/jobcards')
      .set(authHeader(token))
      .send({
        serviceType: 'service',
        vehicle: vehicle.body.data._id,
        customer: customer.body.data._id,
        odometerAtIntake: 42500
      });

    await request(app)
      .put(`/api/jobcards/${jobCard.body.data._id}/estimation`)
      .set(authHeader(token))
      .send({ parts: [], labor: [{ description: 'MOT prep', hours: 2, ratePerHour: 500 }], discount: 0, taxRate: 20 });

    const invoice = await request(app)
      .post('/api/invoices')
      .set(authHeader(token))
      .send({ jobCardId: jobCard.body.data._id });
    expect(invoice.status).toBe(201);

    const pdf = await fetchPdf(`/api/invoices/${invoice.body.data._id}/pdf`, token);
    expect(pdf.status).toBe(200);
    const text = extractPdfText(pdf.body as Buffer);

    expect(text).toContain('GBP');
    expect(text).toContain('VAT (20%)');
    expect(text).toContain('VAT No.: GB123456789');
    expect(text).not.toContain('GST');
    expect(text).not.toContain('INR');
    expect(text).not.toContain('Rs.');

    // Thousands group in threes under en-GB, not in the Indian lakh pattern.
    expect(text).toContain('GBP 1,000.00');
    expect(text).toContain('42,500 km');
  });
});
