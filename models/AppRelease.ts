import mongoose, { Document, Schema, Types } from 'mongoose';

/**
 * Mobile release policy — what the app is told about updates.
 *
 * The second non-tenant model, after `Admin.ts`. There is no `garage` field on
 * purpose: this is platform-wide policy, identical for every tenant, served
 * from a public unauthenticated endpoint. There is no tenant data here, so
 * there is nothing to scope. (`tenant-isolation-auditor` will flag the missing
 * `garage` — this paragraph is the answer.)
 *
 * **One document per platform, `platform` unique.** Not a `findOne({})`
 * singleton: a duplicate in a supposedly-one-row collection wins by insertion
 * order and is invisible, whereas a unique index is enforced by the database
 * rather than by everyone remembering. It also makes creation an `upsert`, so
 * "what happens before the document exists" stops being a question, and makes
 * iOS a new document rather than a migration.
 *
 * **ABSENCE MEANS NOTHING IS BLOCKED.** There is deliberately no seed script
 * and no default for `minSupportedVersion` — every non-empty default is a
 * default that blocks somebody. A fresh deploy prompts nobody and blocks
 * nobody until an admin says otherwise.
 *
 * **RECOVERY.** If a bad policy blocks the field, set `enabled: false` from
 * the admin console's App Release page, or clear `minSupportedVersion`. Either
 * takes effect on each device's next launch *or resume* — the app forces a
 * re-check on resume while it is blocked, precisely so a rollback does not
 * have to wait for a cold start. With the console itself down:
 *
 *   db.appreleases.updateOne({ platform: 'android' }, { $set: { enabled: false } })
 */
export interface IAppRelease extends Document {
  _id: Types.ObjectId;
  platform: 'android' | 'ios';
  /** The newest version on the store. Users below this are offered an update. */
  latestVersion: string;
  /** Users below this are blocked. `''` means nobody is blocked — the undo path. */
  minSupportedVersion: string;
  /** Store listing. Android clients use their own compiled-in constant; see below. */
  storeUrl: string;
  updateMessage: string;
  blockingMessage: string;
  /** Kill switch. The blocking path requires `enabled === true` explicitly. */
  enabled: boolean;
  /** Email of the admin who last saved, for the audit trail. */
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const appReleaseSchema = new Schema<IAppRelease>({
  platform: {
    type: String,
    enum: ['android', 'ios'],
    required: [true, 'Platform is required'],
    unique: true
  },
  latestVersion: {
    type: String,
    required: [true, 'Latest version is required'],
    trim: true
  },
  /**
   * Deliberately not required and defaulted to `''`. A policy you cannot clear
   * from the UI is a policy you cannot undo, and this is the field that blocks
   * people.
   */
  minSupportedVersion: {
    type: String,
    default: '',
    trim: true
  },
  /**
   * Present for iOS, whose App Store id is assigned by Apple and is not
   * knowable from `app.json`. Android clients deliberately ignore this and use
   * their own compiled-in constant — the store link is the escape hatch when a
   * bad policy has blocked the app, so it must not come from the same document
   * that did the blocking.
   */
  storeUrl: {
    type: String,
    default: '',
    trim: true
  },
  updateMessage: {
    type: String,
    default: '',
    trim: true
  },
  blockingMessage: {
    type: String,
    default: '',
    trim: true
  },
  enabled: {
    type: Boolean,
    default: true
  },
  updatedBy: {
    type: String,
    default: '',
    trim: true
  }
}, {
  timestamps: true
});

export default mongoose.model<IAppRelease>('AppRelease', appReleaseSchema);
