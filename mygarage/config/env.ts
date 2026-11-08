import logger from '../../utils/logger';

const log = logger.child('MyGarage');

export type MyGarageEnv = {
  databaseUrl: string;
  jwtSecret: string;
  masterKey: Buffer;
  googleWebClientId: string;
  r2: { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string };
};

const REQUIRED = [
  'MYGARAGE_DATABASE_URL', 'MYGARAGE_JWT_SECRET', 'MYGARAGE_MASTER_KEY', 'MYGARAGE_GOOGLE_WEB_CLIENT_ID',
  'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'
] as const;

/**
 * Reads and validates every MyGarage setting. Returns null (after naming the
 * offending variable, never its value) so a bad setting turns MyGarage off
 * instead of stopping GaragePulse.
 */
export const loadMyGarageEnv = (source: NodeJS.ProcessEnv = process.env): MyGarageEnv | null => {
  for (const name of REQUIRED) {
    if (!source[name]) {
      log.warn('MyGarage is off: a setting is missing', { variable: name });
      return null;
    }
  }
  const get = (name: (typeof REQUIRED)[number]): string => source[name] as string;

  const jwtSecret = get('MYGARAGE_JWT_SECRET');
  if (jwtSecret.length < 32 || jwtSecret === source.JWT_SECRET || jwtSecret === source.SUPER_ADMIN_SECRET) {
    log.warn('MyGarage is off: a setting is invalid', { variable: 'MYGARAGE_JWT_SECRET' });
    return null;
  }

  const masterKey = Buffer.from(get('MYGARAGE_MASTER_KEY'), 'base64');
  if (masterKey.length !== 32) {
    log.warn('MyGarage is off: a setting is invalid', { variable: 'MYGARAGE_MASTER_KEY' });
    return null;
  }

  return {
    databaseUrl: get('MYGARAGE_DATABASE_URL'),
    jwtSecret,
    masterKey,
    googleWebClientId: get('MYGARAGE_GOOGLE_WEB_CLIENT_ID'),
    r2: {
      accountId: get('R2_ACCOUNT_ID'),
      accessKeyId: get('R2_ACCESS_KEY_ID'),
      secretAccessKey: get('R2_SECRET_ACCESS_KEY'),
      bucket: get('R2_BUCKET')
    }
  };
};

let current: MyGarageEnv | null = null;

export const setMyGarageEnv = (env: MyGarageEnv | null): void => {
  current = env;
};

export const getMyGarageEnv = (): MyGarageEnv => {
  if (!current) throw new Error('MyGarage settings are not loaded');
  return current;
};

export const hasMyGarageEnv = (): boolean => current !== null;
