import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setMyGarageEnv } from '../config/env';
import { TEST_ENV } from './harness';
import { objectKey, presignPut, presignGet } from '../services/r2';
import { newId } from '../../utils/ids';

const FILE = '0190a1b2-c3d4-7e5f-8a6b-1234567890ab';

beforeAll(() => setMyGarageEnv(TEST_ENV));
afterAll(() => setMyGarageEnv(null));

describe('r2 service', () => {
  it('objectKey builds u/<user>/<file> and refuses anything that could escape it', () => {
    const user = newId();
    expect(objectKey(user, FILE)).toBe(`u/${user}/${FILE}`);
    expect(() => objectKey(user, '../x')).toThrow();
    expect(() => objectKey(user, `../${newId()}/${FILE}`)).toThrow();
    expect(() => objectKey(user, '../..')).toThrow();
    expect(() => objectKey('../x', FILE)).toThrow();
    expect(() => objectKey('not-hex', FILE)).toThrow();
  });

  it('presignPut signs host and content-length, and a 900 second expiry', async () => {
    const url = new URL(await presignPut(objectKey(newId(), FILE), 900, 1234));
    expect(url.searchParams.get('X-Amz-SignedHeaders')?.split(';')).toEqual(['content-length', 'host']);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
  });

  it('presignGet signs host only', async () => {
    const url = new URL(await presignGet(objectKey(newId(), FILE), 900));
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
  });
});
