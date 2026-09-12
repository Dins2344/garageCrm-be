import { z } from 'zod';
import { appReleases } from '../config/schema';
import { requiredString, optionalString } from '../utils/validation';
import { serializeRow, ApiObject } from '../utils/serialize';

/**
 * Mobile release policy — what the app is told about updates.
 *
 * The second non-tenant table, after `admins`. There is no `garage_id` on
 * purpose: this is platform-wide policy, identical for every tenant, served
 * from a public unauthenticated endpoint. There is no tenant data here, so
 * there is nothing to scope. (`tenant-isolation-auditor` will flag the missing
 * `garage` — this paragraph is the answer.)
 *
 * **One row per platform, `platform` unique.** Not a "first row wins"
 * singleton: a duplicate in a supposedly-one-row table wins by insertion
 * order and is invisible, whereas a unique index is enforced by the database
 * rather than by everyone remembering. It also makes creation an upsert, so
 * "what happens before the row exists" stops being a question, and makes iOS
 * a new row rather than a migration.
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
 *   UPDATE app_releases SET enabled = false WHERE platform = 'android';
 */
export { appReleases };
export type AppReleaseRow = typeof appReleases.$inferSelect;
export type NewAppRelease = typeof appReleases.$inferInsert;

export const PLATFORMS = ['android', 'ios'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const appReleaseSchema = z.object({
  platform: z.enum(PLATFORMS, { error: 'Platform is required' }),
  /** The newest version on the store. Users below this are offered an update. */
  latestVersion: requiredString('Latest version is required'),
  /**
   * Deliberately not required and defaulted to `''`. A policy you cannot clear
   * from the UI is a policy you cannot undo, and this is the field that blocks
   * people.
   */
  minSupportedVersion: optionalString(),
  /**
   * Present for iOS, whose App Store id is assigned by Apple and is not
   * knowable from `app.json`. Android clients deliberately ignore this and use
   * their own compiled-in constant — the store link is the escape hatch when a
   * bad policy has blocked the app, so it must not come from the same row that
   * did the blocking.
   */
  storeUrl: optionalString(),
  updateMessage: optionalString(),
  blockingMessage: optionalString(),
  /** Kill switch. The blocking path requires `enabled === true` explicitly. */
  enabled: z.boolean().default(true),
  /** Email of the admin who last saved, for the audit trail. */
  updatedBy: optionalString()
});

export const appReleaseToApi = (row: AppReleaseRow): ApiObject => serializeRow(row);
