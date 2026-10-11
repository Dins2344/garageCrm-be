import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import type { AddressInfo } from 'net';
import { eq } from 'drizzle-orm';
import app from '../app';
import { createGarageWithOwner, addGarageToOwner, authHeader, authHeaderFor } from './helpers/factories';
import { db, schema, countRows } from './helpers/dbAccess';
import * as notificationUsecase from '../usecases/notificationUsecase';
import { sendPush } from '../services/pushService';

const ENTITY = 'c'.repeat(24);
const seed = (userId: string, garageId: string, title = 'Cancellation requested') =>
  notificationUsecase.notifyUsers({
    userIds: [userId], garageId, type: 'request_raised', title, body: 'Ravi asked to cancel JC-1: no',
    entityType: 'change_request', entityId: ENTITY
  });
const get = (token: string, path: string) => request(app).get(path).set(authHeader(token));
const put = (token: string, path: string) => request(app).put(path).set(authHeader(token)).send({});
const readUntil = async (reader: ReadableStreamDefaultReader<Uint8Array>, needle: string): Promise<string> => {
  const decoder = new TextDecoder();
  let text = '';
  while (!text.includes(needle)) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
};

describe('notifications', () => {
  beforeEach(() => vi.mocked(sendPush).mockClear());

  it("lists only the caller's notifications, newest first, in the API's field names", async () => {
    const a = await createGarageWithOwner('ntf-list-a');
    const b = await createGarageWithOwner('ntf-list-b');
    await seed(a.userId, a.garageId, 'first');
    await seed(a.userId, a.garageId, 'second');
    await seed(b.userId, b.garageId, 'not yours');

    const res = await get(a.token, '/api/notifications');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, total: 2, count: 2, currentPage: 1 });
    expect(res.body.data.map((n: { title: string }) => n.title)).toEqual(['second', 'first']);
    expect(res.body.data[0]).toMatchObject({ entityType: 'change_request', entity: ENTITY, garage: a.garageId, user: a.userId, readAt: null });
    expect(res.body.data[0].entityId).toBeUndefined();
  });

  it('counts unread and marks one read', async () => {
    const a = await createGarageWithOwner('ntf-read');
    await seed(a.userId, a.garageId);
    await seed(a.userId, a.garageId);
    expect((await get(a.token, '/api/notifications/unread-count')).body.data.count).toBe(2);

    const id = (await get(a.token, '/api/notifications')).body.data[0]._id;
    const res = await put(a.token, `/api/notifications/${id}/read`);

    expect(res.status).toBe(200);
    expect(res.body.data.readAt).not.toBeNull();
    expect((await get(a.token, '/api/notifications/unread-count')).body.data.count).toBe(1);
  });

  it("cannot mark someone else's notification", async () => {
    const a = await createGarageWithOwner('ntf-other-a');
    const b = await createGarageWithOwner('ntf-other-b');
    await seed(a.userId, a.garageId);
    const id = (await get(a.token, '/api/notifications')).body.data[0]._id;

    expect((await put(b.token, `/api/notifications/${id}/read`)).status).toBe(404);
    expect((await put(b.token, '/api/notifications/not-an-id/read')).status).toBe(404);
    expect((await get(a.token, '/api/notifications/unread-count')).body.data.count).toBe(1);
  });

  it('marks everything read', async () => {
    const a = await createGarageWithOwner('ntf-all');
    await seed(a.userId, a.garageId);
    await seed(a.userId, a.garageId);

    const res = await put(a.token, '/api/notifications/read-all');

    expect(res.body.data.updated).toBe(2);
    expect((await get(a.token, '/api/notifications/unread-count')).body.data.count).toBe(0);
  });

  it('shows an owner notifications from every branch, whichever one is active', async () => {
    const a = await createGarageWithOwner('ntf-branch');
    const branchId = (await addGarageToOwner(a.token, 'Second Branch')).body.data._id;
    await seed(a.userId, a.garageId, 'home');
    await seed(a.userId, branchId, 'branch');

    const res = await request(app).get('/api/notifications').set(authHeaderFor(a.token, a.garageId));

    expect(res.body.data.map((n: { garage: string }) => n.garage).sort()).toEqual([a.garageId, branchId].sort());
  });

  it('stores one row per distinct recipient and pushes each their own notification id', async () => {
    const a = await createGarageWithOwner('ntf-push');
    await notificationUsecase.notifyUsers({
      userIds: [a.userId, a.userId], garageId: a.garageId, type: 'request_raised',
      title: 'T', body: 'B', entityType: 'change_request', entityId: ENTITY
    });

    expect(await countRows(schema.notifications, eq(schema.notifications.userId, a.userId))).toBe(1);
    const [row] = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, a.userId));
    expect(vi.mocked(sendPush)).toHaveBeenCalledWith([{
      userId: a.userId, title: 'T', body: 'B',
      data: { notificationId: row._id, type: 'request_raised', entityType: 'change_request', entityId: ENTITY, garageId: a.garageId }
    }]);
  });

  it('marks every pending alert about an entity read', async () => {
    const a = await createGarageWithOwner('ntf-entity');
    await seed(a.userId, a.garageId);

    await notificationUsecase.markEntityRead({ entityType: 'change_request', entityId: ENTITY, type: 'request_raised' });

    expect((await get(a.token, '/api/notifications/unread-count')).body.data.count).toBe(0);
  });

  describe('push tokens', () => {
    const TOKEN = 'ExponentPushToken[abc123]';
    const register = (token: string, body: object) =>
      request(app).post('/api/notifications/push-token').set(authHeader(token)).send(body);
    const ownerOf = async () => (await db.select().from(schema.pushTokens).where(eq(schema.pushTokens.token, TOKEN)))[0]?.userId;

    it('registers a device, and hands a shared phone to whoever signs in next', async () => {
      const a = await createGarageWithOwner('ntf-tok-a');
      const b = await createGarageWithOwner('ntf-tok-b');

      expect((await register(a.token, { token: TOKEN, platform: 'android' })).status).toBe(200);
      expect(await ownerOf()).toBe(a.userId);

      await register(b.token, { token: TOKEN, platform: 'android' });
      expect(await ownerOf()).toBe(b.userId);
      expect(await countRows(schema.pushTokens)).toBe(1);
    });

    it('refuses something that is not an Expo token', async () => {
      const a = await createGarageWithOwner('ntf-tok-bad');
      const res = await register(a.token, { token: 'hello', platform: 'android' });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Push token is not a valid Expo push token');
    });

    it("removes only the caller's own device", async () => {
      const a = await createGarageWithOwner('ntf-tok-del-a');
      const b = await createGarageWithOwner('ntf-tok-del-b');
      await register(a.token, { token: TOKEN });
      const remove = (token: string) =>
        request(app).delete('/api/notifications/push-token').set(authHeader(token)).send({ token: TOKEN });

      expect((await remove(b.token)).status).toBe(200);
      expect(await ownerOf()).toBe(a.userId);
      await remove(a.token);
      expect(await ownerOf()).toBeUndefined();
    });
  });

  describe('watchNotifications', () => {
    it('tells each recipient once, and nobody else', async () => {
      const a = await createGarageWithOwner('ntf-watch-a');
      const b = await createGarageWithOwner('ntf-watch-b');
      const heardA = vi.fn();
      const heardB = vi.fn();
      const stopA = notificationUsecase.watchNotifications(a.userId, heardA);
      const stopB = notificationUsecase.watchNotifications(b.userId, heardB);
      try {
        await notificationUsecase.notifyUsers({
          userIds: [a.userId, a.userId], garageId: a.garageId, type: 'request_raised',
          title: 'T', body: 'B', entityType: 'change_request', entityId: ENTITY
        });
        expect(heardA).toHaveBeenCalledTimes(1);
        expect(heardB).not.toHaveBeenCalled();
      } finally {
        stopA();
        stopB();
      }
    });

    it('tells the reader when they mark one or all read, so their other tabs update', async () => {
      const a = await createGarageWithOwner('ntf-watch-read');
      await seed(a.userId, a.garageId);
      const id = (await get(a.token, '/api/notifications')).body.data[0]._id;
      const heard = vi.fn();
      const stop = notificationUsecase.watchNotifications(a.userId, heard);
      try {
        await put(a.token, `/api/notifications/${id}/read`);
        expect(heard).toHaveBeenCalledTimes(1);
        await put(a.token, '/api/notifications/read-all');
        expect(heard).toHaveBeenCalledTimes(2);
      } finally {
        stop();
      }
    });

    it('tells everyone whose alert markEntityRead cleared', async () => {
      const a = await createGarageWithOwner('ntf-watch-entity-a');
      const b = await createGarageWithOwner('ntf-watch-entity-b');
      await seed(a.userId, a.garageId);
      await seed(b.userId, b.garageId);
      const heardA = vi.fn();
      const heardB = vi.fn();
      const stopA = notificationUsecase.watchNotifications(a.userId, heardA);
      const stopB = notificationUsecase.watchNotifications(b.userId, heardB);
      try {
        await notificationUsecase.markEntityRead({ entityType: 'change_request', entityId: ENTITY, type: 'request_raised' });
        expect(heardA).toHaveBeenCalledTimes(1);
        expect(heardB).toHaveBeenCalledTimes(1);
      } finally {
        stopA();
        stopB();
      }
    });

    it('stops calling once unsubscribed', async () => {
      const a = await createGarageWithOwner('ntf-watch-stop');
      const heard = vi.fn();
      notificationUsecase.watchNotifications(a.userId, heard)();

      await seed(a.userId, a.garageId);

      expect(heard).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/notifications/stream', () => {
    // A stream never finishes, so supertest cannot read it: use a real port and fetch.
    it('streams changed to the browser, authenticated by its session cookie', async () => {
      const a = await createGarageWithOwner('ntf-stream');
      const server = app.listen(0);
      const abort = new AbortController();
      try {
        const { port } = server.address() as AddressInfo;
        const res = await fetch(`http://127.0.0.1:${port}/api/notifications/stream`, {
          headers: { Cookie: `token=${a.token}` }, signal: abort.signal
        });

        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toMatch(/^text\/event-stream/);
        expect(res.headers.get('x-accel-buffering')).toBe('no');

        const reader = res.body!.getReader();
        expect(await readUntil(reader, 'retry:')).toContain('retry: 3000');
        await put(a.token, '/api/notifications/read-all');
        expect(await readUntil(reader, 'event: changed')).toContain('event: changed');
      } finally {
        abort.abort();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
      }
    });

    it('refuses a browser with no session', async () => {
      expect((await request(app).get('/api/notifications/stream')).status).toBe(401);
    });

    it('refuses a deactivated user when their browser reconnects', async () => {
      const a = await createGarageWithOwner('ntf-stream-off');
      await db.update(schema.users).set({ isActive: false }).where(eq(schema.users._id, a.userId));

      const res = await request(app).get('/api/notifications/stream').set('Cookie', `token=${a.token}`);

      expect(res.status).toBe(403);
    });
  });

  it('requires a signed-in user', async () => {
    expect((await request(app).get('/api/notifications')).status).toBe(401);
  });
});
