import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../app';
import { getPlanCatalog, PLANS, PLAN_PRICES, FREE_PLAN_LIMITS, priceCurrencyMatchesCountry } from '../config/plans';
import { SUPPORTED_COUNTRY_CODES, COUNTRIES } from '../config/countries';

describe('plan catalog', () => {
  it('serves Free, Plus and Pro publicly with purchasing disabled', async () => {
    const res = await request(app).get('/api/meta/plans?country=AE');

    expect(res.status).toBe(200);
    expect(res.body.data.plans.map((p: { id: string }) => p.id)).toEqual(['free', 'plus', 'pro']);
    expect(res.body.data.currency).toBe('AED');
    expect(res.body.data.purchasing.enabled).toBe(false);
    expect(res.body.data.purchasing.message).toMatch(/enabled soon/i);
  });

  it('resolves a listed country to its own currency and a lower-cased query too', async () => {
    const catalog = getPlanCatalog('bh'.toUpperCase());
    expect(catalog.currency).toBe('BHD');
    // BHD has 1000 minor units: 5_000 fils is 5 dinars, not 50.
    expect(catalog.plans[1].price.monthly).toBe(5);

    const res = await request(app).get('/api/meta/plans?country=sa');
    expect(res.body.data.currency).toBe('SAR');
  });

  it('falls back to the USD defaults for an unknown or missing country', () => {
    expect(getPlanCatalog('ZZ').currency).toBe('USD');
    expect(getPlanCatalog(undefined).country).toBe('default');
    // A supported country with no price row also falls back rather than 500ing.
    expect(getPlanCatalog('GB').currency).toBe('USD');
  });

  it('never leaks the unlimited sentinel — null means unlimited', () => {
    const pro = getPlanCatalog('IN').plans.find(p => p.id === 'pro')!;
    expect(pro.limits.maxJobCardsPerGaragePerDay).toBeNull();
    expect(pro.limits.maxStaffPerGarage).toBeNull();
    expect(pro.limits.maxGaragesPerOwner).toBe(10);
  });

  it('keeps the Free limits the usecases read identical to the Free plan card', () => {
    expect(FREE_PLAN_LIMITS).toBe(PLANS.free.limits);
    expect(getPlanCatalog('IN').plans[0].limits).toEqual({
      maxGaragesPerOwner: 2, maxJobCardsPerGaragePerDay: 3, maxInvoicesPerGaragePerDay: 3, maxStaffPerGarage: 2
    });
  });

  it('caps Plus at 10 job cards and 10 invoices a day, as decided', () => {
    expect(PLANS.plus.limits.maxJobCardsPerGaragePerDay).toBe(10);
    expect(PLANS.plus.limits.maxInvoicesPerGaragePerDay).toBe(10);
  });

  it('prices annual as ten months, Free as zero', () => {
    const { plans } = getPlanCatalog('IN');
    expect(plans[0].price).toEqual({ monthly: 0, annual: 0 });
    expect(plans[1].price.annual).toBe(plans[1].price.monthly * 10);
    expect(plans[2].price.annual).toBe(plans[2].price.monthly * 10);
  });

  it('prices every launch country in the currency its country entry declares', () => {
    for (const code of ['IN', 'LK', 'AE', 'SA', 'BH', 'QA', 'KW', 'NP'] as const) {
      expect(PLAN_PRICES[code], code).toBeDefined();
      expect(PLAN_PRICES[code]!.currency).toBe(COUNTRIES[code].currency);
    }
    for (const code of SUPPORTED_COUNTRY_CODES) {
      expect(priceCurrencyMatchesCountry(code), code).toBe(true);
    }
  });

  it('has no emoji in any plan copy', () => {
    const text = JSON.stringify(PLANS);
    expect(text).not.toMatch(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });
});
