import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, schema, countRows } from './helpers/dbAccess';
import { createGarageWithOwner } from './helpers/factories';
import { isUniqueViolation } from '../utils/dbErrors';

/** The partial unique index is what makes "one pending request per item and type" hold under a race. */
describe('change_requests table', () => {
  const base = async (suffix: string) => {
    const g = await createGarageWithOwner(suffix);
    return {
      garageId: g.garageId,
      type: 'job_card_cancellation' as const,
      targetType: 'job_card' as const,
      targetId: 'a'.repeat(24),
      requestedById: g.userId
    };
  };

  it('refuses a second pending request for the same item and type', async () => {
    const row = await base('crs-dup');
    await db.insert(schema.changeRequests).values(row);

    const err = await db.insert(schema.changeRequests).values(row).then(() => null, (e: unknown) => e);

    expect(isUniqueViolation(err, 'change_requests_one_pending')).toBe(true);
  });

  it('allows a new pending request once the earlier one is decided', async () => {
    const row = await base('crs-decided');
    await db.insert(schema.changeRequests).values({ ...row, status: 'rejected' });
    await db.insert(schema.changeRequests).values(row);

    expect(await countRows(schema.changeRequests, eq(schema.changeRequests.targetId, row.targetId))).toBe(2);
  });

  it('allows pending requests of different types for the same item', async () => {
    const row = await base('crs-types');
    await db.insert(schema.changeRequests).values(row);
    await db.insert(schema.changeRequests).values({ ...row, type: 'odometer_correction' });

    expect(await countRows(schema.changeRequests, eq(schema.changeRequests.targetId, row.targetId))).toBe(2);
  });
});
