import 'dotenv/config';
import mongoose from 'mongoose';
import Garage from '../models/Garage';
import { DEFAULT_COUNTRY } from '../config/countries';

/**
 * Stamps `country` onto garages created before the field existed.
 *
 * This is TIDY-UP, NOT A CUTOVER. utils/locale.ts resolves a missing country
 * to the default already, so every pre-existing garage behaves correctly the
 * moment the backend deploys — with or without this script. Running it just
 * makes the data explicit (and lets a future `country` query filter work).
 *
 * Safety properties:
 *  - Only touches documents where `country` does not exist. Never overwrites.
 *  - Idempotent: a second run reports 0.
 *  - Does NOT backfill settings.currency/locale/taxLabel/timezone — those
 *    stay empty so they keep inheriting from config/countries.ts, which is
 *    what makes a table correction reach every garage.
 *
 * Usage:
 *   npx tsx scripts/backfillGarageCountry.ts          # report only
 *   npx tsx scripts/backfillGarageCountry.ts --fix     # apply
 */

const shouldFix = process.argv.includes('--fix');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI as string);

  const total = await Garage.countDocuments();
  const missing = await Garage.countDocuments({ country: { $exists: false } });

  console.log(`Garages total:            ${total}`);
  console.log(`Missing \`country\`:        ${missing}`);
  console.log(`Would be set to:          ${DEFAULT_COUNTRY}`);

  if (missing === 0) {
    console.log('\nNothing to backfill.');
    await mongoose.disconnect();
    return;
  }

  const sample = await Garage.find({ country: { $exists: false } })
    .select('_id name createdAt')
    .sort({ createdAt: 1 })
    .limit(10)
    .lean();

  console.log('\nSample (oldest first):');
  sample.forEach(g => console.log(`  ${g._id}  "${g.name}"  ${g.createdAt?.toISOString()}`));
  if (missing > sample.length) console.log(`  ... and ${missing - sample.length} more`);

  if (!shouldFix) {
    console.log('\nDry run only — re-run with --fix to apply.');
    await mongoose.disconnect();
    return;
  }

  const res = await Garage.updateMany(
    { country: { $exists: false } },
    { $set: { country: DEFAULT_COUNTRY } }
  );
  console.log(`\nUpdated ${res.modifiedCount} garage(s) to country=${DEFAULT_COUNTRY}.`);

  const remaining = await Garage.countDocuments({ country: { $exists: false } });
  console.log(remaining === 0
    ? 'Verified: no garages left without a country.'
    : `WARNING: ${remaining} still missing a country — investigate.`);

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Script failed:', err);
  process.exit(1);
});
