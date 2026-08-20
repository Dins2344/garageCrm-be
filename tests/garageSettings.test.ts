import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../app';
import Garage from '../models/Garage';
import { createGarageWithOwner, authHeader } from './helpers/factories';

/**
 * Regression cover for the whole-sub-document `$set` bug: `updateGarageInfo`
 * used to send `$set: { settings: {...} }`, which REPLACES the sub-document.
 * Any caller sending a partial `settings` object silently wiped the keys it
 * omitted. Both clients worked around it by resending every key on every save
 * — which is also how `currency` kept getting forced back to 'INR'.
 */
describe('Garage settings — partial updates merge instead of replacing', () => {
  it('preserves sibling settings keys when only one is sent', async () => {
    const owner = await createGarageWithOwner('settings-merge');

    // Establish a known baseline across all four settings keys.
    const baseline = await request(app)
      .put('/api/garage')
      .set(authHeader(owner.token))
      .send({
        settings: {
          currency: 'GBP',
          taxRate: 20,
          laborRatePerHour: 75,
          serviceReminderDays: 365,
        },
      });
    expect(baseline.status).toBe(200);

    // Now send ONLY taxRate, as a well-behaved client would.
    const partial = await request(app)
      .put('/api/garage')
      .set(authHeader(owner.token))
      .send({ settings: { taxRate: 5 } });
    expect(partial.status).toBe(200);

    const garage = await Garage.findById(owner.garageId);
    expect(garage!.settings.taxRate).toBe(5);
    // The three untouched keys must survive.
    expect(garage!.settings.currency).toBe('GBP');
    expect(garage!.settings.laborRatePerHour).toBe(75);
    expect(garage!.settings.serviceReminderDays).toBe(365);
  });

  it('preserves sibling address keys when only one is sent', async () => {
    const owner = await createGarageWithOwner('address-merge');

    await request(app)
      .put('/api/garage')
      .set(authHeader(owner.token))
      .send({ address: { street: 'MG Road', city: 'Pune', state: 'MH', pincode: '411001' } });

    const partial = await request(app)
      .put('/api/garage')
      .set(authHeader(owner.token))
      .send({ address: { city: 'Mumbai' } });
    expect(partial.status).toBe(200);

    const garage = await Garage.findById(owner.garageId);
    expect(garage!.address.city).toBe('Mumbai');
    expect(garage!.address.street).toBe('MG Road');
    expect(garage!.address.state).toBe('MH');
    expect(garage!.address.pincode).toBe('411001');
  });

  it('still updates top-level fields, and ignores fields outside the whitelist', async () => {
    const owner = await createGarageWithOwner('settings-toplevel');

    const res = await request(app)
      .put('/api/garage')
      .set(authHeader(owner.token))
      .send({ name: 'Renamed Garage', owner: '000000000000000000000000' });
    expect(res.status).toBe(200);

    const garage = await Garage.findById(owner.garageId);
    expect(garage!.name).toBe('Renamed Garage');
    // `owner` is not in ALLOWED_FIELDS, so it must be untouched.
    expect(String(garage!.owner)).toBe(String(owner.userId));
  });
});
