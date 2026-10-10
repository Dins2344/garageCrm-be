import { and, count, desc, eq } from 'drizzle-orm';
import { db } from '../config/db';
import {
  changeRequests, ChangeRequestRow, raiseChangeRequestSchema, decisionSchema, changeRequestToApi
} from '../models/ChangeRequest';
import { users } from '../models/User';
import { garages } from '../models/Garage';
import {
  APPROVER_ROLES, CHANGE_REQUEST_STATUSES, CHANGE_REQUEST_TYPES, ChangeRequestStatus, ChangeRequestType, Role
} from '../types/domain';
import { REQUEST_TYPES } from './changeRequestTypes';
import * as notificationUsecase from './notificationUsecase';
import { runSchema } from '../utils/validation';
import { pagination } from '../utils/query';
import { isUniqueViolation } from '../utils/dbErrors';
import { isObjectIdHex } from '../utils/ids';
import { ApiObject } from '../utils/serialize';
import { HttpError } from '../utils/httpError';
import logger from '../utils/logger';

const log = logger.child('ChangeRequestUsecase');

const ENTITY_TYPE = 'change_request';
const PENDING_CONFLICT = 'A request of this type is already pending for this item.';

const PERSON = { columns: { _id: true, name: true, role: true } } as const;
const WITH_PEOPLE = { requestedBy: PERSON, decidedBy: PERSON } as const;

const isApprover = (role: Role): boolean => APPROVER_ROLES.includes(role);
const isStatus = (v: string): v is ChangeRequestStatus => (CHANGE_REQUEST_STATUSES as readonly string[]).includes(v);
const isType = (v: string): v is ChangeRequestType => (CHANGE_REQUEST_TYPES as readonly string[]).includes(v);

/** Staff see only what they raised; owners and admins see the whole branch. */
const visibleTo = (userId: string, role: Role) => (isApprover(role) ? undefined : eq(changeRequests.requestedById, userId));

/** Who decides a request: the branch owner plus its active admins. */
const approverIds = async (garageId: string): Promise<string[]> => {
  const [garage, admins] = await Promise.all([
    db.query.garages.findFirst({ columns: { ownerId: true }, where: eq(garages._id, garageId) }),
    db.select({ _id: users._id }).from(users)
      .where(and(eq(users.garageId, garageId), eq(users.role, 'admin'), eq(users.isActive, true)))
  ]);
  return [...(garage?.ownerId ? [garage.ownerId] : []), ...admins.map(a => a._id)];
};

interface RaiseInput {
  garageId: string;
  userId: string;
  userName: string;
  role: Role;
  data: Record<string, unknown>;
}

export const raiseChangeRequest = async ({ garageId, userId, userName, role, data }: RaiseInput): Promise<ApiObject> => {
  const { type, targetId, payload } = runSchema(raiseChangeRequestSchema, data);
  const handler = REQUEST_TYPES[type];
  const input = runSchema(handler.payloadSchema, payload);
  const target = await handler.load(garageId, targetId);
  handler.check(target, input);

  const [{ pending }] = await db.select({ pending: count() }).from(changeRequests).where(and(
    eq(changeRequests.garageId, garageId),
    eq(changeRequests.type, type),
    eq(changeRequests.targetId, targetId),
    eq(changeRequests.status, 'pending')
  ));
  if (pending > 0) throw new HttpError(PENDING_CONFLICT, 409);

  const label = handler.label(target);
  const stored = { ...input, ...handler.snapshot(target) };
  const created = await db.insert(changeRequests).values({
    garageId, type, targetType: handler.targetType, targetId, targetLabel: label, payload: stored, requestedById: userId
  }).returning().then(rows => rows[0], (err: unknown) => {
    // Two raises that both passed the check above meet the partial unique index.
    if (isUniqueViolation(err, 'change_requests_one_pending')) throw new HttpError(PENDING_CONFLICT, 409);
    throw err;
  });

  await notificationUsecase.notifyUsers({
    userIds: (await approverIds(garageId)).filter(id => id !== userId),
    garageId,
    type: 'request_raised',
    title: handler.title,
    body: `${userName} asked to ${handler.summary(label, stored)}`,
    entityType: ENTITY_TYPE,
    entityId: created._id
  });
  log.info('Change request raised', { garageId, requestId: created._id, type, targetId });
  return getChangeRequest({ requestId: created._id, garageId, userId, role });
};

interface ListInput {
  garageId: string;
  userId: string;
  role: Role;
  status?: string;
  type?: string;
  targetId?: string;
  page?: number | string;
  limit?: number | string;
}

export const listChangeRequests = async ({ garageId, userId, role, status, type, targetId, page = 1, limit = 20 }: ListInput) => {
  if (status && !isStatus(status)) throw new HttpError(`Status must be one of: ${CHANGE_REQUEST_STATUSES.join(', ')}`, 400);
  if (type && !isType(type)) throw new HttpError(`Type must be one of: ${CHANGE_REQUEST_TYPES.join(', ')}`, 400);
  const paging = pagination(page, limit);

  const where = and(
    eq(changeRequests.garageId, garageId),
    visibleTo(userId, role),
    status ? eq(changeRequests.status, status as ChangeRequestStatus) : undefined,
    type ? eq(changeRequests.type, type as ChangeRequestType) : undefined,
    targetId ? eq(changeRequests.targetId, targetId) : undefined
  );
  const [[{ total }], rows] = await Promise.all([
    db.select({ total: count() }).from(changeRequests).where(where),
    db.query.changeRequests.findMany({
      where,
      with: WITH_PEOPLE,
      orderBy: [desc(changeRequests.createdAt), desc(changeRequests._id)],
      offset: paging.offset,
      limit: paging.limit
    })
  ]);
  return { requests: rows.map(changeRequestToApi), total, page: paging.page, limit: paging.limit };
};

interface ByIdInput {
  requestId: string;
  garageId: string;
  userId: string;
  role: Role;
}

export const getChangeRequest = async ({ requestId, garageId, userId, role }: ByIdInput): Promise<ApiObject> => {
  const row = isObjectIdHex(requestId)
    ? await db.query.changeRequests.findFirst({
      where: and(eq(changeRequests._id, requestId), eq(changeRequests.garageId, garageId), visibleTo(userId, role)),
      with: WITH_PEOPLE
    })
    : undefined;
  if (!row) throw new HttpError('Request not found', 404);
  return changeRequestToApi(row);
};

/**
 * Moves a pending request on in one statement: the `status = 'pending'`
 * condition means two people deciding at once cannot both win.
 */
const claim = async (requestId: string, garageId: string, set: Partial<ChangeRequestRow>): Promise<ChangeRequestRow> => {
  if (!isObjectIdHex(requestId)) throw new HttpError('Request not found', 404);
  const scope = and(eq(changeRequests._id, requestId), eq(changeRequests.garageId, garageId));
  const [row] = await db.update(changeRequests).set(set)
    .where(and(scope, eq(changeRequests.status, 'pending'))).returning();
  if (row) return row;
  const exists = await db.query.changeRequests.findFirst({ columns: { _id: true }, where: scope });
  throw exists
    ? new HttpError('This request was already decided or withdrawn.', 409)
    : new HttpError('Request not found', 404);
};

export const withdrawChangeRequest = async ({ requestId, garageId, userId, role }: ByIdInput): Promise<ApiObject> => {
  const existing = isObjectIdHex(requestId)
    ? await db.query.changeRequests.findFirst({
      columns: { requestedById: true },
      where: and(eq(changeRequests._id, requestId), eq(changeRequests.garageId, garageId))
    })
    : undefined;
  if (!existing) throw new HttpError('Request not found', 404);
  if (existing.requestedById !== userId) throw new HttpError('Only the person who raised a request can withdraw it.', 403);

  const request = await claim(requestId, garageId, { status: 'withdrawn', decidedById: userId, decidedAt: new Date() });
  await notificationUsecase.markEntityRead({ entityType: ENTITY_TYPE, entityId: request._id, type: 'request_raised' });
  log.info('Change request withdrawn', { garageId, requestId });
  return getChangeRequest({ requestId, garageId, userId, role });
};

const requesterName = async (garageId: string, userId: string | null): Promise<string> => {
  if (!userId) return 'a former staff member';
  const user = await db.query.users.findFirst({
    columns: { name: true },
    where: and(eq(users._id, userId), eq(users.garageId, garageId))
  });
  return user?.name ?? 'a former staff member';
};

/** Clears everyone's "needs your approval" and tells the requester how it went. */
const announceDecision = async (request: ChangeRequestRow, deciderName: string): Promise<void> => {
  await notificationUsecase.markEntityRead({ entityType: ENTITY_TYPE, entityId: request._id, type: 'request_raised' });
  if (!request.requestedById) return;

  const approved = request.status === 'approved';
  const what = REQUEST_TYPES[request.type].describe(request.targetLabel);
  await notificationUsecase.notifyUsers({
    userIds: [request.requestedById],
    garageId: request.garageId,
    type: approved ? 'request_approved' : 'request_rejected',
    title: approved ? 'Request approved' : 'Request rejected',
    body: `${deciderName} ${approved ? 'approved' : 'rejected'} your request to ${what}${request.decisionNote ? `: ${request.decisionNote}` : ''}`,
    entityType: ENTITY_TYPE,
    entityId: request._id
  });
};

interface DecideInput extends ByIdInput {
  userName: string;
  data: Record<string, unknown>;
}

/** The decision is already saved: a notification failure must not turn it into an error. */
const announceDecisionSafely = async (request: ChangeRequestRow, deciderName: string): Promise<void> => {
  try {
    await announceDecision(request, deciderName);
  } catch (err) {
    log.error('Failed to announce change request decision', { requestId: request._id, garageId: request.garageId, error: (err as Error).message });
  }
};

export const approveChangeRequest = async ({ requestId, garageId, userId, userName, role, data }: DecideInput): Promise<ApiObject> => {
  const { note } = runSchema(decisionSchema, data);
  const request = await claim(requestId, garageId, { status: 'approved', decidedById: userId, decidedAt: new Date(), decisionNote: note });

  // ponytail: claim, then apply, without one shared transaction — the usecases
  // that apply a change open their own. A crash between the two leaves the
  // request approved with nothing applied; thread a tx through them if that
  // ever shows up.
  try {
    const handler = REQUEST_TYPES[request.type];
    const target = await handler.load(garageId, request.targetId).catch((err: unknown) => {
      if (err instanceof HttpError && err.statusCode === 404) {
        throw new HttpError(`${request.targetLabel} no longer exists. Reject this request.`, 409);
      }
      throw err;
    });
    handler.check(target, request.payload);
    await handler.apply(target, request.payload, {
      garageId,
      approverId: userId,
      approverRole: role,
      requesterName: await requesterName(garageId, request.requestedById)
    });
  } catch (err) {
    // Back to pending so the approver can see why and reject it instead.
    await db.update(changeRequests)
      .set({ status: 'pending', decidedById: null, decidedAt: null, decisionNote: '' })
      .where(and(eq(changeRequests._id, request._id), eq(changeRequests.garageId, garageId)))
      .catch((revertErr: unknown) => log.error('Could not revert change request to pending', { requestId, error: (revertErr as Error).message }));
    throw err;
  }

  await announceDecisionSafely(request, userName);
  log.info('Change request approved', { garageId, requestId, type: request.type });
  return getChangeRequest({ requestId, garageId, userId, role });
};

export const rejectChangeRequest = async ({ requestId, garageId, userId, userName, role, data }: DecideInput): Promise<ApiObject> => {
  const { note } = runSchema(decisionSchema, data);
  const request = await claim(requestId, garageId, { status: 'rejected', decidedById: userId, decidedAt: new Date(), decisionNote: note });
  await announceDecisionSafely(request, userName);
  log.info('Change request rejected', { garageId, requestId, type: request.type });
  return getChangeRequest({ requestId, garageId, userId, role });
};
