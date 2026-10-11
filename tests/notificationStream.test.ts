import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import type { Request, Response } from 'express';
import { streamNotifications, STREAM_PING_MS, STREAM_MAX_MS } from '../controllers/notificationController';
import * as notificationUsecase from '../usecases/notificationUsecase';

const USER = 'a'.repeat(24);
const CHANGED = 'event: changed\ndata: {}\n\n';

/** Just enough of Express's res for the stream handler. */
class FakeResponse extends EventEmitter {
  frames: string[] = [];
  headers: Record<string, string> = {};
  statusCode = 0;
  writableEnded = false;
  destroyed = false;
  status(code: number) { this.statusCode = code; return this; }
  set(fields: Record<string, string>) { Object.assign(this.headers, fields); return this; }
  flushHeaders() {}
  write(frame: string) { this.frames.push(frame); return true; }
  end() { this.writableEnded = true; this.emit('close'); return this; }
}

const openFakeStream = () => {
  const res = new FakeResponse();
  streamNotifications({ user: { _id: USER } } as unknown as Request, res as unknown as Response);
  return res;
};

// markAllRead announces to the caller even when nothing was unread, which makes
// it a convenient trigger here; USER has no rows at all.
const countMoved = () => notificationUsecase.markAllRead({ userId: USER });

afterEach(() => { vi.useRealTimers(); });

describe('streamNotifications', () => {
  it('opens an unbuffered event stream with a retry hint', () => {
    const res = openFakeStream();

    expect(res.statusCode).toBe(200);
    expect(res.headers).toMatchObject({
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'
    });
    expect(res.frames[0]).toBe('retry: 3000\n\n');
    res.end();
  });

  it('sends a bare changed event when the count moves', async () => {
    const res = openFakeStream();

    await countMoved();

    expect(res.frames).toContain(CHANGED);
    res.end();
  });

  it('pings inside the nginx read timeout, ends after five minutes, then lets go', async () => {
    vi.useFakeTimers();
    const res = openFakeStream();

    vi.advanceTimersByTime(STREAM_PING_MS);
    expect(res.frames).toContain(': ping\n\n');

    vi.advanceTimersByTime(STREAM_MAX_MS);
    expect(res.writableEnded).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    vi.useRealTimers();
    await countMoved();
    expect(res.frames).not.toContain(CHANGED);
  });

  it('lets go when the browser disconnects', async () => {
    vi.useFakeTimers();
    const res = openFakeStream();

    res.destroyed = true;
    res.emit('close');
    expect(vi.getTimerCount()).toBe(0);

    vi.useRealTimers();
    await countMoved();
    expect(res.frames).not.toContain(CHANGED);
  });
});
