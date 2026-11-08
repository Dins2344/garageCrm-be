import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import app from '../../app';
import { authHeader } from '../../tests/helpers/factories';
import { mgDb } from '../config/db';
import { cloudFiles } from '../config/schema';
import { useMyGarageDb } from './harness';
import * as r2 from '../services/r2';

vi.mock('../services/google', () => ({
  verifyGoogleIdToken: vi.fn(async (idToken: string) =>
    idToken === 'other' ? { sub: 'g-2', email: 'b@example.com' } : { sub: 'g-1', email: 'a@example.com' })
}));
vi.mock('../services/r2', () => ({
  objectKey: (userId: string, fileId: string) => `u/${userId}/${fileId}`,
  presignPut: vi.fn(async (key: string) => 'https://r2.test/' + key),
  presignGet: vi.fn(async (key: string) => 'https://r2.test/' + key),
  headObjectSize: vi.fn(async () => null),
  deleteObject: vi.fn(async () => undefined)
}));

useMyGarageDb();

const MB = 1024 * 1024;
const F1 = '0190a1b2-c3d4-7e5f-8a6b-1234567890ab';
const F2 = '0190a1b2-c3d4-7e5f-8a6b-1234567890ac';
const sign = async (idToken = 'good') =>
  (await request(app).post('/api/mygarage/auth/google').send({ idToken })).body.data;
const upload = (t: string, fileId: string, size: number) =>
  request(app).post(`/api/mygarage/files/${fileId}/upload-url`).set(authHeader(t)).send({ size });
const complete = (t: string, fileId: string) =>
  request(app).post(`/api/mygarage/files/${fileId}/complete`).set(authHeader(t));
const download = (t: string, fileId: string) =>
  request(app).get(`/api/mygarage/files/${fileId}/download-url`).set(authHeader(t));
const row = async (userId: string, fileId: string) =>
  (await mgDb.select().from(cloudFiles).where(and(eq(cloudFiles.userId, userId), eq(cloudFiles.fileId, fileId))))[0];

beforeEach(() => {
  vi.mocked(r2.headObjectSize).mockReset().mockResolvedValue(null);
  vi.mocked(r2.deleteObject).mockReset().mockResolvedValue(undefined);
});

describe('MyGarage files', () => {
  it("upload-url returns a signed URL for the user's own key", async () => {
    const s = await sign();
    const res = await upload(s.accessToken, F1, 1000 + 28);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.url.endsWith(`u/${s.user.id}/${F1}`)).toBe(true);
    expect(Number.isNaN(Date.parse(res.body.data.expiresAt))).toBe(false);
    expect((await row(s.user.id, F1)).status).toBe('pending');
  });

  it('rejects a fileId that is not a UUID', async () => {
    const s = await sign();
    const res = await upload(s.accessToken, 'not-a-uuid', 100);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, message: 'That file reference is not valid.' });
  });

  it('rejects a missing size with 400', async () => {
    const s = await sign();
    const res = await request(app).post(`/api/mygarage/files/${F1}/upload-url`).set(authHeader(s.accessToken)).send({});
    expect(res.status).toBe(400);
  });

  it('rejects a file over 25 MB', async () => {
    const s = await sign();
    const res = await upload(s.accessToken, F1, 25 * MB + 1);
    expect(res.status).toBe(413);
    expect(res.body.message).toBe('This file is too large to back up (25 MB limit).');
  });

  it('rejects when the total would pass 1 GB, without double counting a re-request', async () => {
    const s = await sign();
    // 40 files of 25 MB = 1000 MB stored.
    const seeded = Array.from({ length: 40 }, (_, i) => ({
      userId: s.user.id,
      fileId: `0190a1b2-c3d4-7e5f-8a6b-1000000000${String(i).padStart(2, '0')}`,
      size: 25 * MB,
      status: 'uploaded' as const
    }));
    await mgDb.insert(cloudFiles).values(seeded);
    const over = await upload(s.accessToken, F1, 25 * MB);
    expect(over.status).toBe(413);
    expect(over.body.message).toBe('Your cloud storage is full (1 GB). This file stays on your phone.');
    // Re-requesting a stored id replaces its old size, so 25 MB again fits.
    expect((await upload(s.accessToken, seeded[0].fileId, 25 * MB)).status).toBe(200);
  });

  it('complete with no object returns 409', async () => {
    const s = await sign();
    await upload(s.accessToken, F1, 100);
    const res = await complete(s.accessToken, F1);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('The upload did not finish. Try again.');
  });

  it('complete records the real size from HEAD and marks the row uploaded', async () => {
    const s = await sign();
    await upload(s.accessToken, F1, 100);
    vi.mocked(r2.headObjectSize).mockResolvedValue(128);
    const res = await complete(s.accessToken, F1);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { size: 128 } });
    const r = await row(s.user.id, F1);
    expect(r.status).toBe('uploaded');
    expect(r.size).toBe(128);
    expect(r.uploadedAt).not.toBeNull();
  });

  it('complete deletes the object and returns 413 when HEAD reports over 25 MB', async () => {
    const s = await sign();
    await upload(s.accessToken, F1, 100);
    vi.mocked(r2.headObjectSize).mockResolvedValue(25 * MB + 1);
    const res = await complete(s.accessToken, F1);
    expect(res.status).toBe(413);
    expect(r2.deleteObject).toHaveBeenCalledWith(`u/${s.user.id}/${F1}`);
  });

  it('complete for a file never requested returns 404', async () => {
    const s = await sign();
    expect((await complete(s.accessToken, F1)).status).toBe(404);
  });

  it('download-url is 404 before complete and 200 after', async () => {
    const s = await sign();
    await upload(s.accessToken, F1, 100);
    const before = await download(s.accessToken, F1);
    expect(before.status).toBe(404);
    expect(before.body.message).toBe('This file is not in the cloud yet.');
    vi.mocked(r2.headObjectSize).mockResolvedValue(128);
    await complete(s.accessToken, F1);
    const after = await download(s.accessToken, F1);
    expect(after.status).toBe(200);
    expect(after.body.data.url.endsWith(`u/${s.user.id}/${F1}`)).toBe(true);
    expect(Number.isNaN(Date.parse(after.body.data.expiresAt))).toBe(false);
  });

  it('another user cannot get a download URL for my file', async () => {
    const a = await sign();
    const b = await sign('other');
    await upload(a.accessToken, F1, 100);
    vi.mocked(r2.headObjectSize).mockResolvedValue(128);
    await complete(a.accessToken, F1);
    expect((await download(b.accessToken, F1)).status).toBe(404);
  });

  it('maps an R2 failure to 502', async () => {
    const s = await sign();
    await upload(s.accessToken, F1, 100);
    vi.mocked(r2.headObjectSize).mockRejectedValue(new Error('boom'));
    const res = await complete(s.accessToken, F1);
    expect(res.status).toBe(502);
    expect(res.body.message).toBe('File storage is unavailable right now. Try again later.');
  });

  const pushFile = (t: string, id: string, updatedAt: number, deletedAt: number | null) =>
    request(app).post('/api/mygarage/sync/push').set(authHeader(t))
      .send({ changes: [{ tbl: 'files', id, updatedAt, deletedAt, payload: 'QUJD' }] });

  it('pushing a soft-deleted files row removes the cloud copy', async () => {
    const s = await sign();
    await upload(s.accessToken, F1, 100);
    await pushFile(s.accessToken, F1, 10, null);
    expect(r2.deleteObject).not.toHaveBeenCalled();
    const res = await pushFile(s.accessToken, F1, 11, 11);
    expect(res.status).toBe(200);
    expect(r2.deleteObject).toHaveBeenCalledWith(`u/${s.user.id}/${F1}`);
    expect(await row(s.user.id, F1)).toBeUndefined();
  });

  it('a stale delete from an old phone leaves the cloud file alone', async () => {
    const s = await sign();
    await upload(s.accessToken, F1, 100);
    await pushFile(s.accessToken, F1, 20, null);
    const res = await pushFile(s.accessToken, F1, 10, 10);
    expect(res.body.data).toEqual({ accepted: 0, skipped: 1 });
    expect(r2.deleteObject).not.toHaveBeenCalled();
    expect(await row(s.user.id, F1)).toBeDefined();
  });

  it('a leftover row for a deleted file stops counting toward the quota', async () => {
    const s = await sign();
    await mgDb.insert(cloudFiles).values({ userId: s.user.id, fileId: F2, size: 1024 * MB, status: 'uploaded' });
    expect((await upload(s.accessToken, F1, 100)).status).toBe(413);
    vi.mocked(r2.deleteObject).mockRejectedValueOnce(new Error('boom'));
    await pushFile(s.accessToken, F2, 11, 11); // delete fails, row stays
    expect(await row(s.user.id, F2)).toBeDefined();
    expect((await upload(s.accessToken, F1, 100)).status).toBe(200);
    expect(r2.deleteObject).toHaveBeenLastCalledWith(`u/${s.user.id}/${F2}`);
    expect(await row(s.user.id, F2)).toBeUndefined();
  });

  it('a pushed files id that is not a UUID never reaches R2', async () => {
    const a = await sign();
    const b = await sign('other');
    const res = await pushFile(a.accessToken, `../${b.user.id}/${F1}`, 11, 11);
    expect(res.status).toBe(200);
    expect(res.body.data.accepted).toBe(1);
    expect(r2.deleteObject).not.toHaveBeenCalled();
  });

  it('complete deletes the object and the row when the total would pass 1 GB', async () => {
    const s = await sign();
    const seeded = Array.from({ length: 40 }, (_, i) => ({
      userId: s.user.id,
      fileId: `0190a1b2-c3d4-7e5f-8a6b-1000000000${String(i).padStart(2, '0')}`,
      size: 25 * MB,
      status: 'uploaded' as const
    }));
    await mgDb.insert(cloudFiles).values(seeded);
    expect((await upload(s.accessToken, F1, 100)).status).toBe(200);
    vi.mocked(r2.headObjectSize).mockResolvedValue(25 * MB);
    const res = await complete(s.accessToken, F1);
    expect(res.status).toBe(413);
    expect(res.body.message).toBe('Your cloud storage is full (1 GB). This file stays on your phone.');
    expect(r2.deleteObject).toHaveBeenCalledWith(`u/${s.user.id}/${F1}`);
    expect(await row(s.user.id, F1)).toBeUndefined();
  });

  it('upload-url signs the declared size into the PUT', async () => {
    const s = await sign();
    await upload(s.accessToken, F1, 4321);
    expect(r2.presignPut).toHaveBeenCalledWith(`u/${s.user.id}/${F1}`, 900, 4321);
  });

  it('if R2 delete fails during push, the push still succeeds and the row stays', async () => {
    const s = await sign();
    await upload(s.accessToken, F2, 100);
    vi.mocked(r2.deleteObject).mockRejectedValue(new Error('boom'));
    const res = await pushFile(s.accessToken, F2, 11, 11);
    expect(res.status).toBe(200);
    expect(res.body.data.accepted).toBe(1);
    expect(await row(s.user.id, F2)).toBeDefined();
  });
});
