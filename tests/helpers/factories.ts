import request from 'supertest';
import app from '../../app';
import Admin from '../../models/Admin';

let phoneCounter = 0;
/** Deterministic, valid-looking 10-digit Indian phone number, unique per call. */
export function nextPhone(): string {
  phoneCounter += 1;
  return `9${String(phoneCounter).padStart(9, '0')}`;
}

interface RegisterOptions {
  name?: string;
  email: string;
  phone?: string;
  password?: string;
  garageName?: string;
  garagePhone?: string;
}

/** Registers a new garage + owner via the real API and returns the response. */
export async function registerGarageOwner(opts: RegisterOptions) {
  return request(app).post('/api/auth/register').send({
    name: opts.name || 'Test Owner',
    email: opts.email,
    phone: opts.phone || nextPhone(),
    password: opts.password || 'password123',
    garageName: opts.garageName || 'Test Garage',
    garagePhone: opts.garagePhone || nextPhone()
  });
}

/** Registers a garage owner and returns { token, garageId, userId } for convenience. */
export async function createGarageWithOwner(emailSuffix: string) {
  const res = await registerGarageOwner({
    email: `owner-${emailSuffix}@example.com`,
    garageName: `Garage ${emailSuffix}`
  });
  return {
    token: res.body.token as string,
    garageId: res.body.data.garage as string,
    userId: res.body.data._id as string
  };
}

export const authHeader = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Adds an authorization header plus an active-garage override for owner requests. */
export const authHeaderFor = (token: string, garageId: string) => ({
  Authorization: `Bearer ${token}`,
  'X-Garage-Id': garageId
});

/** Creates an additional garage (branch) for an already-registered owner via the real API. */
export async function addGarageToOwner(token: string, name: string) {
  return request(app)
    .post('/api/garage/branches')
    .set(authHeader(token))
    .send({ name, phone: nextPhone() });
}

// ─── Platform super-admin ──────────────────────────────────────────────────
// The global afterEach in tests/setup.ts wipes every collection, so an admin
// has to be seeded inside the test that needs one, not once for the file.

export const ADMIN_EMAIL = 'platform-admin@example.com';
export const ADMIN_PASSWORD = 'test-admin-password-12chars';

/** Seeds an active super-admin. Password is hashed by the model's save hook. */
export async function createSuperAdmin(overrides: Partial<{ email: string; name: string; password: string; isActive: boolean }> = {}) {
  return Admin.create({
    email: overrides.email ?? ADMIN_EMAIL,
    name: overrides.name ?? 'Platform Admin',
    password: overrides.password ?? ADMIN_PASSWORD,
    isActive: overrides.isActive ?? true
  });
}

/** Seeds an admin and returns a valid bearer token for it. */
export async function loginAsSuperAdmin(): Promise<string> {
  await createSuperAdmin();
  const res = await request(app).post('/api/admin/login').send({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD
  });
  if (!res.body.token) {
    throw new Error(`Admin login failed in test setup: ${JSON.stringify(res.body)}`);
  }
  return res.body.token as string;
}

export const adminHeader = (token: string) => ({ Authorization: `Bearer ${token}` });
