import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import app from '../app';
import * as emailService from '../services/emailService';
import { registerGarageOwner, authHeader, nextPhone } from './helpers/factories';

const sendPasswordResetEmail = emailService.sendPasswordResetEmail as unknown as ReturnType<typeof vi.fn>;

afterEach(() => {
  sendPasswordResetEmail.mockClear();
});

/** Extracts the raw reset token from the resetUrl passed to the (mocked) email send call. */
function tokenFromLastEmail(): string {
  const lastCall = sendPasswordResetEmail.mock.calls.at(-1) as [{ resetUrl: string }];
  const resetUrl = lastCall[0].resetUrl;
  return resetUrl.split('/').pop() as string;
}

describe('Forgot / Reset password', () => {
  it('sends a generic message for an owner and actually emails a reset link', async () => {
    await registerGarageOwner({ email: 'resetowner1@example.com' });

    const res = await request(app).post('/api/auth/forgotpassword').send({ email: 'resetowner1@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/if an account exists/i);
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1);
  });

  it('returns the same generic message for an unknown email (no enumeration)', async () => {
    const res = await request(app).post('/api/auth/forgotpassword').send({ email: 'nobody@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/if an account exists/i);
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('tells a staff member to ask their owner, and does not email them a token', async () => {
    const owner = await registerGarageOwner({ email: 'staffowner1@example.com' });
    const ownerToken = owner.body.token as string;

    await request(app)
      .post('/api/users')
      .set(authHeader(ownerToken))
      .send({
        name: 'Test Mechanic',
        email: 'staffmember1@example.com',
        phone: nextPhone(),
        password: 'password123',
        role: 'mechanic'
      });

    const res = await request(app).post('/api/auth/forgotpassword').send({ email: 'staffmember1@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/owner or an admin/i);
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('resets the password with a valid token and allows login with the new password', async () => {
    await registerGarageOwner({ email: 'resetowner2@example.com', password: 'old-password' });
    await request(app).post('/api/auth/forgotpassword').send({ email: 'resetowner2@example.com' });

    const token = tokenFromLastEmail();

    const resetRes = await request(app)
      .put(`/api/auth/resetpassword/${token}`)
      .send({ password: 'new-password-123' });

    expect(resetRes.status).toBe(200);
    expect(resetRes.body.success).toBe(true);

    const loginOld = await request(app).post('/api/auth/login').send({
      email: 'resetowner2@example.com',
      password: 'old-password'
    });
    expect(loginOld.status).toBe(401);

    const loginNew = await request(app).post('/api/auth/login').send({
      email: 'resetowner2@example.com',
      password: 'new-password-123'
    });
    expect(loginNew.status).toBe(200);
    expect(loginNew.body.token).toBeTruthy();
  });

  it('rejects an invalid or already-used token', async () => {
    const res = await request(app)
      .put('/api/auth/resetpassword/not-a-real-token')
      .send({ password: 'whatever-123' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('rejects reusing a token after it has already been consumed', async () => {
    await registerGarageOwner({ email: 'resetowner3@example.com', password: 'old-password' });
    await request(app).post('/api/auth/forgotpassword').send({ email: 'resetowner3@example.com' });
    const token = tokenFromLastEmail();

    const first = await request(app).put(`/api/auth/resetpassword/${token}`).send({ password: 'new-password-123' });
    expect(first.status).toBe(200);

    const second = await request(app).put(`/api/auth/resetpassword/${token}`).send({ password: 'another-password' });
    expect(second.status).toBe(400);
  });
});
