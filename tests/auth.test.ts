import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../app';
import Garage from '../models/Garage';
import User from '../models/User';
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

  it('leaves no orphaned, ownerless garage behind when user creation fails validation', async () => {
    const garageName = 'Orphan Check Garage';
    const res = await request(app).post('/api/auth/register').send({
      name: 'Bad Password Owner',
      email: 'badpassword@example.com',
      phone: nextPhone(),
      password: 'short', // below the 6-char minimum -> User.create() throws
      garageName,
      garagePhone: nextPhone()
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);

    const orphanedGarage = await Garage.findOne({ name: garageName });
    expect(orphanedGarage).toBeNull();
  });

  it('leaves no orphaned garage when two concurrent signups race on the same email', async () => {
    const email = 'race@example.com';
    const attempt = (garageName: string) => request(app).post('/api/auth/register').send({
      name: 'Racer',
      email,
      phone: nextPhone(),
      password: 'password123',
      garageName,
      garagePhone: nextPhone()
    });

    const [first, second] = await Promise.all([attempt('Race Garage A'), attempt('Race Garage B')]);
    const statuses = [first.status, second.status].sort();

    // Exactly one of the two concurrent requests should succeed; the other
    // loses the race on the unique email index and gets a clean error.
    expect(statuses).toEqual([201, 400]);

    const users = await User.find({ email });
    expect(users).toHaveLength(1);

    const garages = await Garage.find({ name: { $in: ['Race Garage A', 'Race Garage B'] } });
    expect(garages).toHaveLength(1);
    expect(garages[0].owner).toBeTruthy();
    expect(String(garages[0].owner)).toBe(String(users[0]._id));
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
