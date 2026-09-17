import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../app';
import { schema, findById } from './helpers/dbAccess';
import { resolveGarageLocale } from '../utils/locale';
import { COUNTRIES, LAUNCH_COUNTRY_CODES, getCountryOptions, isSupportedCountry } from '../config/countries';
import { registerGarageOwner, createGarageWithOwner, addGarageToOwner, nextPhone, authHeader } from './helpers/factories';

describe('resolveGarageLocale', () => {
  // The guarantee that makes the backfill script optional rather than a
  // cutover: documents written before `country` existed have no such key,
  // and Mongoose defaults only apply on write.
  it('resolves a garage with NO country key to the full India config', () => {
    const locale = resolveGarageLocale({});
    expect(locale.country).toBe('IN');
    expect(locale.currency).toBe('INR');
    expect(locale.locale).toBe('en-IN');
    expect(locale.taxLabel).toBe('GST');
    expect(locale.taxIdLabel).toBe('GSTIN');
    expect(locale.timezone).toBe('Asia/Kolkata');
  });

  it('resolves null/undefined the same way', () => {
    expect(resolveGarageLocale(null).country).toBe('IN');
    expect(resolveGarageLocale(undefined).currency).toBe('INR');
  });

  it('resolves a supported country from the table', () => {
    const gb = resolveGarageLocale({ country: 'GB' });
    expect(gb.currency).toBe('GBP');
    expect(gb.taxLabel).toBe('VAT');
    expect(gb.taxIdLabel).toBe('VAT No.');
    expect(gb.postalLabel).toBe('Postcode');
    expect(gb.postalInputMode).toBe('text');
    expect(gb.timezone).toBe('Europe/London');
  });

  it('lets a per-garage override beat the country table', () => {
    const locale = resolveGarageLocale({
      country: 'GB',
      settings: { currency: 'EUR', taxLabel: 'Sales Tax' },
    });
    expect(locale.currency).toBe('EUR');
    expect(locale.taxLabel).toBe('Sales Tax');
    // Un-overridden fields still come from the table.
    expect(locale.locale).toBe('en-GB');
  });

  it('treats empty/whitespace overrides as "inherit"', () => {
    const locale = resolveGarageLocale({
      country: 'GB',
      settings: { currency: '', locale: '   ', taxLabel: null },
    });
    expect(locale.currency).toBe('GBP');
    expect(locale.locale).toBe('en-GB');
    expect(locale.taxLabel).toBe('VAT');
  });

  it('falls back to India for an unknown country rather than throwing', () => {
    const locale = resolveGarageLocale({ country: 'ZZ' });
    expect(locale.country).toBe('IN');
    expect(locale.currency).toBe('INR');
  });

  it('falls back to UTC for a multi-timezone country with no override', () => {
    // US spans several zones, so the table stores null and the owner picks.
    expect(COUNTRIES.US.timezone).toBeNull();
    expect(resolveGarageLocale({ country: 'US' }).timezone).toBe('UTC');
    expect(resolveGarageLocale({ country: 'US', settings: { timezone: 'America/New_York' } }).timezone)
      .toBe('America/New_York');
  });
});

describe('Country-aware registration', () => {
  it('defaults to India when no country is sent (existing clients)', async () => {
    const res = await registerGarageOwner({ email: 'locale-default@example.com' });
    expect(res.status).toBe(201);
    expect(res.body.data.locale.currency).toBe('INR');

    const garage = await findById(schema.garages, res.body.data.garage);
    expect(garage!.country).toBe('IN');
    expect(garage!.settings.taxRate).toBe(18);
  });

  // The formal acceptance test for "a non-Indian garage can sign up".
  it('registers a GB garage with a GB phone number and GB defaults', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'British Owner',
      email: 'gb-owner@example.com',
      phone: '07911 123456',           // would have failed the old /^[6-9]\d{9}$/
      password: 'password123',
      garageName: 'London Motors',
      garagePhone: '020 7946 0958',
      country: 'GB',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.locale).toMatchObject({
      country: 'GB', currency: 'GBP', locale: 'en-GB', taxLabel: 'VAT', taxIdLabel: 'VAT No.',
    });

    const garage = await findById(schema.garages, res.body.data.garage);
    expect(garage!.country).toBe('GB');
    // Seeded from the country table, not the schema's Indian defaults.
    expect(garage!.settings.taxRate).toBe(20);
    expect(garage!.settings.laborRatePerHour).toBe(60);
    // Presentation overrides stay empty so they keep inheriting.
    expect(garage!.settings.currency).toBe('');
  });

  // The September 2026 launch markets. Each registers with its own phone
  // example (the number the picker shows must itself be valid), resolves its
  // own currency and tax label, and seeds its own rate — the whole point of
  // the table: a Qatari garage must not come out as an Indian one.
  it.each([
    ['LK', 'LKR', 'VAT', 'VAT No.', 18, '071 234 5678'],
    ['SA', 'SAR', 'VAT', 'VAT Registration No.', 15, '050 123 4567'],
    ['BH', 'BHD', 'VAT', 'VAT Account No.', 10, '3600 1234'],
    ['QA', 'QAR', 'VAT', 'TIN', 0, '3312 3456'],
    ['KW', 'KWD', 'VAT', 'Commercial Licence No.', 0, '5012 3456'],
    ['NP', 'NPR', 'VAT', 'PAN', 13, '984 123 4567'],
  ])('registers a %s garage with %s, %s and its own tax rate', async (country, currency, taxLabel, taxIdLabel, taxRate, phone) => {
    const res = await request(app).post('/api/auth/register').send({
      name: `${country} Owner`,
      email: `${country.toLowerCase()}-owner@example.com`,
      phone,
      password: 'password123',
      garageName: `${country} Motors`,
      garagePhone: phone,
      country,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.locale).toMatchObject({ country, currency, taxLabel, taxIdLabel });

    const garage = await findById(schema.garages, res.body.data.garage);
    expect(garage!.settings.taxRate).toBe(taxRate);
  });

  it('rejects an unsupported country', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'Nowhere Owner',
      email: 'nowhere@example.com',
      phone: nextPhone(),
      password: 'password123',
      garageName: 'Nowhere Motors',
      country: 'ZZ',
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/unsupported country/i);
  });

  it('accepts a non-Indian tax registration number (loosened validator)', async () => {
    const owner = await createGarageWithOwner('gb-vat');
    const res = await request(app)
      .put('/api/garage')
      .set(authHeader(owner.token))
      .send({ gstNumber: 'GB123456789' });   // rejected by the old GSTIN regex
    expect(res.status).toBe(200);
    expect(res.body.data.gstNumber).toBe('GB123456789');
  });
});

describe('Locale on API payloads', () => {
  it('is attached to login and /auth/me', async () => {
    await registerGarageOwner({ email: 'locale-me@example.com', password: 'password123' });

    const login = await request(app).post('/api/auth/login')
      .send({ email: 'locale-me@example.com', password: 'password123' });
    expect(login.status).toBe(200);
    expect(login.body.data.locale.currency).toBe('INR');

    const me = await request(app).get('/api/auth/me').set(authHeader(login.body.token));
    expect(me.status).toBe(200);
    expect(me.body.data.locale.currency).toBe('INR');
    // getMe must still flatten `garage` to a plain id (regression guard).
    expect(typeof me.body.data.garage).toBe('string');
  });

  it('is attached to GET /api/garage', async () => {
    const owner = await createGarageWithOwner('locale-garage');
    const res = await request(app).get('/api/garage').set(authHeader(owner.token));
    expect(res.status).toBe(200);
    expect(res.body.data.locale.taxLabel).toBe('GST');
  });

  it('is exposed by GET /api/meta/countries without auth', async () => {
    const res = await request(app).get('/api/meta/countries');
    expect(res.status).toBe(200);
    const india = res.body.data.find((c: { code: string }) => c.code === 'IN');
    expect(india).toMatchObject({ name: 'India', currency: 'INR', taxLabel: 'GST' });
    expect(india.requiresTimezoneChoice).toBe(false);
    // Multi-zone countries must tell the UI to ask for a timezone. None of the
    // launch markets spans zones, so check the option builder's source directly.
    expect(getCountryOptions().every(c => c.requiresTimezoneChoice === (COUNTRIES[c.code].timezone === null))).toBe(true);
    expect(COUNTRIES.US.timezone).toBeNull();
  });

  it('offers only the Play Store launch markets in the picker', async () => {
    const res = await request(app).get('/api/meta/countries');
    const codes = res.body.data.map((c: { code: string }) => c.code);
    expect(codes).toEqual(['IN', 'LK', 'AE', 'SA', 'BH', 'QA', 'KW', 'NP']);
    expect(codes).toEqual([...LAUNCH_COUNTRY_CODES]);
    // Hidden from the picker, still a valid country for garages that already have it.
    expect(codes).not.toContain('GB');
    expect(isSupportedCountry('GB')).toBe(true);
  });
});

describe('Branch country inheritance', () => {
  it('a new branch inherits the owner\'s country and rates, not the India defaults', async () => {
    const reg = await request(app).post('/api/auth/register').send({
      name: 'Branchy Owner',
      email: 'gb-branch@example.com',
      phone: '07911 222333',
      password: 'password123',
      garageName: 'GB Main Depot',
      garagePhone: '020 1111 2222',
      country: 'GB',
    });
    expect(reg.status).toBe(201);

    const branch = await addGarageToOwner(reg.body.token, 'GB Second Depot');
    expect(branch.status).toBe(201);
    expect(branch.body.data.country).toBe('GB');
    expect(branch.body.data.settings.taxRate).toBe(20);
    expect(branch.body.data.locale.currency).toBe('GBP');
  });
});
