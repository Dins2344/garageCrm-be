import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import app from '../app';
import { createGarageWithOwner, insertStaff, nextPhone, authHeader } from './helpers/factories';
import { schema, countRows } from './helpers/dbAccess';
import { sendPush } from '../services/pushService';

/** A garage with an owner, an admin, a mechanic and an advisor, and one job card at 45200 km. */
const setup = async (suffix: string) => {
  const owner = await createGarageWithOwner(suffix);
  const admin = await insertStaff(owner.garageId, 'admin', `${suffix}-admin`, 'Anu Admin');
  const mechanic = await insertStaff(owner.garageId, 'mechanic', `${suffix}-mech`, 'Ravi Mechanic');
  const advisor = await insertStaff(owner.garageId, 'service_advisor', `${suffix}-adv`, 'Priya Advisor');
  const post = (path: string, body: object) => request(app).post(path).set(authHeader(owner.token)).send(body);
  const customer = (await post('/api/customers', { name: 'CR Customer', phone: nextPhone() })).body.data._id;
  const vehicle = (await post('/api/vehicles', { licensePlate: 'KA01CR0001', make: 'Honda', model: 'City', customer })).body.data._id;
  const jobCard = (await post('/api/jobcards', { serviceType: 'service', vehicle, customer, odometerAtIntake: 45200 })).body.data;
  return { owner, admin, mechanic, advisor, jobCard: jobCard as { _id: string; jobCardNumber: string } };
};

/** Runs the real flow to an invoice; the job card ends up `delivered`. */
const invoiceFor = async (ownerToken: string, jobCardId: string) => {
  const put = (path: string, body: object = {}) => request(app).put(path).set(authHeader(ownerToken)).send(body);
  await put(`/api/jobcards/${jobCardId}/estimation`, { parts: [], labor: [{ description: 'Service', hours: 1, ratePerHour: 500 }], discount: 0, taxRate: 18 });
  await put(`/api/jobcards/${jobCardId}`, { status: 'estimation_sent' });
  await put(`/api/jobcards/${jobCardId}/approve`);
  return (await request(app).post('/api/invoices').set(authHeader(ownerToken)).send({ jobCardId })).body.data as { _id: string; invoiceNumber: string };
};

const raise = (token: string, type: string, targetId: string, payload: object) =>
  request(app).post('/api/change-requests').set(authHeader(token)).send({ type, targetId, payload });
const get = (token: string, path: string) => request(app).get(path).set(authHeader(token));
const put = (token: string, path: string, body: object = {}) => request(app).put(path).set(authHeader(token)).send(body);
const unread = async (token: string) => (await get(token, '/api/notifications/unread-count')).body.data.count as number;

describe('raising a change request', () => {
  it('records an odometer correction with the reading it replaces', async () => {
    const g = await setup('cr-raise');

    const res = await raise(g.mechanic.token, 'odometer_correction', g.jobCard._id, { odometerAtIntake: 12000, remarks: 'Meter replaced' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      type: 'odometer_correction', status: 'pending', targetType: 'job_card', target: g.jobCard._id,
      targetLabel: g.jobCard.jobCardNumber,
      payload: { odometerAtIntake: 12000, remarks: 'Meter replaced', previousOdometer: 45200 },
      requestedBy: { _id: g.mechanic.userId, name: 'Ravi Mechanic' },
      decidedBy: null, decisionNote: ''
    });
  });

  it('notifies the owner and active admins, never the requester', async () => {
    const g = await setup('cr-notify');
    const inactive = await insertStaff(g.owner.garageId, 'admin', 'cr-notify-off', 'Off Admin');
    await request(app).patch(`/api/users/${inactive.userId}/deactivate`).set(authHeader(g.owner.token));
    vi.mocked(sendPush).mockClear();

    await raise(g.mechanic.token, 'job_card_cancellation', g.jobCard._id, { reason: 'Customer declined' });

    const received = (userId: string) => countRows(schema.notifications, eq(schema.notifications.userId, userId));
    expect(await received(g.owner.userId)).toBe(1);
    expect(await received(g.admin.userId)).toBe(1);
    expect(await received(inactive.userId)).toBe(0);
    expect(await received(g.mechanic.userId)).toBe(0);
    const [first] = (await get(g.owner.token, '/api/notifications')).body.data;
    expect(first).toMatchObject({
      type: 'request_raised', title: 'Cancellation requested', entityType: 'change_request',
      body: `Ravi Mechanic asked to cancel ${g.jobCard.jobCardNumber}: Customer declined`
    });
    expect(vi.mocked(sendPush)).toHaveBeenCalledTimes(1);
  });

  it('describes an odometer request with both readings', async () => {
    const g = await setup('cr-odo-text');
    await raise(g.mechanic.token, 'odometer_correction', g.jobCard._id, { odometerAtIntake: 12000, remarks: 'x' });
    const [first] = (await get(g.owner.token, '/api/notifications')).body.data;
    expect(first.title).toBe('Odometer correction requested');
    expect(first.body).toBe(`Ravi Mechanic asked to correct the odometer on ${g.jobCard.jobCardNumber} from 45200 km to 12000 km`);
  });

  it('refuses owners and admins, who can make the change directly', async () => {
    const g = await setup('cr-approver');
    expect((await raise(g.owner.token, 'job_card_cancellation', g.jobCard._id, { reason: 'x' })).status).toBe(403);
    expect((await raise(g.admin.token, 'job_card_cancellation', g.jobCard._id, { reason: 'x' })).status).toBe(403);
  });

  it('rejects an unknown type and a bad payload with the field messages', async () => {
    const g = await setup('cr-invalid');
    const unknownType = await raise(g.mechanic.token, 'repaint', g.jobCard._id, {});
    expect(unknownType.status).toBe(400);
    expect(unknownType.body.message).toContain('Request type must be one of');

    const noRemarks = await raise(g.mechanic.token, 'odometer_correction', g.jobCard._id, { odometerAtIntake: 100 });
    expect(noRemarks.status).toBe(400);
    expect(noRemarks.body.message).toBe('Remarks are required');

    const negative = await raise(g.mechanic.token, 'odometer_correction', g.jobCard._id, { odometerAtIntake: -5, remarks: 'x' });
    expect(negative.body.message).toBe('Odometer cannot be negative');

    const tooLarge = await raise(g.mechanic.token, 'odometer_correction', g.jobCard._id, { odometerAtIntake: 10000000, remarks: 'x' });
    expect(tooLarge.status).toBe(400);
    expect(tooLarge.body.message).toBe('Odometer reading looks too large — please check the value');

    const noReason = await raise(g.mechanic.token, 'job_card_cancellation', g.jobCard._id, {});
    expect(noReason.body.message).toBe('Reason is required');
  });

  it('refuses an odometer reading that is already the recorded one', async () => {
    const g = await setup('cr-same');
    const res = await raise(g.mechanic.token, 'odometer_correction', g.jobCard._id, { odometerAtIntake: 45200, remarks: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('The new reading is the same as the recorded one.');
  });

  it('refuses to cancel a job card that is already closed', async () => {
    const g = await setup('cr-closed');
    await put(g.owner.token, `/api/jobcards/${g.jobCard._id}`, { status: 'cancelled' });

    const res = await raise(g.mechanic.token, 'job_card_cancellation', g.jobCard._id, { reason: 'x' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('This job card is already cancelled and cannot be cancelled.');
  });

  it("does not find another garage's job card", async () => {
    const g = await setup('cr-foreign');
    const other = await setup('cr-foreign-2');
    const res = await raise(g.mechanic.token, 'job_card_cancellation', other.jobCard._id, { reason: 'x' });
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Job card not found');
  });

  it('allows one pending request per item and type', async () => {
    const g = await setup('cr-dup');
    await raise(g.mechanic.token, 'job_card_cancellation', g.jobCard._id, { reason: 'x' });

    const again = await raise(g.advisor.token, 'job_card_cancellation', g.jobCard._id, { reason: 'y' });
    expect(again.status).toBe(409);
    expect(again.body.message).toBe('A request of this type is already pending for this item.');

    const otherType = await raise(g.advisor.token, 'odometer_correction', g.jobCard._id, { odometerAtIntake: 1, remarks: 'z' });
    expect(otherType.status).toBe(201);
  });

  it('records an invoice cancellation against the invoice number', async () => {
    const g = await setup('cr-invoice');
    const invoice = await invoiceFor(g.owner.token, g.jobCard._id);

    const res = await raise(g.advisor.token, 'invoice_cancellation', invoice._id, { reason: 'Duplicate bill' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ targetType: 'invoice', target: invoice._id, targetLabel: invoice.invoiceNumber });
  });
});

describe('reading change requests', () => {
  it('shows staff only their own and owners and admins everything', async () => {
    const g = await setup('cr-list');
    await raise(g.mechanic.token, 'odometer_correction', g.jobCard._id, { odometerAtIntake: 1, remarks: 'x' });
    await raise(g.advisor.token, 'job_card_cancellation', g.jobCard._id, { reason: 'x' });

    expect((await get(g.mechanic.token, '/api/change-requests')).body.total).toBe(1);
    expect((await get(g.owner.token, '/api/change-requests')).body.total).toBe(2);
    expect((await get(g.admin.token, '/api/change-requests')).body.total).toBe(2);
  });

  it('filters by status, type and target, and refuses an unknown status', async () => {
    const g = await setup('cr-filter');
    await raise(g.mechanic.token, 'odometer_correction', g.jobCard._id, { odometerAtIntake: 1, remarks: 'x' });
    await raise(g.advisor.token, 'job_card_cancellation', g.jobCard._id, { reason: 'x' });

    expect((await get(g.owner.token, `/api/change-requests?status=pending&targetId=${g.jobCard._id}`)).body.total).toBe(2);
    expect((await get(g.owner.token, '/api/change-requests?type=odometer_correction')).body.total).toBe(1);
    expect((await get(g.owner.token, '/api/change-requests?status=approved')).body.total).toBe(0);
    expect((await get(g.owner.token, '/api/change-requests?status=bogus')).status).toBe(400);
  });

  it("hides another staff member's request", async () => {
    const g = await setup('cr-hide');
    const id = (await raise(g.mechanic.token, 'job_card_cancellation', g.jobCard._id, { reason: 'x' })).body.data._id;

    expect((await get(g.advisor.token, `/api/change-requests/${id}`)).status).toBe(404);
    expect((await get(g.mechanic.token, `/api/change-requests/${id}`)).status).toBe(200);
    expect((await get(g.owner.token, `/api/change-requests/${id}`)).status).toBe(200);
    expect((await get(g.owner.token, '/api/change-requests/nope')).status).toBe(404);
  });
});

describe('withdrawing', () => {
  it("lets the requester withdraw, clears the owner's alert, and frees the slot", async () => {
    const g = await setup('cr-withdraw');
    const id = (await raise(g.mechanic.token, 'job_card_cancellation', g.jobCard._id, { reason: 'x' })).body.data._id;
    expect(await unread(g.owner.token)).toBe(1);

    const res = await put(g.mechanic.token, `/api/change-requests/${id}/withdraw`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('withdrawn');
    expect(await unread(g.owner.token)).toBe(0);
    expect((await raise(g.mechanic.token, 'job_card_cancellation', g.jobCard._id, { reason: 'again' })).status).toBe(201);
  });

  it('refuses anyone else, owner included', async () => {
    const g = await setup('cr-withdraw-other');
    const id = (await raise(g.mechanic.token, 'job_card_cancellation', g.jobCard._id, { reason: 'x' })).body.data._id;

    const owner = await put(g.owner.token, `/api/change-requests/${id}/withdraw`);
    expect(owner.status).toBe(403);
    expect(owner.body.message).toBe('Only the person who raised a request can withdraw it.');
  });

  it('cannot withdraw twice', async () => {
    const g = await setup('cr-withdraw-twice');
    const id = (await raise(g.mechanic.token, 'job_card_cancellation', g.jobCard._id, { reason: 'x' })).body.data._id;
    await put(g.mechanic.token, `/api/change-requests/${id}/withdraw`);

    const again = await put(g.mechanic.token, `/api/change-requests/${id}/withdraw`);
    expect(again.status).toBe(409);
    expect(again.body.message).toBe('This request was already decided or withdrawn.');
  });
});

const decide = (token: string, id: string, action: 'approve' | 'reject', body: object = {}) =>
  put(token, `/api/change-requests/${id}/${action}`, body);
const jobCardOf = async (token: string, id: string) => (await get(token, `/api/jobcards/${id}`)).body.data;
const lastNote = (jc: { statusHistory: { notes: string }[] }) => jc.statusHistory.at(-1)!.notes;

describe('approving', () => {
  it('applies an odometer correction and credits both people on the timeline', async () => {
    const g = await setup('cr-ok-odo');
    const id = (await raise(g.mechanic.token, 'odometer_correction', g.jobCard._id, { odometerAtIntake: 12000, remarks: 'Meter replaced' })).body.data._id;

    const res = await decide(g.owner.token, id, 'approve', { note: 'OK' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'approved', decidedBy: { _id: g.owner.userId }, decisionNote: 'OK' });
    const jc = await jobCardOf(g.owner.token, g.jobCard._id);
    expect(jc.odometerAtIntake).toBe(12000);
    expect(lastNote(jc)).toBe('Odometer corrected from 45200 km to 12000 km. Remarks: Meter replaced (requested by Ravi Mechanic)');
    expect(jc.statusHistory.at(-1).changedBy).toMatchObject({ _id: g.owner.userId });
  });

  it("tells the requester and clears every approver's pending alert", async () => {
    const g = await setup('cr-ok-notify');
    const id = (await raise(g.mechanic.token, 'job_card_cancellation', g.jobCard._id, { reason: 'Customer declined' })).body.data._id;

    await decide(g.owner.token, id, 'approve');

    const [mine] = (await get(g.mechanic.token, '/api/notifications')).body.data;
    expect(mine).toMatchObject({
      type: 'request_approved', title: 'Request approved',
      body: `Test Owner approved your request to cancel ${g.jobCard.jobCardNumber}`
    });
    expect(await unread(g.owner.token)).toBe(0);
    expect(await unread(g.admin.token)).toBe(0);
  });

  it('cancels a job card, naming who asked and why', async () => {
    const g = await setup('cr-ok-cancel');
    const id = (await raise(g.mechanic.token, 'job_card_cancellation', g.jobCard._id, { reason: 'Customer declined' })).body.data._id;

    await decide(g.admin.token, id, 'approve');

    const jc = await jobCardOf(g.owner.token, g.jobCard._id);
    expect(jc.status).toBe('cancelled');
    expect(lastNote(jc)).toBe("Cancelled at Ravi Mechanic's request: Customer declined");
  });

  it('cancels an invoice and reopens the job card', async () => {
    const g = await setup('cr-ok-invoice');
    const invoice = await invoiceFor(g.owner.token, g.jobCard._id);
    const id = (await raise(g.advisor.token, 'invoice_cancellation', invoice._id, { reason: 'Duplicate bill' })).body.data._id;

    expect((await decide(g.owner.token, id, 'approve')).status).toBe(200);

    expect((await get(g.owner.token, `/api/invoices/${invoice._id}`)).status).toBe(404);
    const jc = await jobCardOf(g.owner.token, g.jobCard._id);
    expect(jc.status).toBe('approved');
    expect(lastNote(jc)).toBe(
      `Invoice ${invoice.invoiceNumber} cancelled. Job reopened for editing. Cancelled at Priya Advisor's request: Duplicate bill`
    );
  });

  it('refuses staff', async () => {
    const g = await setup('cr-ok-staff');
    const id = (await raise(g.mechanic.token, 'job_card_cancellation', g.jobCard._id, { reason: 'x' })).body.data._id;
    expect((await decide(g.mechanic.token, id, 'approve')).status).toBe(403);
  });

  it('applies once: a second approval is refused', async () => {
    const g = await setup('cr-ok-twice');
    const id = (await raise(g.mechanic.token, 'odometer_correction', g.jobCard._id, { odometerAtIntake: 12000, remarks: 'x' })).body.data._id;
    await decide(g.owner.token, id, 'approve');

    const again = await decide(g.admin.token, id, 'approve');

    expect(again.status).toBe(409);
    expect(again.body.message).toBe('This request was already decided or withdrawn.');
    const jc = await jobCardOf(g.owner.token, g.jobCard._id);
    expect(jc.statusHistory.filter((h: { notes: string }) => h.notes.startsWith('Odometer corrected')).length).toBe(1);
  });

  it('refuses a stale odometer request and leaves it pending', async () => {
    const g = await setup('cr-stale');
    const id = (await raise(g.mechanic.token, 'odometer_correction', g.jobCard._id, { odometerAtIntake: 12000, remarks: 'x' })).body.data._id;
    await put(g.owner.token, `/api/jobcards/${g.jobCard._id}`, { odometerAtIntake: 46000, odometerRemarks: 'Typo' });

    const res = await decide(g.owner.token, id, 'approve');

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('The odometer has changed to 46000 km since this request was raised. Reject it and ask for a new one.');
    expect((await get(g.owner.token, `/api/change-requests/${id}`)).body.data).toMatchObject({ status: 'pending', decidedBy: null });
    expect((await jobCardOf(g.owner.token, g.jobCard._id)).odometerAtIntake).toBe(46000);
  });

  it('refuses when the item is gone, and the owner can still reject', async () => {
    const g = await setup('cr-gone');
    const invoice = await invoiceFor(g.owner.token, g.jobCard._id);
    const id = (await raise(g.advisor.token, 'invoice_cancellation', invoice._id, { reason: 'x' })).body.data._id;
    await request(app).delete(`/api/invoices/${invoice._id}`).set(authHeader(g.owner.token));

    const res = await decide(g.owner.token, id, 'approve');

    expect(res.status).toBe(409);
    expect(res.body.message).toBe(`${invoice.invoiceNumber} no longer exists. Reject this request.`);
    expect((await decide(g.owner.token, id, 'reject')).status).toBe(200);
  });
});

describe('rejecting', () => {
  it('leaves the item alone and tells the requester why', async () => {
    const g = await setup('cr-reject');
    const id = (await raise(g.mechanic.token, 'job_card_cancellation', g.jobCard._id, { reason: 'x' })).body.data._id;

    const res = await decide(g.owner.token, id, 'reject', { note: 'Customer is coming back' });

    expect(res.body.data).toMatchObject({ status: 'rejected', decisionNote: 'Customer is coming back' });
    expect((await jobCardOf(g.owner.token, g.jobCard._id)).status).toBe('new');
    const [mine] = (await get(g.mechanic.token, '/api/notifications')).body.data;
    expect(mine).toMatchObject({
      type: 'request_rejected', title: 'Request rejected',
      body: `Test Owner rejected your request to cancel ${g.jobCard.jobCardNumber}: Customer is coming back`
    });
    expect(await unread(g.owner.token)).toBe(0);
  });

  it('cannot reject a withdrawn request', async () => {
    const g = await setup('cr-reject-withdrawn');
    const id = (await raise(g.mechanic.token, 'job_card_cancellation', g.jobCard._id, { reason: 'x' })).body.data._id;
    await put(g.mechanic.token, `/api/change-requests/${id}/withdraw`);
    expect((await decide(g.owner.token, id, 'reject')).status).toBe(409);
  });

  it('limits the note to 500 characters', async () => {
    const g = await setup('cr-reject-long');
    const id = (await raise(g.mechanic.token, 'job_card_cancellation', g.jobCard._id, { reason: 'x' })).body.data._id;
    const res = await decide(g.owner.token, id, 'reject', { note: 'x'.repeat(501) });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Note cannot exceed 500 characters');
  });
});
