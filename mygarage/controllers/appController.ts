import { Request, Response } from 'express';

export type VersionRule = { minVersionCode: number; blockedVersionCodes: number[] };

const code = (s: string): number | null => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : null);

/**
 * Which app builds must update, from MYGARAGE_MIN_VERSION_CODE (everything below it) and
 * MYGARAGE_BLOCKED_VERSION_CODES (a comma list of single bad builds). Unset or unreadable values block nothing.
 */
export const parseVersionRule = (source: NodeJS.ProcessEnv): VersionRule => ({
  minVersionCode: code(source.MYGARAGE_MIN_VERSION_CODE ?? '') ?? 0,
  blockedVersionCodes: (source.MYGARAGE_BLOCKED_VERSION_CODES ?? '').split(',').map(code).filter((n): n is number => n !== null)
});

/** Public and database-free, so the app can check it signed out and while sync is unavailable. Read per request: a restart applies a change. */
export const versionRule = (_req: Request, res: Response): void => {
  res.json({ success: true, data: { ...parseVersionRule(process.env), referrals: process.env.MYGARAGE_REFERRALS === 'true' } });
};
