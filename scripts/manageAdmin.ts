import 'dotenv/config';
import crypto from 'crypto';
import mongoose from 'mongoose';
import Admin from '../models/Admin';

/**
 * Create, rotate and deactivate platform super-admins.
 *
 * Admin credentials used to be environment variables with hardcoded fallbacks
 * in `usecases/adminUsecase.ts` — anyone who could read the source knew the
 * default password of any deployment that had not overridden it. They now live
 * in the `admins` collection as bcrypt hashes, and this is the only way to put
 * one there.
 *
 * There is deliberately no HTTP endpoint and no auto-seed at boot. Creating a
 * platform-wide account should require shell access to the environment, and an
 * auto-seed reading from env would reintroduce exactly the problem this
 * replaced.
 *
 * Usage:
 *   npx tsx scripts/manageAdmin.ts list
 *   npx tsx scripts/manageAdmin.ts create <email> "<Full Name>" [password]
 *   npx tsx scripts/manageAdmin.ts reset-password <email> [password]
 *   npx tsx scripts/manageAdmin.ts deactivate <email>
 *   npx tsx scripts/manageAdmin.ts activate <email>
 *
 * Omit the password and one is generated and printed once. It is not stored
 * anywhere in plaintext and cannot be recovered — only reset.
 */

const MIN_PASSWORD_LENGTH = 12;

/** URL-safe, 24 bytes of entropy. Printed once, never persisted in the clear. */
function generatePassword(): string {
  return crypto.randomBytes(24).toString('base64url');
}

function usage(): never {
  console.log(`
Manage platform super-admins.

  list                                    Show all admins
  create <email> "<Full Name>" [password] Create a new admin
  reset-password <email> [password]       Set a new password
  deactivate <email>                      Revoke access (takes effect immediately)
  activate <email>                        Restore access

Passwords must be at least ${MIN_PASSWORD_LENGTH} characters. Omit to generate one.
`);
  process.exit(1);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command) usage();

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set.');
    process.exit(1);
  }
  await mongoose.connect(uri);

  switch (command) {
    case 'list': {
      const admins = await Admin.find().select('name email isActive lastLoginAt createdAt').sort({ createdAt: 1 }).lean();
      if (admins.length === 0) {
        console.log('No admins exist. Admin login will reject every attempt until one is created.');
        break;
      }
      console.log(`${admins.length} admin(s):\n`);
      for (const a of admins) {
        const state = a.isActive ? 'active' : 'DEACTIVATED';
        const seen = a.lastLoginAt ? new Date(a.lastLoginAt).toISOString() : 'never';
        console.log(`  ${a.email.padEnd(34)} ${state.padEnd(12)} last login: ${seen}`);
      }
      break;
    }

    case 'create': {
      const [email, name, supplied] = args;
      if (!email || !name) usage();

      const existing = await Admin.findOne({ email: email.toLowerCase().trim() });
      if (existing) {
        console.error(`An admin with email ${email} already exists. Use reset-password to change it.`);
        process.exit(1);
      }

      const password = supplied || generatePassword();
      if (password.length < MIN_PASSWORD_LENGTH) {
        console.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
        process.exit(1);
      }

      // Hashed by the model's pre-save hook.
      const admin = await Admin.create({ email, name, password });
      console.log(`Created admin ${admin.email} (${admin.name}).`);
      if (!supplied) {
        console.log(`\n  Password: ${password}\n`);
        console.log('Store it now. It is hashed in the database and cannot be recovered.');
      }
      break;
    }

    case 'reset-password': {
      const [email, supplied] = args;
      if (!email) usage();

      const admin = await Admin.findOne({ email: email.toLowerCase().trim() });
      if (!admin) {
        console.error(`No admin with email ${email}.`);
        process.exit(1);
      }

      const password = supplied || generatePassword();
      if (password.length < MIN_PASSWORD_LENGTH) {
        console.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
        process.exit(1);
      }

      // Assign and save (not updateOne) so the pre-save hash hook runs.
      admin.password = password;
      await admin.save();
      console.log(`Password reset for ${admin.email}.`);
      if (!supplied) {
        console.log(`\n  Password: ${password}\n`);
        console.log('Store it now. It is hashed in the database and cannot be recovered.');
      }
      console.log('Existing sessions remain valid until their tokens expire (max 4h).');
      break;
    }

    case 'deactivate':
    case 'activate': {
      const [email] = args;
      if (!email) usage();

      const isActive = command === 'activate';
      const admin = await Admin.findOneAndUpdate(
        { email: email.toLowerCase().trim() },
        { $set: { isActive } },
        { new: true }
      );
      if (!admin) {
        console.error(`No admin with email ${email}.`);
        process.exit(1);
      }
      console.log(`${admin.email} is now ${isActive ? 'active' : 'deactivated'}.`);
      if (!isActive) {
        console.log('Access is revoked immediately — live sessions are rejected on their next request.');
      }
      break;
    }

    default:
      usage();
  }

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Script failed:', err);
  process.exit(1);
});
