import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Types } from 'mongoose';
import Garage from '../models/Garage';
import Customer from '../models/Customer';
import Vehicle from '../models/Vehicle';
import ServiceReminder from '../models/ServiceReminder';
import User from '../models/User';
import { processServiceReminders } from '../services/cronScheduler';
import { sendServiceReminder } from '../services/emailService';
import { sendServiceReminderSms } from '../services/smsService';

/**
 * The reminder job runs HOURLY in UTC and sends to a garage only during the
 * hour that reads 09:00 in that garage's own timezone. These tests pin the two
 * properties that make that safe:
 *
 *   1. the gate picks the right UTC hour per zone, across DST; and
 *   2. re-entering the same hour (a redeploy) sends nothing twice.
 *
 * A broken gate means 24 reminders a day to every customer.
 */

const sendEmailMock = vi.mocked(sendServiceReminder);
const sendSmsMock = vi.mocked(sendServiceReminderSms);

/** Creates a garage in the given country plus one due, pending reminder. */
async function seedDueReminder(country: string, timezone?: string) {
  const owner = new Types.ObjectId();
  const garage = await Garage.create({
    name: `Garage ${country}${timezone ? `-${timezone}` : ''}`,
    phone: '9876543210',
    owner,
    country,
    ...(timezone ? { settings: { timezone } } : {})
  });

  await User.create({
    name: 'Owner', email: `owner-${garage._id}@example.com`,
    password: 'password123', phone: '9876543210', role: 'owner', garage: garage._id
  });

  const customer = await Customer.create({
    name: 'Test Customer', phone: `98${String(Date.now()).slice(-8)}`,
    email: 'customer@example.com', garage: garage._id
  });

  const vehicle = await Vehicle.create({
    licensePlate: `KL${String(Date.now()).slice(-6)}`,
    make: 'Maruti', model: 'Swift', customer: customer._id, garage: garage._id
  });

  // A fixed date in the past, NOT one relative to the real clock: these tests
  // inject `now` (including dates in January to exercise DST), and a reminder
  // seeded relative to today would fall outside the "due within 7 days" window
  // whenever the injected clock is earlier than the real one.
  const reminder = await ServiceReminder.create({
    vehicle: vehicle._id, customer: customer._id, garage: garage._id,
    nextServiceDate: new Date('2024-01-01T00:00:00Z'),
    type: 'periodic_service', status: 'pending'
  });

  return { garage, reminder, customer };
}

beforeEach(() => {
  sendEmailMock.mockClear();
  sendSmsMock.mockClear();
  // Default: both channels succeed, so the reminder flips to 'sent'.
  sendEmailMock.mockResolvedValue({ logged: true, messageId: 'test', previewUrl: null } as never);
  sendSmsMock.mockResolvedValue({ logged: false, sid: 'SM_test', status: 'queued' } as never);
});

describe('reminder cron — per-garage local 09:00 gate', () => {
  it('sends to an India garage at 03:30 UTC (09:00 IST) and holds otherwise', async () => {
    await seedDueReminder('IN');

    const wrongHour = await processServiceReminders({
      respectLocalHour: true, now: new Date('2026-08-14T12:00:00Z')  // 17:30 IST
    });
    expect(wrongHour).toMatchObject({ heldForLocalTime: 1, emailSent: 0, smsSent: 0 });
    expect(sendEmailMock).not.toHaveBeenCalled();

    const rightHour = await processServiceReminders({
      respectLocalHour: true, now: new Date('2026-08-14T03:30:00Z')  // 09:00 IST
    });
    expect(rightHour).toMatchObject({ heldForLocalTime: 0, emailSent: 1 });
  });

  it('follows DST for Europe/London', async () => {
    await seedDueReminder('GB');

    // January: London is on GMT, so 09:00 local === 09:00 UTC.
    const janOn = await processServiceReminders({
      respectLocalHour: true, now: new Date('2026-01-14T09:00:00Z')
    });
    expect(janOn).toMatchObject({ heldForLocalTime: 0, emailSent: 1 });

    await ServiceReminder.updateMany({}, { status: 'pending', lastAttemptAt: null });
    sendEmailMock.mockClear();

    // July: London is on BST, so 09:00 UTC is already 10:00 local — too late.
    const julLate = await processServiceReminders({
      respectLocalHour: true, now: new Date('2026-07-14T09:00:00Z')
    });
    expect(julLate).toMatchObject({ heldForLocalTime: 1, emailSent: 0 });

    // ...and 08:00 UTC is 09:00 BST.
    const julOn = await processServiceReminders({
      respectLocalHour: true, now: new Date('2026-07-14T08:00:00Z')
    });
    expect(julOn).toMatchObject({ heldForLocalTime: 0, emailSent: 1 });
  });

  it('follows DST for America/New_York', async () => {
    await seedDueReminder('US', 'America/New_York');

    // EST (UTC-5) in January: 09:00 local === 14:00 UTC.
    expect(await processServiceReminders({
      respectLocalHour: true, now: new Date('2026-01-14T14:00:00Z')
    })).toMatchObject({ heldForLocalTime: 0, emailSent: 1 });

    await ServiceReminder.updateMany({}, { status: 'pending', lastAttemptAt: null });
    sendEmailMock.mockClear();

    // EDT (UTC-4) in July: the same 14:00 UTC is 10:00 local.
    expect(await processServiceReminders({
      respectLocalHour: true, now: new Date('2026-07-14T14:00:00Z')
    })).toMatchObject({ heldForLocalTime: 1, emailSent: 0 });

    expect(await processServiceReminders({
      respectLocalHour: true, now: new Date('2026-07-14T13:00:00Z')
    })).toMatchObject({ heldForLocalTime: 0, emailSent: 1 });
  });

  it('serves two garages in different zones at their own local 09:00', async () => {
    await seedDueReminder('IN');
    await seedDueReminder('GB');

    // 03:30 UTC — 09:00 in Kolkata, 04:30 in London.
    const indiaHour = await processServiceReminders({
      respectLocalHour: true, now: new Date('2026-08-14T03:30:00Z')
    });
    expect(indiaHour).toMatchObject({ processed: 2, emailSent: 1, heldForLocalTime: 1 });

    // 08:00 UTC — 09:00 BST in London; the Indian one is already 'sent'.
    const londonHour = await processServiceReminders({
      respectLocalHour: true, now: new Date('2026-08-14T08:00:00Z')
    });
    expect(londonHour).toMatchObject({ processed: 1, emailSent: 1, heldForLocalTime: 0 });
  });

  it('falls back to a sane zone when the garage has no country at all', async () => {
    // Documents written before the country field existed have no key —
    // resolveGarageLocale must still yield India's timezone.
    const { garage } = await seedDueReminder('IN');
    await Garage.collection.updateOne({ _id: garage._id }, { $unset: { country: '' } });

    expect(await processServiceReminders({
      respectLocalHour: true, now: new Date('2026-08-14T03:30:00Z')
    })).toMatchObject({ emailSent: 1 });
  });
});

describe('reminder cron — the gate lines up with the real schedule', () => {
  // The tests above feed `now` directly, which can assert a time the scheduler
  // never actually fires at. These walk the ticks the cron really produces
  // ('0,30 * * * *' in UTC) and check the send lands on the intended local
  // time — the check that catches a half-hour drift for offset zones.
  const ticksFor = (dayUtc: string) => {
    const ticks: Date[] = [];
    for (let h = 0; h < 24; h++) {
      for (const m of [0, 30]) {
        ticks.push(new Date(`${dayUtc}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`));
      }
    }
    return ticks;
  };

  /** The first scheduled tick at which this garage would be served. */
  async function firstSendingTick(day: string) {
    for (const tick of ticksFor(day)) {
      const result = await processServiceReminders({ respectLocalHour: true, now: tick });
      if ((result as { emailSent: number }).emailSent > 0) return tick.toISOString();
    }
    return null;
  }

  it('sends to an India garage at exactly 09:00 IST, not 09:30', async () => {
    await seedDueReminder('IN');
    // 03:30Z is 09:00 IST. An hourly-only schedule would first match at 04:00Z
    // — 09:30 local — silently shifting every Indian garage's reminders.
    expect(await firstSendingTick('2026-08-14')).toBe('2026-08-14T03:30:00.000Z');
  });

  it('sends to a UK garage at exactly 09:00 local across DST', async () => {
    await seedDueReminder('GB');
    expect(await firstSendingTick('2026-01-14')).toBe('2026-01-14T09:00:00.000Z');  // GMT

    await ServiceReminder.updateMany({}, { status: 'pending', lastAttemptAt: null });
    sendEmailMock.mockClear();
    expect(await firstSendingTick('2026-07-14')).toBe('2026-07-14T08:00:00.000Z');  // BST
  });

  it('sends exactly once per day, even though the job runs 48 times', async () => {
    await seedDueReminder('IN');
    let sends = 0;
    for (const tick of ticksFor('2026-08-14')) {
      const r = await processServiceReminders({ respectLocalHour: true, now: tick });
      sends += (r as { emailSent: number }).emailSent;
    }
    expect(sends).toBe(1);
  });
});

describe('reminder cron — idempotence on re-entry', () => {
  it('does not re-send when the process restarts inside the same local hour', async () => {
    await seedDueReminder('IN');

    await processServiceReminders({ respectLocalHour: true, now: new Date('2026-08-14T03:30:00Z') });
    expect(sendEmailMock).toHaveBeenCalledTimes(1);

    // A redeploy 20 minutes later triggers the startup run again.
    const again = await processServiceReminders({
      respectLocalHour: true, now: new Date('2026-08-14T03:50:00Z')
    });
    // The reminder is already 'sent', so the query no longer returns it.
    expect(again).toMatchObject({ processed: 0 });
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  it('does not re-attempt an unsendable reminder every hour', async () => {
    // A customer with neither email nor phone leaves the reminder 'pending'
    // forever — without the cooldown, an hourly job would append a failure
    // note 24 times a day and grow the notes field without bound.
    const { reminder, customer } = await seedDueReminder('IN');
    await Customer.findByIdAndUpdate(customer._id, { $unset: { email: '' }, phone: '' });
    sendEmailMock.mockResolvedValue({ skipped: true, reason: 'no_email' } as never);
    sendSmsMock.mockResolvedValue({ skipped: true, reason: 'no_phone' } as never);

    const first = await processServiceReminders({
      respectLocalHour: true, now: new Date('2026-08-14T03:30:00Z')
    });
    expect(first).toMatchObject({ skipped: 1 });
    const afterFirst = await ServiceReminder.findById(reminder._id);
    expect(afterFirst!.status).toBe('pending');
    expect(afterFirst!.lastAttemptAt).toBeTruthy();
    const notesAfterFirst = afterFirst!.notes;

    // Same hour again, and every hour for the rest of the day.
    const second = await processServiceReminders({
      respectLocalHour: true, now: new Date('2026-08-14T03:50:00Z')
    });
    expect(second).toMatchObject({ skipped: 0, heldForLocalTime: 1 });
    expect((await ServiceReminder.findById(reminder._id))!.notes).toBe(notesAfterFirst);

    // The next day's 09:00 is past the cooldown, so it retries.
    const nextDay = await processServiceReminders({
      respectLocalHour: true, now: new Date('2026-08-15T03:30:00Z')
    });
    expect(nextDay).toMatchObject({ skipped: 1 });
  });
});

describe('reminder cron — manual trigger', () => {
  it('ignores the local-hour gate so "send now" means now', async () => {
    await seedDueReminder('IN');

    // 12:00 UTC is 17:30 IST — the scheduled job would hold this.
    const result = await processServiceReminders({ now: new Date('2026-08-14T12:00:00Z') });
    expect(result).toMatchObject({ emailSent: 1, heldForLocalTime: 0 });
  });
});

describe('reminder cron — locale threading', () => {
  it('passes the garage locale to the email and SMS senders', async () => {
    await seedDueReminder('GB');
    await processServiceReminders({ respectLocalHour: true, now: new Date('2026-01-14T09:00:00Z') });

    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ locale: expect.objectContaining({ country: 'GB', currency: 'GBP' }) })
    );
    expect(sendSmsMock).toHaveBeenCalledWith(
      expect.objectContaining({ locale: expect.objectContaining({ country: 'GB' }) })
    );
  });
});
