import { defineConfig } from 'drizzle-kit';

/**
 * Used only by `npx drizzle-kit generate`, which diffs `config/schema.ts`
 * against the SQL already in `drizzle/` and writes the next migration file.
 * Commit that SQL — `config/db.ts` applies it at boot and the test harness
 * applies it to PGlite. `DATABASE_URL` is only needed for `drizzle-kit
 * studio`/`push`, neither of which this project uses.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './config/schema.ts',
  out: './drizzle',
  casing: 'snake_case',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgresql://unused'
  }
});
