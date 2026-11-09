import { defineConfig } from 'drizzle-kit';

/** Used only by `npx drizzle-kit generate --config mygarage/drizzle.config.ts`. */
export default defineConfig({
  dialect: 'postgresql',
  schema: './mygarage/config/schema.ts',
  out: './mygarage/drizzle',
  casing: 'snake_case',
  dbCredentials: {
    url: process.env.MYGARAGE_DATABASE_URL || 'postgresql://unused'
  }
});
