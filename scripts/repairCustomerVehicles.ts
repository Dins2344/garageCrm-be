import 'dotenv/config';
import mongoose from 'mongoose';
import Customer from '../models/Customer';
import Vehicle from '../models/Vehicle';

/**
 * Diagnostic (and optional repair) for `Customer.vehicles` drifting out of
 * step with the vehicles that actually point at each customer.
 *
 * `Customer.vehicles` is a denormalised array, and both clients render its
 * `.length` as the customer's vehicle count. Registration pushed to it and
 * deletion pulled from it, but `updateVehicleData` did neither — so every time
 * someone changed a vehicle's owner, the vehicle stayed counted against its
 * old owner forever and was never counted against its new one. That is fixed
 * in usecases/vehicleUsecase.ts; this script is for the documents the bug
 * already left behind.
 *
 * `Vehicle.customer` is the source of truth. This recomputes each customer's
 * array from it, which also cleans up ids of vehicles that no longer exist.
 *
 * Read-only by default. Pass --fix to write.
 *
 *   npx tsx scripts/repairCustomerVehicles.ts          # report only
 *   npx tsx scripts/repairCustomerVehicles.ts --fix    # repair
 *
 * In production the image has no tsx and no scripts/ source, so there it is:
 *   docker compose exec backend node dist/scripts/repairCustomerVehicles.js --fix
 */

const shouldFix = process.argv.includes('--fix');

interface Drift {
  customerId: string;
  name: string;
  storedCount: number;
  actualCount: number;
  correct: mongoose.Types.ObjectId[];
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI as string);

  const customers = await Customer.find().select('_id name garage vehicles').lean();
  console.log(`Checking ${customers.length} customer(s)...\n`);

  const drifted: Drift[] = [];

  for (const customer of customers) {
    // Garage-scoped as well as customer-scoped: a vehicle should never point
    // across tenants, and if one somehow does we must not adopt it here.
    const owned = await Vehicle.find({ customer: customer._id, garage: customer.garage })
      .select('_id')
      .lean();

    const correct = owned.map(v => v._id);
    const stored = (customer.vehicles ?? []).map(id => id.toString());
    const expected = correct.map(id => id.toString());

    const same =
      stored.length === expected.length &&
      [...stored].sort().join() === [...expected].sort().join();

    if (!same) {
      drifted.push({
        customerId: customer._id.toString(),
        name: customer.name,
        storedCount: stored.length,
        actualCount: expected.length,
        correct,
      });
    }
  }

  if (drifted.length === 0) {
    console.log('All customer vehicle lists are consistent. Nothing to do.');
    await mongoose.disconnect();
    return;
  }

  console.log(`Found ${drifted.length} customer(s) with a stale vehicle list:\n`);
  for (const d of drifted) {
    const direction = d.storedCount > d.actualCount ? 'over' : 'under';
    console.log(
      `  ${d.name} (${d.customerId}) — shows ${d.storedCount}, should be ${d.actualCount} (${direction}-counted)`
    );
  }

  if (!shouldFix) {
    console.log('\nRead-only run. Re-run with --fix to correct these.');
    await mongoose.disconnect();
    return;
  }

  console.log('\nRepairing...');
  for (const d of drifted) {
    await Customer.updateOne({ _id: d.customerId }, { $set: { vehicles: d.correct } });
    console.log(`  Fixed ${d.name} (${d.customerId}): ${d.storedCount} -> ${d.actualCount}`);
  }

  console.log(`\nDone. Repaired ${drifted.length} customer(s).`);
  await mongoose.disconnect();
}

main().catch(async err => {
  console.error('Repair script failed:', err);
  await mongoose.disconnect();
  process.exit(1);
});
