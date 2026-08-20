import 'dotenv/config';
import mongoose from 'mongoose';
import Garage from '../models/Garage';
import User from '../models/User';

/**
 * Diagnostic (and optional repair) for garages left ownerless by the
 * registerNewGarage bug: if User.create() failed after Garage.create() had
 * already succeeded (a validation error, or two concurrent signups racing on
 * the same email), the garage was committed with no `owner` and no way to
 * reach it from the UI. That ordering bug is now fixed in authUsecase.ts —
 * this script is for finding/cleaning up what it already left behind.
 *
 * Read-only by default. Pass --fix to patch the *recoverable* cases: a
 * garage with no `owner` where an owner-role User already points its
 * `garage` field at it (meaning User.create() actually succeeded — only the
 * final `garage.owner = user._id; garage.save()` step never happened).
 * Garages with no such user at all are true orphans with nobody to link to;
 * this script only ever reports those, never deletes anything — that's a
 * judgment call left to whoever runs it.
 *
 * Usage:
 *   npx tsx scripts/findOrphanedGarages.ts          # report only
 *   npx tsx scripts/findOrphanedGarages.ts --fix     # also repair recoverable ones
 */

const shouldFix = process.argv.includes('--fix');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI as string);

  const orphans = await Garage.find({ owner: { $exists: false } })
    .select('_id name phone createdAt')
    .lean();

  if (orphans.length === 0) {
    console.log('No ownerless garages found.');
    await mongoose.disconnect();
    return;
  }

  console.log(`Found ${orphans.length} ownerless garage(s):\n`);

  const recoverable: { garageId: string; userId: string }[] = [];
  const unrecoverable: typeof orphans = [];

  for (const g of orphans) {
    const owner = await User.findOne({ garage: g._id, role: 'owner' }).select('_id name email').lean();
    if (owner) {
      console.log(`  [RECOVERABLE]   ${g._id}  "${g.name}"  (${g.phone})  created ${g.createdAt?.toISOString()}`);
      console.log(`                  -> matching owner user found: ${owner.email} (${owner._id})`);
      recoverable.push({ garageId: String(g._id), userId: String(owner._id) });
    } else {
      console.log(`  [UNRECOVERABLE] ${g._id}  "${g.name}"  (${g.phone})  created ${g.createdAt?.toISOString()}`);
      console.log(`                  -> no user references this garage at all. Registration never completed.`);
      unrecoverable.push(g);
    }
  }

  console.log(`\n${recoverable.length} recoverable, ${unrecoverable.length} unrecoverable.`);

  if (unrecoverable.length > 0) {
    console.log(
      '\nUnrecoverable garages have no owner and no way to identify who tried to register them ' +
      '(their User record never got created). They are unusable dead weight — safe to delete once ' +
      'you\'ve confirmed nothing else references them — but this script will not delete anything itself.'
    );
  }

  if (shouldFix && recoverable.length > 0) {
    console.log(`\nApplying --fix: linking ${recoverable.length} garage(s) to their owner...`);
    for (const { garageId, userId } of recoverable) {
      await Garage.findByIdAndUpdate(garageId, { owner: userId });
      console.log(`  Linked garage ${garageId} -> owner ${userId}`);
    }
    console.log('Done.');
  } else if (recoverable.length > 0) {
    console.log('\nRe-run with --fix to link the recoverable garages to their owners.');
  }

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Script failed:', err);
  process.exit(1);
});
