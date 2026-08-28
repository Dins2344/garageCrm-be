import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../app';
import Customer from '../models/Customer';
import { createGarageWithOwner, nextPhone, authHeader } from './helpers/factories';

/**
 * `Customer.vehicles` is a denormalised array, and both clients render its
 * `.length` as the customer's vehicle count. That means every write path which
 * changes who owns a vehicle has to maintain it by hand — registration pushed
 * and deletion pulled, but reassignment did neither, so a vehicle stayed
 * counted against its old owner forever and was never counted against its new
 * one.
 */

interface Ctx {
  token: string;
  garageId: string;
}

const makeCustomer = async (ctx: Ctx, name: string) => {
  const res = await request(app)
    .post('/api/customers')
    .set(authHeader(ctx.token))
    .send({ name, phone: nextPhone() });
  expect(res.status).toBe(201);
  return res.body.data._id as string;
};

const makeVehicle = async (ctx: Ctx, customerId: string, plate: string) => {
  const res = await request(app)
    .post('/api/vehicles')
    .set(authHeader(ctx.token))
    .send({ licensePlate: plate, make: 'Maruti', model: 'Swift', customer: customerId });
  expect(res.status).toBe(201);
  return res.body.data._id as string;
};

/** The array as stored, which is exactly what the clients count. */
const vehicleIdsOf = async (customerId: string) => {
  const customer = await Customer.findById(customerId).select('vehicles').lean();
  return (customer?.vehicles ?? []).map(id => id.toString());
};

describe('vehicle ownership', () => {
  it('moves the vehicle between both customers when the owner changes', async () => {
    const ctx = await createGarageWithOwner('veh-move');
    const oldOwner = await makeCustomer(ctx, 'Old Owner');
    const newOwner = await makeCustomer(ctx, 'New Owner');
    const vehicleId = await makeVehicle(ctx, oldOwner, 'KA01AB1111');

    expect(await vehicleIdsOf(oldOwner)).toEqual([vehicleId]);
    expect(await vehicleIdsOf(newOwner)).toEqual([]);

    const res = await request(app)
      .put(`/api/vehicles/${vehicleId}`)
      .set(authHeader(ctx.token))
      .send({ customer: newOwner });
    expect(res.status).toBe(200);

    // Both halves matter: the old owner's count going down is the half that
    // was broken, and the new owner's going up is the half that looked right
    // only because registration had already run.
    expect(await vehicleIdsOf(oldOwner)).toEqual([]);
    expect(await vehicleIdsOf(newOwner)).toEqual([vehicleId]);
  });

  it('leaves the list alone when the update does not touch the owner', async () => {
    const ctx = await createGarageWithOwner('veh-noop');
    const owner = await makeCustomer(ctx, 'Owner');
    const vehicleId = await makeVehicle(ctx, owner, 'KA01AB2222');

    const res = await request(app)
      .put(`/api/vehicles/${vehicleId}`)
      .set(authHeader(ctx.token))
      .send({ color: 'Red' });
    expect(res.status).toBe(200);

    expect(await vehicleIdsOf(owner)).toEqual([vehicleId]);
  });

  /** A repeated save must not add a second copy and inflate the count. */
  it('does not duplicate the vehicle when the same owner is sent twice', async () => {
    const ctx = await createGarageWithOwner('veh-idem');
    const owner = await makeCustomer(ctx, 'Owner');
    const other = await makeCustomer(ctx, 'Other');
    const vehicleId = await makeVehicle(ctx, owner, 'KA01AB3333');

    await request(app).put(`/api/vehicles/${vehicleId}`).set(authHeader(ctx.token)).send({ customer: other });
    await request(app).put(`/api/vehicles/${vehicleId}`).set(authHeader(ctx.token)).send({ customer: other });

    expect(await vehicleIdsOf(other)).toEqual([vehicleId]);
  });

  /**
   * Without the ownership check this would both point the vehicle across a
   * tenant boundary and mutate the other garage's customer document.
   */
  it('refuses to reassign a vehicle to a customer in another garage', async () => {
    const garageA = await createGarageWithOwner('veh-tenant-a');
    const garageB = await createGarageWithOwner('veh-tenant-b');

    const ownerA = await makeCustomer(garageA, 'A Owner');
    const vehicleId = await makeVehicle(garageA, ownerA, 'KA01AB4444');
    const ownerB = await makeCustomer(garageB, 'B Owner');

    const res = await request(app)
      .put(`/api/vehicles/${vehicleId}`)
      .set(authHeader(garageA.token))
      .send({ customer: ownerB });

    expect(res.status).toBe(404);
    expect(await vehicleIdsOf(ownerB)).toEqual([]);
    expect(await vehicleIdsOf(ownerA)).toEqual([vehicleId]);
  });

  it('drops the vehicle from its owner when it is deleted', async () => {
    const ctx = await createGarageWithOwner('veh-del');
    const owner = await makeCustomer(ctx, 'Owner');
    const vehicleId = await makeVehicle(ctx, owner, 'KA01AB5555');

    const res = await request(app).delete(`/api/vehicles/${vehicleId}`).set(authHeader(ctx.token));
    expect(res.status).toBe(200);

    expect(await vehicleIdsOf(owner)).toEqual([]);
  });
});
