import request from 'supertest';
import app from '../../app';

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
