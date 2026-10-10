import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, schema, countRows } from './helpers/dbAccess';
import { createGarageWithOwner } from './helpers/factories';
import type * as PushModule from '../services/pushService';

// tests/setup.ts mocks this module for every file; this one tests the real thing.
let sendPush: typeof PushModule.sendPush;
beforeAll(async () => {
  ({ sendPush } = await vi.importActual<typeof PushModule>('../services/pushService'));
});

type Message = { to: string; title: string; body: string; data: Record<string, string>; channelId: string; sound: string };
const fetchMock = vi.fn();
/** Expo answers one ticket per message, in order. */
const answerWith = (ticketFor: (m: Message, i: number) => object = () => ({ status: 'ok', id: 'ticket' })) =>
  fetchMock.mockImplementation(async (_url: string, init: { body: string }) => {
    const messages = JSON.parse(init.body) as Message[];
    return new Response(JSON.stringify({ data: messages.map(ticketFor) }), { status: 200 });
  });
const sentBatches = () => fetchMock.mock.calls.map(([, init]) => JSON.parse((init as { body: string }).body) as Message[]);

const addTokens = (userId: string, tokens: string[]) =>
  db.insert(schema.pushTokens).values(tokens.map(token => ({ userId, token })));

describe('sendPush', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.EXPO_ACCESS_TOKEN;
  });

  it("sends each recipient's own message to every device they have, and nobody else's", async () => {
    const a = await createGarageWithOwner('push-a');
    const b = await createGarageWithOwner('push-b');
    await addTokens(a.userId, ['ExponentPushToken[a1]', 'ExponentPushToken[a2]']);
    await addTokens(b.userId, ['ExponentPushToken[b1]']);
    answerWith();

    await sendPush([{ userId: a.userId, title: 'Cancellation requested', body: 'Ravi asked', data: { notificationId: 'n1' } }]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://exp.host/--/api/v2/push/send');
    const [batch] = sentBatches();
    expect(batch.map(m => m.to).sort()).toEqual(['ExponentPushToken[a1]', 'ExponentPushToken[a2]']);
    expect(batch[0]).toMatchObject({ title: 'Cancellation requested', body: 'Ravi asked', data: { notificationId: 'n1' }, channelId: 'requests', sound: 'default' });
  });

  it('sends the access token only when one is configured', async () => {
    const a = await createGarageWithOwner('push-auth');
    await addTokens(a.userId, ['ExponentPushToken[x]']);
    answerWith();
    const delivery = [{ userId: a.userId, title: 't', body: 'b', data: {} }];

    await sendPush(delivery);
    process.env.EXPO_ACCESS_TOKEN = 'secret';
    await sendPush(delivery);

    const headers = fetchMock.mock.calls.map(([, init]) => (init as { headers: Record<string, string> }).headers);
    expect(headers[0].Authorization).toBeUndefined();
    expect(headers[1].Authorization).toBe('Bearer secret');
  });

  it('batches 100 messages per request', async () => {
    const a = await createGarageWithOwner('push-batch');
    await addTokens(a.userId, Array.from({ length: 150 }, (_, i) => `ExponentPushToken[t${i}]`));
    answerWith();

    await sendPush([{ userId: a.userId, title: 't', body: 'b', data: {} }]);

    expect(sentBatches().map(b => b.length)).toEqual([100, 50]);
  });

  it('forgets a device Expo says is no longer registered', async () => {
    const a = await createGarageWithOwner('push-prune');
    await addTokens(a.userId, ['ExponentPushToken[live]', 'ExponentPushToken[gone]']);
    answerWith(m => (m.to === 'ExponentPushToken[gone]'
      ? { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } }
      : { status: 'ok', id: 'ticket' }));

    await sendPush([{ userId: a.userId, title: 't', body: 'b', data: {} }]);

    expect(await countRows(schema.pushTokens, eq(schema.pushTokens.token, 'ExponentPushToken[gone]'))).toBe(0);
    expect(await countRows(schema.pushTokens, eq(schema.pushTokens.token, 'ExponentPushToken[live]'))).toBe(1);
  });

  it('keeps a token whose ticket failed for a reason other than DeviceNotRegistered', async () => {
    const a = await createGarageWithOwner('push-creds');
    await addTokens(a.userId, ['ExponentPushToken[kept]']);
    answerWith(() => ({ status: 'error', message: 'bad creds', details: { error: 'InvalidCredentials' } }));

    await sendPush([{ userId: a.userId, title: 't', body: 'b', data: {} }]);

    expect(await countRows(schema.pushTokens, eq(schema.pushTokens.token, 'ExponentPushToken[kept]'))).toBe(1);
  });

  it('never throws when Expo is unreachable', async () => {
    const a = await createGarageWithOwner('push-down');
    await addTokens(a.userId, ['ExponentPushToken[x]']);
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));

    await expect(sendPush([{ userId: a.userId, title: 't', body: 'b', data: {} }])).resolves.toBeUndefined();
  });

  it('does not call Expo for a user with no devices', async () => {
    const a = await createGarageWithOwner('push-none');
    await sendPush([{ userId: a.userId, title: 't', body: 'b', data: {} }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
