import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../config/db';
import { garages, users, customers, vehicles } from '../config/schema';
import { newId, isObjectIdHex } from '../utils/ids';
import { isUniqueViolation, isForeignKeyViolation, uniqueViolationField } from '../utils/dbErrors';

/**
 * Proves the pieces everything else stands on: the migrations apply to
 * PGlite, the `db` proxy binds late, relations populate, and the constraints
 * that replaced Mongo's behaviour actually fire.
 */
describe('database harness', () => {
  it('generates 24-hex ids that pass the shape check', () => {
    const id = newId();
    expect(id).toMatch(/^[0-9a-f]{24}$/);
    expect(isObjectIdHex(id)).toBe(true);
    expect(isObjectIdHex('not-an-id')).toBe(false);
    expect(newId()).not.toBe(id);
  });

  it('inserts through the proxy and reads back with a relation', async () => {
    const [garage] = await db.insert(garages).values({ name: 'Harness', phone: '9000000001' }).returning();
    expect(garage._id).toMatch(/^[0-9a-f]{24}$/);

    const [owner] = await db.insert(users).values({
      name: 'Owner', email: 'harness@example.com', phone: '9000000002', password: 'x', role: 'owner', garageId: garage._id
    }).returning();
    await db.update(garages).set({ ownerId: owner._id }).where(eq(garages._id, garage._id));

    const found = await db.query.garages.findFirst({
      where: eq(garages._id, garage._id),
      with: { owner: { columns: { _id: true, name: true } } }
    });
    expect(found?.owner).toEqual({ _id: owner._id, name: 'Owner' });
    expect(found?.settings.taxRate).toBe(18);
  });

  it('enforces the tenant-scoped unique index and the restrict foreign key', async () => {
    const [garage] = await db.insert(garages).values({ name: 'Harness', phone: '9000000001' }).returning();
    await db.insert(customers).values({ name: 'A', phone: '111', garageId: garage._id });

    // Drizzle wraps the driver error; the helpers unwrap `cause`.
    const dup = await db.insert(customers).values({ name: 'B', phone: '111', garageId: garage._id }).catch(e => e);
    expect(isUniqueViolation(dup)).toBe(true);
    expect(isUniqueViolation(dup, 'customers_garage_phone_unique')).toBe(true);
    expect(uniqueViolationField(dup)).toBe('phone');

    const [customer] = await db.select().from(customers).where(eq(customers.garageId, garage._id));
    await db.insert(vehicles).values({ licensePlate: 'KA01', make: 'M', model: 'X', customerId: customer._id, garageId: garage._id });

    const blocked = await db.delete(customers).where(eq(customers._id, customer._id)).catch(e => e);
    expect(isForeignKeyViolation(blocked)).toBe(true);
  });

  it('touches updatedAt on update', async () => {
    const [garage] = await db.insert(garages).values({ name: 'Harness', phone: '9000000001' }).returning();
    await new Promise(r => setTimeout(r, 5));
    const [updated] = await db.update(garages).set({ name: 'Renamed' }).where(eq(garages._id, garage._id)).returning();
    expect(updated.updatedAt.getTime()).toBeGreaterThan(garage.updatedAt.getTime());
  });
});
