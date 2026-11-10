import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { setMyGarageEnv } from '../config/env';
import { TEST_ENV } from './harness';
import { objectKey, presignPut, presignGet, headObjectSize, deleteObject } from '../services/r2';
import { newId } from '../../utils/ids';

const FILE = '0190a1b2-c3d4-7e5f-8a6b-1234567890ab';

beforeAll(() => setMyGarageEnv(TEST_ENV));
afterAll(() => setMyGarageEnv(null));

describe('r2 service', () => {
  it('objectKey builds u/ and g/ keys and rejects anything else', () => {
    const user = newId();
    const garage = '0190a1b2-c3d4-7e5f-8a6b-aaaaaaaaaaaa';
    expect(objectKey(`u:${user}`, FILE)).toBe(`u/${user}/${FILE}`);
    expect(objectKey(`g:${garage}`, FILE)).toBe(`g/${garage}/${FILE}`);
    expect(() => objectKey('g:../x', FILE)).toThrow();
    expect(() => objectKey(`u:${user}`, '../x')).toThrow();
    expect(() => objectKey(`u:${user}`, `../${newId()}/${FILE}`)).toThrow();
    expect(() => objectKey('u:../x', FILE)).toThrow();
    expect(() => objectKey('u:not-hex', FILE)).toThrow();
    expect(() => objectKey(`g:${user}`, FILE)).toThrow();
    expect(() => objectKey(user, FILE)).toThrow();
  });

  it('presignPut signs host and content-length, and a 900 second expiry', async () => {
    const url = new URL(await presignPut(objectKey(`u:${newId()}`, FILE), 900, 1234));
    expect(url.searchParams.get('X-Amz-SignedHeaders')?.split(';')).toEqual(['content-length', 'host']);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
  });

  it('presignGet signs host only', async () => {
    const url = new URL(await presignGet(objectKey(`u:${newId()}`, FILE), 900));
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
  });

  it('a hung R2 call is cut off after 10 seconds and surfaces as a failure', async () => {
    const shortTimeout = AbortSignal.timeout.bind(AbortSignal);
    // A 20 ms signal stands in for the 10 s one so the test stays fast.
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => shortTimeout(20));
    const hang = vi.fn((req: Request) => new Promise<Response>((_, reject) => {
      req.signal.addEventListener('abort', () => reject(req.signal.reason));
    }));
    vi.stubGlobal('fetch', hang);
    try {
      await expect(headObjectSize(objectKey(`u:${newId()}`, FILE))).rejects.toThrow();
      await expect(deleteObject(objectKey(`u:${newId()}`, FILE))).rejects.toThrow();
      expect(timeout).toHaveBeenCalledWith(10_000);
      expect(hang).toHaveBeenCalledTimes(2); // retries: 2 would retry a rejected fetch only on 5xx, never on abort
    } finally {
      vi.unstubAllGlobals();
      timeout.mockRestore();
    }
  });
});
