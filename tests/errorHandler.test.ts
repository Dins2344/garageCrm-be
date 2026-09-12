import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import errorHandler from '../middleware/errorHandler';

function createMockRes() {
  const res = {
    statusCode: undefined as number | undefined,
    body: undefined as Record<string, unknown> | undefined,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: Record<string, unknown>) {
      res.body = body;
      return res;
    }
  };
  return res;
}

const mockReq = { method: 'GET', originalUrl: '/api/test' } as Request;
const next = vi.fn() as unknown as NextFunction;

/** A `pg` driver error, as the driver builds it. */
const pgError = (code: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error('db failed'), { name: 'error', code, ...extra });

/** The same error after Drizzle has wrapped it — what actually reaches the handler. */
const drizzleWrapped = (cause: Error) =>
  Object.assign(new Error('Failed query: insert into ...'), { name: 'DrizzleQueryError', cause });

describe('errorHandler middleware', () => {
  it('maps a unique violation to 400 naming the offending field', () => {
    const res = createMockRes();
    const err = drizzleWrapped(pgError('23505', {
      constraint: 'customers_garage_phone_unique',
      detail: 'Key (garage_id, phone)=(abc, 9999999999) already exists.'
    }));

    errorHandler(err, mockReq, res as unknown as Response, next);

    expect(res.statusCode).toBe(400);
    expect(res.body?.success).toBe(false);
    expect(res.body?.message).toBe("Duplicate value entered for 'phone'. This value already exists.");
  });

  it('reports the column in camelCase, the way the API names fields', () => {
    const res = createMockRes();
    const err = pgError('23505', { detail: 'Key (garage_id, license_plate)=(abc, KA01) already exists.' });

    errorHandler(err, mockReq, res as unknown as Response, next);

    expect(res.body?.message).toContain("'licensePlate'");
  });

  it('maps a foreign key restriction to 409', () => {
    const res = createMockRes();
    const err = drizzleWrapped(pgError('23001', { constraint: 'vehicles_customer_id_customers_id_fk' }));

    errorHandler(err, mockReq, res as unknown as Response, next);

    expect(res.statusCode).toBe(409);
    expect(res.body?.success).toBe(false);
  });

  it('never leaks SQL from an unexpected database error', () => {
    const res = createMockRes();
    const err = drizzleWrapped(pgError('42P01', { message: 'relation "nope" does not exist' }));

    errorHandler(err, mockReq, res as unknown as Response, next);

    expect(res.statusCode).toBe(500);
    expect(res.body?.message).toBe('Server Error');
  });

  it("falls back to the error's statusCode, or 500 if none is set", () => {
    const res = createMockRes();
    const err = Object.assign(new Error('Custom'), { statusCode: 403 });
    errorHandler(err, mockReq, res as unknown as Response, next);
    expect(res.statusCode).toBe(403);

    const res2 = createMockRes();
    const plainErr = new Error('Boom');
    errorHandler(plainErr, mockReq, res2 as unknown as Response, next);
    expect(res2.statusCode).toBe(500);
    expect(res2.body?.message).toBe('Boom');
  });
});
