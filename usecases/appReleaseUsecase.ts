import AppRelease, { IAppRelease } from '../models/AppRelease';
import { compareVersions, isOlderThan, parseVersion } from '../utils/semver';
import { HttpError } from '../utils/httpError';
import logger from '../utils/logger';

const log = logger.child('AppReleaseUsecase');

const PLATFORMS = ['android', 'ios'] as const;
type Platform = (typeof PLATFORMS)[number];

const isPlatform = (v: string): v is Platform => (PLATFORMS as readonly string[]).includes(v);

/**
 * What the mobile app is told on `GET /meta/app-update`.
 *
 * **Every field is always present.** Never omitted, never null. Two client
 * generations read a sometimes-absent field differently, and published builds
 * cannot be force-upgraded (backend/CLAUDE.md non-negotiable #2).
 */
export interface AppUpdateDecision {
  updateAvailable: boolean;
  updateRequired: boolean;
  latestVersion: string;
  storeUrl: string;
  message: string;
  /** Echoed back so a client can detect a cached or misrouted response. */
  receivedVersion: string;
}

const noUpdate = (receivedVersion: string): AppUpdateDecision => ({
  updateAvailable: false,
  updateRequired: false,
  latestVersion: '',
  storeUrl: '',
  message: '',
  receivedVersion
});

interface DecisionInput {
  platform: string;
  version: string;
}

/**
 * Decide what a given app build should be told.
 *
 * Every branch that is not a confident "yes, this build is out of date" exits
 * to `noUpdate`. This runs on every cold start of every device in the field; a
 * wrong answer in the blocking direction cannot be taken back, because the
 * people it blocks are the ones who can no longer be reached.
 */
export const getUpdateDecision = async ({ platform, version }: DecisionInput): Promise<AppUpdateDecision> => {
  if (!isPlatform(platform)) {
    return noUpdate(version);
  }

  /**
   * An unusable version is "no opinion", not "very old".
   *
   * Treating it as old would block every runtime that cannot report its
   * version — and updating does not fix a broken version read, so the user
   * would have no way out. Logged so a broken client generation is visible.
   *
   * This is a 200, not a 400. The client has to fail open either way, so both
   * produce the same user outcome — but a 400 invites a future implementer to
   * "handle it properly", which is how a fail-closed branch gets written.
   */
  if (parseVersion(version) === null) {
    log.warn('App update check with an unusable version', { platform, version });
    return noUpdate(version);
  }

  const policy = await AppRelease.findOne({ platform }).lean<IAppRelease | null>();
  if (!policy) {
    return noUpdate(version);
  }

  // Explicit positive check: a missing or odd value falls to "not blocking"
  // rather than being read leniently as on.
  if (policy.enabled !== true) {
    return noUpdate(version);
  }

  const updateAvailable = isOlderThan(version, policy.latestVersion);
  const updateRequired =
    policy.minSupportedVersion !== '' && isOlderThan(version, policy.minSupportedVersion);

  if (updateRequired) {
    log.warn('Serving a mandatory-update decision', {
      platform, version, minSupportedVersion: policy.minSupportedVersion
    });
  }

  return {
    updateAvailable,
    updateRequired,
    latestVersion: policy.latestVersion,
    storeUrl: policy.storeUrl,
    message: updateRequired ? policy.blockingMessage : updateAvailable ? policy.updateMessage : '',
    receivedVersion: version
  };
};

/**
 * The policy as stored, for the admin console.
 *
 * `null` is not a 404: "no policy yet" is a normal state that the form has to
 * render and create from.
 */
export const getReleasePolicy = async (platform: string) => {
  if (!isPlatform(platform)) {
    throw new HttpError('Unknown platform', 400);
  }
  return AppRelease.findOne({ platform }).lean<IAppRelease | null>();
};

interface SaveInput {
  platform: string;
  latestVersion: string;
  minSupportedVersion: string;
  storeUrl: string;
  updateMessage: string;
  blockingMessage: string;
  enabled: boolean;
  updatedBy: string;
}

export const saveReleasePolicy = async (input: SaveInput) => {
  const {
    platform, latestVersion, minSupportedVersion, storeUrl,
    updateMessage, blockingMessage, enabled, updatedBy
  } = input;

  if (!isPlatform(platform)) {
    throw new HttpError('Unknown platform', 400);
  }
  if (parseVersion(latestVersion) === null) {
    throw new HttpError('Latest version must look like 1.2.3', 400);
  }
  if (minSupportedVersion !== '' && parseVersion(minSupportedVersion) === null) {
    throw new HttpError('Minimum supported version must look like 1.2.3, or be left blank', 400);
  }

  /**
   * The most important line in this feature.
   *
   * A minimum above the latest available version blocks 100% of the field
   * instantly — including anyone already on the newest build, who then has
   * nothing to update to.
   */
  if (minSupportedVersion !== '' && compareVersions(minSupportedVersion, latestVersion) === 1) {
    throw new HttpError(
      'Minimum supported version cannot be newer than the latest version. That would block every user, including anyone already on the newest build.',
      400
    );
  }

  // Even though Android clients ignore this and use their own constant, a
  // future client or the console itself may follow it.
  if (storeUrl !== '' && !storeUrl.startsWith('https://')) {
    throw new HttpError('Store URL must start with https://', 400);
  }
  if (typeof enabled !== 'boolean') {
    throw new HttpError('Enabled must be true or false', 400);
  }

  /**
   * `upsert` with a full `$set`, matching the PUT semantics: the admin's form
   * owns every field. A partial update on a document whose most dangerous
   * field is `minSupportedVersion` invites "the field I omitted kept its old
   * value".
   */
  const saved = await AppRelease.findOneAndUpdate(
    { platform },
    {
      $set: {
        latestVersion, minSupportedVersion, storeUrl,
        updateMessage, blockingMessage, enabled, updatedBy
      }
    },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  ).lean<IAppRelease>();

  // `warn`, not `info`: a platform-wide change that affects every device in
  // the field belongs beside the delete endpoints in the audit trail.
  log.warn('Admin changed the mobile release policy', {
    admin: updatedBy, platform, latestVersion, minSupportedVersion, enabled
  });

  return saved;
};
