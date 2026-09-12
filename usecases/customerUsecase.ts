import { and, count, desc, eq, ilike, or } from 'drizzle-orm';
import { db } from '../config/db';
import { customers, createCustomerSchema, updateCustomerSchema, customerToApi } from '../models/Customer';
import { vehicles } from '../models/Vehicle';
import { jobCards } from '../models/JobCard';
import { runSchema } from '../utils/validation';
import { containsPattern, pagination } from '../utils/query';
import { ApiObject } from '../utils/serialize';
import logger from '../utils/logger';
import { HttpError } from '../utils/httpError';

const log = logger.child('CustomerUsecase');

/**
 * CUSTOMER BUSINESS LOGIC (USE CASES)
 * Completely agnostic of HTTP/Express logic.
 */

interface ListInput {
  garageId: string;
  search?: string;
  page?: number | string;
  limit?: number | string;
}

export const getCustomersList = async ({ garageId, search, page = 1, limit = 20 }: ListInput) => {
  log.info('Querying customers list', { garageId, search, page, limit });
  const paging = pagination(page, limit);

  const where = search
    ? and(
        eq(customers.garageId, garageId),
        or(ilike(customers.name, containsPattern(search)), ilike(customers.phone, containsPattern(search)))
      )
    : eq(customers.garageId, garageId);

  const [{ total }] = await db.select({ total: count() }).from(customers).where(where);
  const rows = await db.query.customers.findMany({
    columns: { _id: true, name: true, phone: true, email: true, totalVisits: true, totalSpent: true, createdAt: true },
    with: { vehicles: { columns: { _id: true, licensePlate: true, make: true, model: true } } },
    where,
    orderBy: [desc(customers.createdAt)],
    offset: paging.offset,
    limit: paging.limit
  });

  log.info('Customers list fetched', { garageId, count: rows.length, total });
  return { customers: rows.map(customerToApi), total, page: paging.page, limit: paging.limit };
};

interface GetByIdInput {
  customerId: string;
  garageId: string;
}

export const getCustomerById = async ({ customerId, garageId }: GetByIdInput): Promise<ApiObject> => {
  log.info('Fetching customer by id', { customerId, garageId });
  const customer = await db.query.customers.findFirst({
    where: and(eq(customers._id, customerId), eq(customers.garageId, garageId)),
    with: { vehicles: true }
  });

  if (!customer) {
    log.warn('Customer not found', { customerId, garageId });
    throw new HttpError('Customer not found', 404);
  }

  log.info('Customer fetched', { customerId });
  return customerToApi(customer);
};

interface SaveInput {
  customerData: Record<string, unknown>;
  garageId: string;
}

export const saveCustomer = async ({ customerData, garageId }: SaveInput): Promise<ApiObject> => {
  log.info('Registering new customer', { garageId, phone: customerData.phone });
  const input = runSchema(createCustomerSchema, customerData);
  const [customer] = await db.insert(customers).values({ ...input, garageId }).returning();
  log.info('New customer registered', { customerId: customer._id, garageId });
  return customerToApi(customer);
};

interface UpdateInput {
  customerId: string;
  garageId: string;
  updateData: Record<string, unknown>;
}

export const updateCustomerData = async ({ customerId, garageId, updateData }: UpdateInput): Promise<ApiObject> => {
  log.info('Updating customer data', { customerId, garageId, fields: Object.keys(updateData) });
  const changes = runSchema(updateCustomerSchema, updateData);
  const scope = and(eq(customers._id, customerId), eq(customers.garageId, garageId));

  const updated = Object.keys(changes).length === 0
    ? await db.query.customers.findFirst({ columns: { _id: true }, where: scope })
    : (await db.update(customers).set(changes).where(scope).returning({ _id: customers._id }))[0];

  if (!updated) {
    log.warn('Customer not found for update', { customerId, garageId });
    throw new HttpError('Customer not found', 404);
  }

  const customer = await db.query.customers.findFirst({
    where: scope,
    with: { vehicles: { columns: { _id: true } } }
  });

  log.info('Customer updated', { customerId });
  return customerToApi(customer!);
};

interface RemoveInput {
  customerId: string;
  garageId: string;
}

/**
 * Refuses (409) while the customer still has vehicles or job cards. Mongo
 * deleted the customer and left every reference dangling; the foreign keys
 * would now reject that, and an explicit count gives the owner a message they
 * can act on instead of a constraint name.
 */
export const removeCustomer = async ({ customerId, garageId }: RemoveInput): Promise<true> => {
  log.info('Removing customer', { customerId, garageId });
  const scope = and(eq(customers._id, customerId), eq(customers.garageId, garageId));

  const customer = await db.query.customers.findFirst({ columns: { _id: true }, where: scope });
  if (!customer) {
    log.warn('Customer not found for deletion', { customerId, garageId });
    throw new HttpError('Customer not found', 404);
  }

  const [{ vehicleCount }] = await db.select({ vehicleCount: count() }).from(vehicles)
    .where(and(eq(vehicles.customerId, customerId), eq(vehicles.garageId, garageId)));
  const [{ jobCardCount }] = await db.select({ jobCardCount: count() }).from(jobCards)
    .where(and(eq(jobCards.customerId, customerId), eq(jobCards.garageId, garageId)));

  if (vehicleCount > 0 || jobCardCount > 0) {
    const parts = [
      vehicleCount > 0 ? `${vehicleCount} vehicle(s)` : null,
      jobCardCount > 0 ? `${jobCardCount} job card(s)` : null
    ].filter(Boolean);
    throw new HttpError(
      `This customer still has ${parts.join(' and ')}. Remove or reassign them before deleting the customer.`,
      409
    );
  }

  await db.delete(customers).where(scope);

  log.info('Customer deleted from registry', { customerId, garageId });
  return true;
};
