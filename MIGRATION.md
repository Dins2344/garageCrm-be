# Cutover: MongoDB Atlas to PostgreSQL (Neon)

A one-time procedure. Read it once end to end before starting; every step is
reversible until step 7, and Atlas is never written to.

## What moves and what does not

- **Every document moves with its id.** Ids stay the same 24-hex strings, so
  nothing a client has cached, bookmarked or stored in AsyncStorage changes
  meaning. The API response shapes are unchanged — no web or mobile release
  is needed for this cutover.
- **`Customer.vehicles` and `Vehicle.serviceHistory` are not copied.** They
  are derived from the real relationships now. The script reports every
  customer whose stored array disagreed with the actual vehicles (that is
  the drift bug) — informational only.
- **Passwords move as-is.** They are bcrypt hashes; every user keeps their
  password.

## Before the day

1. **Rehearse against Neon with the real data.** The script only reads
   Atlas, so this is safe to do any time:

   ```bash
   cd backend
   export MONGO_SOURCE_URI='<atlas connection string>'
   export PG_TARGET_URL='<neon DIRECT connection string, not the -pooler one>'

   npx tsx scripts/migrateFromMongo.ts --dry-run    # pre-flight only
   npx tsx scripts/migrateFromMongo.ts              # load + verify
   ```

   Environment variables rather than `--from/--to` flags keep the credentials
   out of the shell history. Use Neon's *direct* endpoint for the script;
   the pooled one is for the app.

2. **Read the pre-flight output.** Two kinds of finding:

   - `ABORT` — the new schema would reject the data (a duplicate branch name
     under one owner, an invoice whose job card is gone, a user whose garage
     does not exist, two customers with the same phone in one garage, an
     empty required field). Fix these in Atlas, then re-run. The script
     writes nothing while any exist. This is where the duplicate "D garage"
     will surface.
   - `Warnings` — migrated with a stated adjustment (ownerless garage kept
     with a null owner, a stale `vehicles` array, a reference to a deleted
     staff member nulled). Read them; none needs action.

3. **Read the verify table** at the end of the load. Every line must say
   `OK`: row counts per table, and per garage the customer count, vehicle
   count, invoice total and job cards by status.

4. **Point a local backend at the migrated copy and look at it:**

   ```bash
   DATABASE_URL='<neon POOLED connection string>' npm run dev
   ```

   Then in the web app (set `VITE_API_URL` to `http://localhost:5000`): log
   in as the production owner, compare the dashboard with the live site,
   open the customers list (vehicle counts), a job card detail, download an
   invoice PDF, open Settings and save one field, open the admin console's
   garages and users pages. Create one job card — its number must continue
   the existing sequence.

5. **Merge the branch.** CI (typecheck + tests on PGlite) must be green.
   Merging to `main` builds and pushes the image and deploys it — so either
   merge at the moment you are ready for step 6, or pause the deploy job
   first. The old image tag stays on Docker Hub for rollback.

## The cutover

Expected downtime: the length of steps 2–4 below, a few minutes.

1. **On EC2, edit `.env.production`:** add `DATABASE_URL=<neon POOLED
   connection string>`. Leave `MONGODB_URI` in place — the old image needs
   it if you roll back.

2. **Write freeze:** `docker compose stop backend`. Both clients show their
   generic network error for the duration.

3. **From your laptop, the real copy:**

   ```bash
   npx tsx scripts/migrateFromMongo.ts --dry-run
   npx tsx scripts/migrateFromMongo.ts --wipe        # replaces the rehearsal copy
   ```

   `--wipe` truncates the rehearsal data first. Read the verify table again.

4. **Deploy the new image.** Merge to `main` (or `workflow_dispatch` the
   deploy workflow). The container applies the schema migrations at boot and
   the health check goes green. If the boot fails, the logs say why and
   nothing has been served.

5. **Smoke test, in this order:** web login, dashboard against the
   screenshot from before step 2, a job card detail, an invoice PDF, mobile
   cold start and login, create one job card and check its number.

6. **Rollback, if anything is wrong:** redeploy the previous image tag with
   the old `.env.production`. Atlas is untouched, so this is a plain
   redeploy.

7. **Retire Atlas after 30 days** of clean running: delete the cluster,
   remove `MONGODB_URI` from `.env.production`.

## After

- `npx tsx scripts/manageAdmin.ts list` (or `node dist/scripts/manageAdmin.js
  list` in the container) confirms the platform admin came across.
- The first request after a quiet period pays Neon's cold start (about a
  second on the free tier). That is expected.
- `scripts/migrateFromMongo.ts` and the `mongodb` dev dependency can be
  deleted once Atlas is gone.
