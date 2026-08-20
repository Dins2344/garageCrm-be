import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../app';
import Garage from '../models/Garage';
import { createGarageWithOwner, authHeader, nextPhone } from './helpers/factories';

/**
 * Phase 3: an owner picks their country at signup and can change it later.
 *
 * The country is the routing key for every locale decision, so these tests
 * cover the two places it can be set (registration, Settings) and the two
 * things that must follow it — phone validation and the reminder timezone.
 */

const registerIn = (country: string, overrides: Record<string, unknown> = {}) =>
  request(app).post('/api/auth/register').send({
    name: 'Owner',
    email: `owner-${country}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    password: 'password123',
    garageName: 'Test Garage',
    country,
    ...overrides,
  });

describe('country-aware phone validation at registration', () => {
  it('rejects a phone number that is not valid for the chosen country', async () => {
    // A perfectly good Indian mobile, but this owner said they're in the UK.
    const res = await registerIn('GB', { phone: '9876543210' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/valid phone number for United Kingdom/i);
    // The example in the message has to be the country's, not India's.
    expect(res.body.message).toContain('7911');
  });

  it('rejects an invalid garage phone as well as the owner phone', async () => {
    const res = await registerIn('GB', { phone: '07911123456', garagePhone: '9876543210' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/garage phone/i);
  });

  it('still accepts a bare 10-digit Indian mobile', async () => {
    // Phase 1 loosened the User.phone schema regex so non-Indian numbers could
    // be stored, which left nothing checking Indian ones. This is that check.
    const res = await registerIn('IN', { phone: nextPhone() });
    expect(res.status).toBe(201);
  });

  it('rejects obvious garbage that the loosened schema regex would allow', async () => {
    const res = await registerIn('IN', { phone: '123' });
    expect(res.status).toBe(400);
  });

  it('accepts a number written with the country code and spacing', async () => {
    const res = await registerIn('AU', { phone: '+61 412 345 678' });
    expect(res.status).toBe(201);
  });

  it('leaves no orphaned garage behind when the phone is rejected', async () => {
    // Registration creates User then Garage; a validation failure must happen
    // before either exists, not between them.
    const before = await Garage.countDocuments();
    await registerIn('GB', { phone: '9876543210' });
    expect(await Garage.countDocuments()).toBe(before);
  });
});

describe('timezone at registration', () => {
  it('stores the chosen zone for a country that spans several', async () => {
    const res = await registerIn('US', { phone: '2125551000', timezone: 'America/Chicago' });
    expect(res.status).toBe(201);
    expect(res.body.data.locale.timezone).toBe('America/Chicago');

    const garage = await Garage.findById(res.body.data.garage);
    expect(garage!.settings.timezone).toBe('America/Chicago');
  });

  it('falls back to UTC when a multi-zone country sends no timezone', async () => {
    const res = await registerIn('US', { phone: '2125551001' });
    expect(res.status).toBe(201);
    expect(res.body.data.locale.timezone).toBe('UTC');
  });

  it('ignores a timezone for a single-zone country so the table stays authoritative', async () => {
    // Storing a redundant override would freeze the garage against a later
    // correction to the country table.
    const res = await registerIn('IN', { phone: nextPhone(), timezone: 'America/Chicago' });
    expect(res.status).toBe(201);
    expect(res.body.data.locale.timezone).toBe('Asia/Kolkata');

    const garage = await Garage.findById(res.body.data.garage);
    expect(garage!.settings.timezone).toBe('');
  });

  it('rejects a timezone string the runtime does not recognise', async () => {
    const res = await registerIn('US', { phone: '2125551002', timezone: 'Mars/Olympus_Mons' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/unrecognised timezone/i);
  });
});

describe('changing country from Settings', () => {
  it('updates the resolved locale on the garage payload', async () => {
    const owner = await createGarageWithOwner('country-change');

    const res = await request(app)
      .put('/api/garage')
      .set(authHeader(owner.token))
      .send({ country: 'GB' });

    expect(res.status).toBe(200);
    expect(res.body.data.country).toBe('GB');
    expect(res.body.data.locale).toMatchObject({
      country: 'GB', currency: 'GBP', taxLabel: 'VAT', taxIdLabel: 'VAT No.',
      postalLabel: 'Postcode', postalInputMode: 'text',
    });
  });

  it('normalises a lowercase country code', async () => {
    const owner = await createGarageWithOwner('country-lower');
    const res = await request(app)
      .put('/api/garage')
      .set(authHeader(owner.token))
      .send({ country: 'gb' });
    expect(res.status).toBe(200);
    expect(res.body.data.country).toBe('GB');
  });

  it('rejects an unsupported country with a 400, not a validation 500', async () => {
    const owner = await createGarageWithOwner('country-bad');
    const res = await request(app)
      .put('/api/garage')
      .set(authHeader(owner.token))
      .send({ country: 'ZZ' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/unsupported country/i);
  });

  it('does NOT rewrite the owner\'s configured tax rate', async () => {
    // Deliberate: the rate is seeded from the country once, then owned by the
    // garage. Silently overwriting a rate the owner set — because they
    // corrected their country — would be the worse surprise.
    const owner = await createGarageWithOwner('country-taxrate');
    await request(app).put('/api/garage').set(authHeader(owner.token)).send({ settings: { taxRate: 5 } });

    const res = await request(app).put('/api/garage').set(authHeader(owner.token)).send({ country: 'GB' });
    expect(res.status).toBe(200);
    expect(res.body.data.settings.taxRate).toBe(5);
  });

  it('accepts a timezone override and rejects a bogus one', async () => {
    const owner = await createGarageWithOwner('country-tz');

    const ok = await request(app)
      .put('/api/garage')
      .set(authHeader(owner.token))
      .send({ country: 'US', settings: { timezone: 'America/Denver' } });
    expect(ok.status).toBe(200);
    expect(ok.body.data.locale.timezone).toBe('America/Denver');

    const bad = await request(app)
      .put('/api/garage')
      .set(authHeader(owner.token))
      .send({ settings: { timezone: 'Nowhere/Nothing' } });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/unrecognised timezone/i);
  });

  it('lets an empty timezone clear the override so the country table applies', async () => {
    const owner = await createGarageWithOwner('country-tz-clear');
    await request(app).put('/api/garage').set(authHeader(owner.token))
      .send({ country: 'US', settings: { timezone: 'America/Denver' } });

    const res = await request(app).put('/api/garage').set(authHeader(owner.token))
      .send({ country: 'GB', settings: { timezone: '' } });
    expect(res.status).toBe(200);
    expect(res.body.data.locale.timezone).toBe('Europe/London');
  });

  it('accepts an alphanumeric postcode now that the picker exposes the country', async () => {
    // The clients used a numeric-only input for this field, which made a UK
    // postcode impossible to type at all. Nothing on the server rejected it.
    const owner = await createGarageWithOwner('country-postcode');
    const res = await request(app)
      .put('/api/garage')
      .set(authHeader(owner.token))
      .send({ country: 'GB', address: { pincode: 'SW1A 1AA' } });
    expect(res.status).toBe(200);
    expect(res.body.data.address.pincode).toBe('SW1A 1AA');
  });
});
