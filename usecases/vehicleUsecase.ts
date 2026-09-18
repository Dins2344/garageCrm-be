import { and, count, desc, eq, inArray, or } from 'drizzle-orm';
import { db } from '../config/db';
import { vehicles, createVehicleSchema, updateVehicleSchema, vehicleToApi } from '../models/Vehicle';
import { customers } from '../models/Customer';
import { jobCards, jobCardSummaryToApi } from '../models/JobCard';
import { runSchema } from '../utils/validation';
import { pagination, plateMatches, textMatches } from '../utils/query';
import { ApiObject } from '../utils/serialize';
import logger from '../utils/logger';
import { HttpError } from '../utils/httpError';

const log = logger.child('VehicleUsecase');

interface ListInput {
  garageId: string;
  search?: string;
  page?: number | string;
  limit?: number | string;
}

/**
 * The vehicle-list search: plate (ignoring spaces, so "kl07bq" finds
 * "KL 07 BQ 4521"), make, model, or the owner's name. Exported so the job
 * card list can reuse it as a sub-select.
 */
export const vehicleSearchCondition = (garageId: string, search: string) => or(
  plateMatches(vehicles.licensePlate, search),
  textMatches(vehicles.make, search),
  textMatches(vehicles.model, search),
  inArray(
    vehicles.customerId,
    db.select({ id: customers._id }).from(customers)
      .where(and(eq(customers.garageId, garageId), textMatches(customers.name, search)))
  )
);

export const getVehiclesList = async ({ garageId, search, page = 1, limit = 20 }: ListInput) => {
  const paging = pagination(page, limit);
  const term = search?.trim();
  const where = term
    ? and(eq(vehicles.garageId, garageId), vehicleSearchCondition(garageId, term))
    : eq(vehicles.garageId, garageId);

  const [{ total }] = await db.select({ total: count() }).from(vehicles).where(where);
  const rows = await db.query.vehicles.findMany({
    with: { customer: { columns: { _id: true, name: true, phone: true } } },
    where,
    orderBy: [desc(vehicles.createdAt)],
    offset: paging.offset,
    limit: paging.limit
  });

  return { vehicles: rows.map(vehicleToApi), total };
};

interface GetDetailsInput {
  vehicleId: string;
  garageId: string;
}

export const getVehicleDetails = async ({ vehicleId, garageId }: GetDetailsInput): Promise<ApiObject> => {
  const vehicle = await db.query.vehicles.findFirst({
    where: and(eq(vehicles._id, vehicleId), eq(vehicles.garageId, garageId)),
    with: {
      customer: true,
      // `serviceHistory` — the ten most recent job cards for this vehicle.
      jobCards: { orderBy: [desc(jobCards.createdAt)], limit: 10 }
    }
  });

  if (!vehicle) {
    throw new HttpError('Vehicle not found', 404);
  }

  return vehicleToApi(vehicle);
};

/** The new owner has to be a customer of *this* garage. */
const assertCustomerInGarage = async (customerId: string, garageId: string): Promise<void> => {
  const owner = await db.query.customers.findFirst({
    columns: { _id: true },
    where: and(eq(customers._id, customerId), eq(customers.garageId, garageId))
  });
  if (!owner) {
    throw new HttpError('Customer not found', 404);
  }
};

interface RegisterInput {
  vehicleData: Record<string, unknown>;
  garageId: string;
}

export const registerVehicle = async ({ vehicleData, garageId }: RegisterInput): Promise<ApiObject> => {
  const { customer, ...input } = runSchema(createVehicleSchema, vehicleData);
  await assertCustomerInGarage(customer, garageId);

  const [vehicle] = await db.insert(vehicles).values({ ...input, customerId: customer, garageId }).returning();

  log.info('New vehicle registered', { vehicleId: vehicle._id, customerId: vehicle.customerId });
  return vehicleToApi(vehicle);
};

interface UpdateInput {
  vehicleId: string;
  garageId: string;
  updateData: Record<string, unknown>;
}

export const updateVehicleData = async ({ vehicleId, garageId, updateData }: UpdateInput): Promise<ApiObject> => {
  const scope = and(eq(vehicles._id, vehicleId), eq(vehicles.garageId, garageId));

  const existing = await db.query.vehicles.findFirst({ columns: { customerId: true }, where: scope });
  if (!existing) {
    throw new HttpError('Vehicle not found', 404);
  }

  const { customer: requestedOwner, ...changes } = runSchema(updateVehicleSchema, updateData);
  const ownerIsChanging = !!requestedOwner && requestedOwner !== existing.customerId;

  // Without this check a client could hand us any customer id and point the
  // vehicle across a tenant boundary. (The customer's vehicle count is derived
  // now, so nothing else needs maintaining when the owner changes.)
  if (ownerIsChanging) {
    await assertCustomerInGarage(requestedOwner, garageId);
  }

  const set = { ...changes, ...(ownerIsChanging ? { customerId: requestedOwner } : {}) };
  const vehicle = Object.keys(set).length === 0
    ? await db.query.vehicles.findFirst({ where: scope })
    : (await db.update(vehicles).set(set).where(scope).returning())[0];

  if (!vehicle) {
    throw new HttpError('Vehicle not found', 404);
  }

  if (ownerIsChanging) {
    log.info('Vehicle owner changed', { vehicleId, from: existing.customerId, to: requestedOwner });
  }

  return vehicleToApi(vehicle);
};

interface RemoveInput {
  vehicleId: string;
  garageId: string;
}

/**
 * Refuses (409) while job cards still reference the vehicle — an invoice's
 * history must not lose the car it was raised against. Service reminders
 * cascade with the vehicle.
 */
export const removeVehicle = async ({ vehicleId, garageId }: RemoveInput): Promise<true> => {
  const scope = and(eq(vehicles._id, vehicleId), eq(vehicles.garageId, garageId));

  const vehicle = await db.query.vehicles.findFirst({ columns: { _id: true }, where: scope });
  if (!vehicle) {
    throw new HttpError('Vehicle not found', 404);
  }

  const [{ jobCardCount }] = await db.select({ jobCardCount: count() }).from(jobCards)
    .where(and(eq(jobCards.vehicleId, vehicleId), eq(jobCards.garageId, garageId)));
  if (jobCardCount > 0) {
    throw new HttpError(
      `This vehicle still has ${jobCardCount} job card(s). Remove them before deleting the vehicle.`,
      409
    );
  }

  await db.delete(vehicles).where(scope);

  log.info('Vehicle removed from registry', { vehicleId, garageId });
  return true;
};

interface HistoryInput {
  vehicleId: string;
  garageId: string;
  page?: number | string;
  limit?: number | string;
}

export const getVehicleHistory = async ({ vehicleId, garageId, page = 1, limit = 20 }: HistoryInput) => {
  const paging = pagination(page, limit);
  const where = and(eq(jobCards.vehicleId, vehicleId), eq(jobCards.garageId, garageId));

  const [{ total }] = await db.select({ total: count() }).from(jobCards).where(where);
  const rows = await db.query.jobCards.findMany({
    columns: { statusHistory: false, photos: false },
    with: {
      customer: { columns: { _id: true, name: true, phone: true } },
      assignedMechanic: { columns: { _id: true, name: true } }
    },
    where,
    orderBy: [desc(jobCards.createdAt)],
    offset: paging.offset,
    limit: paging.limit
  });

  log.info('Vehicle history fetched', { vehicleId, garageId, count: rows.length, total });
  return {
    jobCards: rows.map(jobCardSummaryToApi),
    total,
    page: paging.page,
    limit: paging.limit
  };
};
