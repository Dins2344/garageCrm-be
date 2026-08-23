import { describe, it, expect } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../app';
import Admin from '../models/Admin';
import {
  createSuperAdmin,
  loginAsSuperAdmin,
  adminHeader,
  ADMIN_EMAIL,
  ADMIN_PASSWORD
} from './helpers/factories';

/**
 * Admin credentials moved out of environment variables (with hardcoded
 * fallbacks) and into the `admins` collection. These cover the properties that
 * move gained us, and the ones it must not lose.
 */
describe('Admin authentication', () => {
  describe('login', () => {
    it('issues a token for a valid admin in the database', async () => {
      await createSuperAdmin();

      const res = await request(app)
        .post('/api/admin/login')
        .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.token).toBeTruthy();
      expect(res.body.data.email).toBe(ADMIN_EMAIL);
      expect(res.body.data.role).toBe('super_admin');
      // The password must never come back out, hashed or otherwise.
      expect(JSON.stringify(res.body)).not.toContain(ADMIN_PASSWORD);
    });

    it('accepts the email in any case', async () => {
      await createSuperAdmin();

      const res = await request(app)
        .post('/api/admin/login')
        .send({ email: ADMIN_EMAIL.toUpperCase(), password: ADMIN_PASSWORD });

      expect(res.status).toBe(200);
    });

    it('rejects a wrong password', async () => {
      await createSuperAdmin();

      const res = await request(app)
        .post('/api/admin/login')
        .send({ email: ADMIN_EMAIL, password: 'not-the-password' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('rejects an unknown email with the same message as a wrong password', async () => {
      await createSuperAdmin();

      const wrongPassword = await request(app)
        .post('/api/admin/login')
        .send({ email: ADMIN_EMAIL, password: 'not-the-password' });
      const unknownEmail = await request(app)
        .post('/api/admin/login')
        .send({ email: 'nobody@example.com', password: ADMIN_PASSWORD });

      // Identical responses, so the endpoint cannot be used to discover which
      // addresses are admin accounts.
      expect(unknownEmail.status).toBe(wrongPassword.status);
      expect(unknownEmail.body.message).toBe(wrongPassword.body.message);
    });

    it('rejects a deactivated admin', async () => {
      await createSuperAdmin({ isActive: false });

      const res = await request(app)
        .post('/api/admin/login')
        .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

      expect(res.status).toBe(401);
    });

    it('rejects every login when no admin exists', async () => {
      const res = await request(app)
        .post('/api/admin/login')
        .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

      expect(res.status).toBe(401);
    });

    it('stores the password hashed, not in plaintext', async () => {
      await createSuperAdmin();

      const stored = await Admin.findOne({ email: ADMIN_EMAIL }).select('+password');
      expect(stored!.password).not.toBe(ADMIN_PASSWORD);
      expect(stored!.password.startsWith('$2')).toBe(true);
    });

    it('records lastLoginAt on success', async () => {
      await createSuperAdmin();
      expect((await Admin.findOne({ email: ADMIN_EMAIL }))!.lastLoginAt).toBeUndefined();

      await request(app)
        .post('/api/admin/login')
        .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

      // The write is fire-and-forget so a failure can't fail the login; give
      // it a tick to land before asserting.
      await new Promise(resolve => setTimeout(resolve, 50));
      expect((await Admin.findOne({ email: ADMIN_EMAIL }))!.lastLoginAt).toBeInstanceOf(Date);
    });
  });

  describe('token verification', () => {
    it('accepts a valid token on a protected route', async () => {
      const token = await loginAsSuperAdmin();

      const res = await request(app).get('/api/admin/verify').set(adminHeader(token));

      expect(res.status).toBe(200);
      expect(res.body.data.email).toBe(ADMIN_EMAIL);
    });

    it('rejects a request with no token', async () => {
      const res = await request(app).get('/api/admin/stats');
      expect(res.status).toBe(401);
    });

    it('rejects a token signed with a different secret', async () => {
      await createSuperAdmin();
      const admin = await Admin.findOne({ email: ADMIN_EMAIL });
      const forged = jwt.sign(
        { isSuperAdmin: true, sub: admin!._id.toString(), email: ADMIN_EMAIL },
        'not-the-admin-secret',
        { expiresIn: '4h' }
      );

      const res = await request(app).get('/api/admin/stats').set(adminHeader(forged));

      expect(res.status).toBe(401);
    });

    it('rejects a correctly-signed token whose admin no longer exists', async () => {
      const token = await loginAsSuperAdmin();
      await Admin.deleteMany({});

      const res = await request(app).get('/api/admin/stats').set(adminHeader(token));

      expect(res.status).toBe(401);
    });

    /**
     * The property the old env-based check could not offer: with credentials in
     * a constant there was nothing to revoke, so a leaked token stayed valid
     * for its full lifetime. Now the record is re-read per request.
     */
    it('rejects a live token as soon as the admin is deactivated', async () => {
      const token = await loginAsSuperAdmin();

      const before = await request(app).get('/api/admin/stats').set(adminHeader(token));
      expect(before.status).toBe(200);

      await Admin.updateOne({ email: ADMIN_EMAIL }, { $set: { isActive: false } });

      const after = await request(app).get('/api/admin/stats').set(adminHeader(token));
      expect(after.status).toBe(401);
    });
  });
});
