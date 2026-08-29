import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../app';
import AppRelease from '../models/AppRelease';
import { loginAsSuperAdmin, adminHeader, ADMIN_EMAIL } from './helpers/factories';

/**
 * The update gate can block every device in the field, and the people it
 * blocks are the ones who can no longer be reached with a fix. So most of
 * these tests are about the cases where it must NOT block.
 */

const seed = (over: Partial<Record<string, unknown>> = {}) =>
  AppRelease.create({
    platform: 'android',
    latestVersion: '1.1.0',
    minSupportedVersion: '',
    storeUrl: 'https://play.google.com/store/apps/details?id=com.dctechs.garagepulse',
    updateMessage: 'A new version is available.',
    blockingMessage: 'Please update to continue.',
    enabled: true,
    ...over
  });

const check = (version: string, platform = 'android') =>
  request(app).get('/api/meta/app-update').query({ platform, version });

describe('GET /api/meta/app-update', () => {
  it('needs no auth', async () => {
    const res = await check('1.0.9');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  /** The state a fresh production deploy is in. It must be inert. */
  it('a missing policy blocks nobody', async () => {
    const res = await check('1.0.9');
    expect(res.body.data.updateAvailable).toBe(false);
    expect(res.body.data.updateRequired).toBe(false);
  });

  it('offers an update when the build is behind', async () => {
    await seed();
    const res = await check('1.0.9');
    expect(res.body.data.updateAvailable).toBe(true);
    expect(res.body.data.updateRequired).toBe(false);
    expect(res.body.data.latestVersion).toBe('1.1.0');
    expect(res.body.data.message).toBe('A new version is available.');
  });

  /**
   * The string-compare regression, at the HTTP layer rather than only in the
   * comparator. '1.0.10' sorts below '1.0.9' as text.
   */
  it('treats 1.0.10 as newer than 1.0.9', async () => {
    await seed({ latestVersion: '1.0.10' });
    const behind = await check('1.0.9');
    expect(behind.body.data.updateAvailable).toBe(true);

    await AppRelease.deleteMany({});
    await seed({ latestVersion: '1.0.9' });
    const ahead = await check('1.0.10');
    expect(ahead.body.data.updateAvailable).toBe(false);
  });

  it('requires an update below the minimum, inclusive at the boundary', async () => {
    await seed({ minSupportedVersion: '1.1.0' });

    const below = await check('1.0.9');
    expect(below.body.data.updateRequired).toBe(true);
    expect(below.body.data.message).toBe('Please update to continue.');

    const atBoundary = await check('1.1.0');
    expect(atBoundary.body.data.updateRequired).toBe(false);
  });

  it('blocks nobody while the policy is disabled', async () => {
    await seed({ minSupportedVersion: '9.9.9', enabled: false });
    const res = await check('1.0.9');
    expect(res.body.data.updateRequired).toBe(false);
    expect(res.body.data.updateAvailable).toBe(false);
  });

  it.each([
    ['no version param', undefined],
    ['an empty version', ''],
    ['a garbage version', 'not-a-version'],
  ])('says nothing when given %s', async (_label, version) => {
    await seed({ minSupportedVersion: '9.9.9' });
    const res = await request(app)
      .get('/api/meta/app-update')
      .query({ platform: 'android', ...(version === undefined ? {} : { version }) });

    expect(res.status).toBe(200);
    expect(res.body.data.updateRequired).toBe(false);
    expect(res.body.data.updateAvailable).toBe(false);
  });

  it('says nothing for an unknown platform', async () => {
    await seed({ minSupportedVersion: '9.9.9' });
    const res = await check('1.0.9', 'web');
    expect(res.status).toBe(200);
    expect(res.body.data.updateRequired).toBe(false);
  });

  /** Lets the client detect a cached or misrouted response. */
  it('echoes the version it was given', async () => {
    await seed();
    const res = await check('1.0.9');
    expect(res.body.data.receivedVersion).toBe('1.0.9');
  });

  it('forbids caching, so no proxy serves one build the answer for another', async () => {
    await seed();
    const res = await check('1.0.9');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('always returns every field, so two client generations read it the same way', async () => {
    const res = await check('1.0.9');   // no policy at all
    expect(Object.keys(res.body.data).sort()).toEqual([
      'latestVersion', 'message', 'receivedVersion', 'storeUrl', 'updateAvailable', 'updateRequired'
    ]);
  });
});

describe('admin app-release endpoints', () => {
  const validBody = {
    platform: 'android',
    latestVersion: '1.1.0',
    minSupportedVersion: '',
    storeUrl: 'https://play.google.com/store/apps/details?id=com.dctechs.garagepulse',
    updateMessage: 'A new version is available.',
    blockingMessage: 'Please update to continue.',
    enabled: true
  };

  /** This surface has never had a write verb; prove adminAuth covers it. */
  it('rejects GET and PUT without an admin token', async () => {
    expect((await request(app).get('/api/admin/app-release')).status).toBe(401);
    expect((await request(app).put('/api/admin/app-release').send(validBody)).status).toBe(401);
  });

  it('creates the policy on first save and reads it back', async () => {
    const token = await loginAsSuperAdmin();

    const put = await request(app).put('/api/admin/app-release').set(adminHeader(token)).send(validBody);
    expect(put.status).toBe(200);
    expect(put.body.data.latestVersion).toBe('1.1.0');

    const get = await request(app).get('/api/admin/app-release').set(adminHeader(token)).query({ platform: 'android' });
    expect(get.status).toBe(200);
    expect(get.body.data.latestVersion).toBe('1.1.0');
  });

  it('returns null rather than 404 when no policy exists yet', async () => {
    const token = await loginAsSuperAdmin();

    const res = await request(app).get('/api/admin/app-release').set(adminHeader(token)).query({ platform: 'android' });
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  /** The unique index, not a convention, is what guarantees this. */
  it('keeps exactly one document per platform across repeated saves', async () => {
    const token = await loginAsSuperAdmin();

    await request(app).put('/api/admin/app-release').set(adminHeader(token)).send(validBody);
    await request(app).put('/api/admin/app-release').set(adminHeader(token))
      .send({ ...validBody, latestVersion: '1.2.0' });

    expect(await AppRelease.countDocuments({ platform: 'android' })).toBe(1);
  });

  /**
   * The state that blocks 100% of users instantly, including anyone already on
   * the newest build. Assert the stored document is untouched, not just the
   * status code — a 400 that still wrote would be worse than no check.
   */
  it('refuses a minimum newer than the latest version, and writes nothing', async () => {
    const token = await loginAsSuperAdmin();
    await request(app).put('/api/admin/app-release').set(adminHeader(token)).send(validBody);

    const res = await request(app).put('/api/admin/app-release').set(adminHeader(token))
      .send({ ...validBody, minSupportedVersion: '2.0.0' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/block every user/i);

    const stored = await AppRelease.findOne({ platform: 'android' }).lean();
    expect(stored?.minSupportedVersion).toBe('');
  });

  it('accepts a minimum equal to the latest version', async () => {
    const token = await loginAsSuperAdmin();

    const res = await request(app).put('/api/admin/app-release').set(adminHeader(token))
      .send({ ...validBody, minSupportedVersion: '1.1.0' });
    expect(res.status).toBe(200);
  });

  it('rejects a malformed version and a non-https store URL', async () => {
    const token = await loginAsSuperAdmin();

    const badVersion = await request(app).put('/api/admin/app-release').set(adminHeader(token))
      .send({ ...validBody, latestVersion: 'latest' });
    expect(badVersion.status).toBe(400);

    const badUrl = await request(app).put('/api/admin/app-release').set(adminHeader(token))
      .send({ ...validBody, storeUrl: 'http://play.google.com' });
    expect(badUrl.status).toBe(400);
  });

  /** Clearing the floor is the undo path for a bad policy; it must stay open. */
  it('allows the minimum to be cleared back to blank', async () => {
    const token = await loginAsSuperAdmin();

    await request(app).put('/api/admin/app-release').set(adminHeader(token))
      .send({ ...validBody, minSupportedVersion: '1.1.0' });
    const res = await request(app).put('/api/admin/app-release').set(adminHeader(token))
      .send({ ...validBody, minSupportedVersion: '' });

    expect(res.status).toBe(200);
    expect((await AppRelease.findOne({ platform: 'android' }).lean())?.minSupportedVersion).toBe('');
  });

  it('records which admin made the change', async () => {
    const token = await loginAsSuperAdmin();

    await request(app).put('/api/admin/app-release').set(adminHeader(token)).send(validBody);

    const stored = await AppRelease.findOne({ platform: 'android' }).lean();
    expect(stored?.updatedBy).toBe(ADMIN_EMAIL);
  });
});
