import { beforeAll, afterAll, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '../config/schema';
import { setMgDb, MG_MIGRATIONS_FOLDER, MgDb } from '../config/db';
import { setMyGarageEnv, MyGarageEnv } from '../config/env';
import { resetMailCaps } from '../usecases/inviteUsecase';
import { authStore, authSessionStore, userStore, inviteStore } from '../middleware/rateLimit';

export const TEST_ENV: MyGarageEnv = {
  databaseUrl: 'postgresql://unused',
  jwtSecret: 'mygarage_test_jwt_secret_0123456789abcdef',
  masterKey: Buffer.alloc(32, 7),
  googleWebClientId: 'test-client.apps.googleusercontent.com',
  r2: { accountId: 'test', accessKeyId: 'test', secretAccessKey: 'test', bucket: 'test' }
};

/** The real in-process database, for tests that wrap it to inject failures. */
export let testDb: MgDb;

/** Gives a test file its own in-process MyGarage database. Call once at the top level. */
export const useMyGarageDb = (): void => {
  let pglite: PGlite;

  beforeAll(async () => {
    pglite = new PGlite();
    const instance = drizzle(pglite, { schema, casing: 'snake_case' });
    await migrate(instance, { migrationsFolder: MG_MIGRATIONS_FOLDER });
    testDb = instance as unknown as MgDb;
    setMgDb(testDb);
    setMyGarageEnv(TEST_ENV);
  }, 60000);

  afterEach(async () => {
    await authStore.resetAll();
    await authSessionStore.resetAll();
    await userStore.resetAll();
    await inviteStore.resetAll();
    resetMailCaps();
    await pglite.exec('TRUNCATE TABLE users, refresh_tokens, sync_records, cloud_files, shared_garages, garage_members, garage_invites CASCADE');
  });

  afterAll(async () => {
    await pglite.close();
    setMgDb(null);
    setMyGarageEnv(null);
  });
};
