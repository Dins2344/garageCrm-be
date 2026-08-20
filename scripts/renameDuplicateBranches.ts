import 'dotenv/config';
import mongoose from 'mongoose';
import Garage from '../models/Garage';

/**
 * Finds garages sharing {owner, name} — the exact thing the schema's
 * {owner, name} unique index is supposed to prevent, but couldn't enforce
 * because this pre-existing data already violated it (see config/db.ts
 * verifyIndexes — it now logs this loudly on every boot instead of Mongoose
 * silently swallowing the failure). Renames every duplicate after the first
 * (oldest) by appending " (2)", " (3)", etc. Purely a name change — nothing
 * is ever deleted. Once no violating data remains, the index builds cleanly
 * on the next backend restart and the constraint is finally enforced.
 *
 * Usage:
 *   npx tsx scripts/renameDuplicateBranches.ts          # report only
 *   npx tsx scripts/renameDuplicateBranches.ts --fix     # actually rename
 */

const shouldFix = process.argv.includes('--fix');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI as string);

  const dupeGroups = await Garage.aggregate([
    { $sort: { createdAt: 1 } },
    {
      $group: {
        _id: { owner: '$owner', name: '$name' },
        docs: { $push: { id: '$_id', createdAt: '$createdAt' } },
        count: { $sum: 1 }
      }
    },
    { $match: { count: { $gt: 1 } } }
  ]);

  if (dupeGroups.length === 0) {
    console.log('No duplicate {owner, name} branches found.');
    await mongoose.disconnect();
    return;
  }

  console.log(`Found ${dupeGroups.length} duplicate-name group(s):\n`);

  for (const group of dupeGroups) {
    const { owner, name } = group._id as { owner: string; name: string };
    console.log(`  owner=${owner} name="${name}" (${group.count} branches)`);

    // Keep the oldest untouched; rename every later duplicate.
    const [, ...rest] = group.docs as { id: string; createdAt: Date }[];
    for (let i = 0; i < rest.length; i++) {
      const newName = `${name} (${i + 2})`;
      console.log(`    -> ${rest[i].id} renamed to "${newName}"`);
      if (shouldFix) {
        await Garage.findByIdAndUpdate(rest[i].id, { name: newName });
      }
    }
  }

  if (!shouldFix) {
    console.log('\nDry run only — re-run with --fix to actually rename.');
  } else {
    console.log('\nDone. Restart the backend once so the {owner, name} unique index can finally build.');
  }

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Script failed:', err);
  process.exit(1);
});
