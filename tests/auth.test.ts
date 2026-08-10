import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../app';
import { registerGarageOwner, nextPhone, authHeader } from './helpers/factories';

describe('Auth', () => {
  it('registers a new garage owner and returns a token + user', async () => {
    const res = await registerGarageOwner({ email: 'owner1@example.com' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.token).toBeTruthy();
    expect(res.body.data.role).toBe('owner');
    expect(res.body.data.garage).toBeTruthy();
  });

  it('rejects registration with an already-used email', async () => {
    await registerGarageOwner({ email: 'dupe@example.com' });
    const res = await registerGarageOwner({ email: 'dupe@example.com' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('logs in with correct credentials', async () => {
    await registerGarageOwner({ email: 'login1@example.com', password: 'correct-password' });

    const res = await request(app).post('/api/auth/login').send({
      email: 'login1@example.com',
      password: 'correct-password'
    });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });

  it('rejects login with the wrong password', async () => {
    await registerGarageOwner({ email: 'login2@example.com', password: 'correct-password' });

    const res = await request(app).post('/api/auth/login').send({
      email: 'login2@example.com',
      password: 'wrong-password'
    });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('rejects /auth/me with no token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns the current user for a valid token', async () => {
    const register = await registerGarageOwner({ email: 'me1@example.com' });
    const token = register.body.token as string;

    const res = await request(app).get('/api/auth/me').set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('me1@example.com');
  });

  it('denies a mechanic from deleting a customer (role-gated route)', async () => {
    const owner = await registerGarageOwner({ email: 'roleowner@example.com' });
    const ownerToken = owner.body.token as string;

    // Owner creates a mechanic on their garage
    const mechanicPhone = nextPhone();
    const createStaff = await request(app)
      .post('/api/users')
      .set(authHeader(ownerToken))
      .send({
        name: 'Test Mechanic',
        email: 'mechanic1@example.com',
        phone: mechanicPhone,
        password: 'password123',
        role: 'mechanic'
      });
    expect(createStaff.status).toBe(201);

    const mechanicLogin = await request(app).post('/api/auth/login').send({
      email: 'mechanic1@example.com',
      password: 'password123'
    });
    const mechanicToken = mechanicLogin.body.token as string;

    const customer = await request(app)
      .post('/api/customers')
      .set(authHeader(ownerToken))
      .send({ name: 'Some Customer', phone: nextPhone() });
    expect(customer.status).toBe(201);

    const deleteAttempt = await request(app)
      .delete(`/api/customers/${customer.body.data._id}`)
      .set(authHeader(mechanicToken));

    expect(deleteAttempt.status).toBe(403);
  });
});
