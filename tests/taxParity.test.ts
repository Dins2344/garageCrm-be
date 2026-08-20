import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../app';
import { createGarageWithOwner, authHeader, nextPhone } from './helpers/factories';

/**
 * The estimation total is computed in THREE places:
 *
 *   backend/usecases/jobCardUsecase.ts   ← the source of truth (what gets saved)
 *   frontend/src/pages/JobCardDetail.tsx ← live preview while editing
 *   mobile/.../EstimationEditorScreen.tsx ← live preview while editing
 *
 * The plan deliberately keeps the duplication (two of them are throwaway
 * previews of unsaved input) but requires that all three ROUND identically.
 * They didn't: the backend rounded to 2dp and neither client did, so a
 * fractional total previewed as one number and saved as another — the kind of
 * one-cent discrepancy that gets reported as a billing bug.
 *
 * This test pins the shared arithmetic. If the backend formula changes, both
 * client mirrors must change with it.
 */

/** Verbatim copy of the backend's rounding. */
const round2 = (n: number) => Math.round(n * 100) / 100;

/** The formula, exactly as all three now implement it. */
function computeTotals(
  parts: { quantity: number; unitPrice: number }[],
  labor: { hours: number; ratePerHour: number }[],
  discount: number,
  taxRate: number
) {
  const partsTotal = parts.reduce((sum, p) => sum + p.quantity * p.unitPrice, 0);
  const laborTotal = labor.reduce((sum, l) => sum + l.hours * l.ratePerHour, 0);
  const subtotal = partsTotal + laborTotal;
  const taxAmount = ((subtotal - discount) * taxRate) / 100;
  const grandTotal = subtotal - discount + taxAmount;
  return {
    subtotal,
    taxAmount: round2(taxAmount),
    grandTotal: round2(grandTotal),
  };
}

describe('estimation tax rounding', () => {
  it('rounds a fractional tax to 2dp rather than leaving a long tail', () => {
    // 1234.55 @ 18% = 222.219 — the exact case that made a preview and a saved
    // invoice disagree.
    const t = computeTotals([{ quantity: 1, unitPrice: 1234.55 }], [], 0, 18);
    expect(t.taxAmount).toBe(222.22);
    expect(t.grandTotal).toBe(1456.77);
  });

  it('produces no floating-point tail on ordinary amounts', () => {
    const t = computeTotals(
      [{ quantity: 3, unitPrice: 199.99 }],
      [{ hours: 2.5, ratePerHour: 450 }],
      50,
      20
    );
    // 599.97 + 1125 = 1724.97; less 50 = 1674.97; @20% = 334.994
    expect(t.taxAmount).toBe(334.99);
    expect(t.grandTotal).toBe(2009.96);
    expect(String(t.grandTotal)).not.toMatch(/\d{3,}$/);
  });

  it('handles a 0% rate without inventing a tax line', () => {
    const t = computeTotals([{ quantity: 1, unitPrice: 500 }], [], 0, 0);
    expect(t.taxAmount).toBe(0);
    expect(t.grandTotal).toBe(500);
  });

  it('applies the discount before tax, not after', () => {
    // Order matters and is easy to flip when mirroring by hand.
    const t = computeTotals([{ quantity: 1, unitPrice: 1000 }], [], 100, 10);
    expect(t.taxAmount).toBe(90);   // 10% of 900, not of 1000
    expect(t.grandTotal).toBe(990);
  });

  it('is what the REAL server returns, not just what this file computes', async () => {
    // Without this the tests above only prove that a copy of the formula
    // rounds correctly. This pins the actual saved values, so a change to
    // jobCardUsecase that drops the rounding fails here.
    const { token } = await createGarageWithOwner('tax-parity');

    const customer = await request(app).post('/api/customers')
      .set(authHeader(token)).send({ name: 'Parity Customer', phone: nextPhone() });
    const vehicle = await request(app).post('/api/vehicles')
      .set(authHeader(token))
      .send({ licensePlate: 'KL07TP0001', make: 'Maruti', model: 'Swift', customer: customer.body.data._id });

    const jobCard = await request(app).post('/api/jobcards')
      .set(authHeader(token))
      .send({
        serviceType: 'service', vehicle: vehicle.body.data._id,
        customer: customer.body.data._id, odometerAtIntake: 1000,
      });

    const res = await request(app)
      .put(`/api/jobcards/${jobCard.body.data._id}/estimation`)
      .set(authHeader(token))
      .send({
        parts: [{ partName: 'Fractional part', quantity: 1, unitPrice: 1234.55 }],
        labor: [], discount: 0, taxRate: 18,
      });

    expect(res.status).toBe(200);
    const saved = res.body.data.estimation;
    const expected = computeTotals([{ quantity: 1, unitPrice: 1234.55 }], [], 0, 18);
    expect(saved.taxAmount).toBe(expected.taxAmount);
    expect(saved.grandTotal).toBe(expected.grandTotal);
    expect(saved.taxAmount).toBe(222.22);
  });

  it('matches what a 2dp currency formatter would display', () => {
    // The clients render through formatMoney (always 2dp). If the computed
    // value were left unrounded, the displayed and stored numbers could differ
    // in the last cent for some inputs.
    const t = computeTotals([{ quantity: 7, unitPrice: 33.33 }], [], 0, 18);
    expect(t.grandTotal).toBe(Number(t.grandTotal.toFixed(2)));
    expect(t.taxAmount).toBe(Number(t.taxAmount.toFixed(2)));
  });
});
