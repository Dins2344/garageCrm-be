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

describe('errorHandler middleware', () => {
  it('maps CastError to 404', () => {
    const res = createMockRes();
    const err = Object.assign(new Error('Cast failed'), { name: 'CastError', path: '_id', value: 'bad-id' });

    errorHandler(err, mockReq, res as unknown as Response, next);

    expect(res.statusCode).toBe(404);
    expect(res.body?.success).toBe(false);
    expect(res.body?.message).toBe('Resource not found');
  });

  it('maps duplicate key errors (code 11000) to 400 with a friendly message', () => {
    const res = createMockRes();
    const err = Object.assign(new Error('E11000 duplicate key'), { code: 11000, keyValue: { phone: '9999999999' } });

    errorHandler(err, mockReq, res as unknown as Response, next);

    expect(res.statusCode).toBe(400);
    expect(res.body?.message).toContain("'phone'");
  });

  it('maps Mongoose ValidationError to 400 with joined field messages', () => {
    const res = createMockRes();
    const err = Object.assign(new Error('Validation failed'), {
      name: 'ValidationError',
      errors: {
        name: { message: 'Name is required' },
        phone: { message: 'Phone is required' }
      }
    });

    errorHandler(err, mockReq, res as unknown as Response, next);

    expect(res.statusCode).toBe(400);
    expect(res.body?.message).toBe('Name is required. Phone is required');
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
