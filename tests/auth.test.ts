import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import app from '../app';
import { eq, inArray } from 'drizzle-orm';
import { db, schema } from './helpers/dbAccess';
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

    const orphanedGarage = await db.query.garages.findFirst({ where: eq(schema.garages.name, garageName) });
    expect(orphanedGarage).toBeUndefined();
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

    const users = await db.query.users.findMany({ where: eq(schema.users.email, email) });
    expect(users).toHaveLength(1);

    const garages = await db.query.garages.findMany({ where: inArray(schema.garages.name, ['Race Garage A', 'Race Garage B']) });
    expect(garages).toHaveLength(1);
    expect(garages[0].ownerId).toBeTruthy();
    expect(garages[0].ownerId).toBe(users[0]._id);
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

// Sessions slide: any authenticated request made with a token older than a
// minute gets a fresh one back (cookie for web, X-Token header for mobile),
// so an active user never expires and an idle one dies with the 10m token.
describe('Sliding session', () => {
  const secret = () => process.env.JWT_SECRET as string;
  const decode = (t: string) => jwt.decode(t) as { iat: number; auth: number };

  const agedToken = async (email: string, ageSeconds: number, authAgeSeconds = ageSeconds) => {
    const register = await registerGarageOwner({ email });
    const { id, role } = jwt.decode(register.body.token) as { id: string; role: string };
    const now = Math.floor(Date.now() / 1000);
    return jwt.sign({ id, role, iat: now - ageSeconds, auth: now - authAgeSeconds }, secret(), { expiresIn: '10m' });
  };

  it('re-issues a token older than 60s, keeping the original login time', async () => {
    const old = await agedToken('slide1@example.com', 120);

    const res = await request(app).get('/api/auth/me').set(authHeader(old));

    expect(res.status).toBe(200);
    const fresh = res.headers['x-token'];
    expect(fresh).toBeTruthy();
    expect(fresh).not.toBe(old);
    expect(decode(fresh).auth).toBe(decode(old).auth);
    expect(String(res.headers['set-cookie'])).toContain(`token=${fresh}`);
  });

  it('does not re-issue a token younger than 60s', async () => {
    const register = await registerGarageOwner({ email: 'slide2@example.com' });

    const res = await request(app).get('/api/auth/me').set(authHeader(register.body.token));

    expect(res.status).toBe(200);
    expect(res.headers['x-token']).toBeUndefined();
  });

  it('stops sliding once the login is older than the absolute cap', async () => {
    const capped = await agedToken('slide3@example.com', 120, 13 * 60 * 60);

    const res = await request(app).get('/api/auth/me').set(authHeader(capped));

    expect(res.status).toBe(200);
    expect(res.headers['x-token']).toBeUndefined();
  });

  // A 304 lets the client's HTTP cache replay a stale X-Token from an old
  // response; the app stored it and every request after that 401'd.
  it('never answers 304 and forbids caching, so no stale X-Token can be replayed', async () => {
    const register = await registerGarageOwner({ email: 'slide5@example.com' });
    const first = await request(app).get('/api/auth/me').set(authHeader(register.body.token));

    expect(first.headers.etag).toBeUndefined();
    expect(first.headers['cache-control']).toBe('no-store');

    const again = await request(app)
      .get('/api/auth/me')
      .set(authHeader(register.body.token))
      // What a phone sends: the ETag its cache stored from an old response.
      .set('If-None-Match', 'W/"2a6-abc"');
    expect(again.status).toBe(200);
  });

  it('stamps the login time on tokens issued at login', async () => {
    const register = await registerGarageOwner({ email: 'slide4@example.com' });
    expect(decode(register.body.token).auth).toBeGreaterThan(0);
  });
});

