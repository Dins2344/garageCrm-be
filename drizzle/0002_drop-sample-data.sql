-- The demo dataset seeded at registration during closed testing is retired.
-- Every seeded row was flagged is_sample, so the flag is deleted exactly,
-- garage by garage, before the columns go: leaving the rows unflagged would
-- turn three fabricated customers per garage into apparently real ones with
-- no way to tell them apart. Foreign-key order — reminders and invoices
-- first, then job cards, vehicles, customers. Anything a tester hung off a
-- demo row through the UI (a job card on a demo car) goes with it, whatever
-- its own flag says, since the RESTRICT keys would otherwise refuse.
DELETE FROM "service_reminders" WHERE "vehicle_id" IN (SELECT "id" FROM "vehicles" WHERE "is_sample")
  OR "customer_id" IN (SELECT "id" FROM "customers" WHERE "is_sample");--> statement-breakpoint
DELETE FROM "invoices" WHERE "is_sample"
  OR "vehicle_id" IN (SELECT "id" FROM "vehicles" WHERE "is_sample")
  OR "customer_id" IN (SELECT "id" FROM "customers" WHERE "is_sample");--> statement-breakpoint
DELETE FROM "job_cards" WHERE "is_sample"
  OR "vehicle_id" IN (SELECT "id" FROM "vehicles" WHERE "is_sample")
  OR "customer_id" IN (SELECT "id" FROM "customers" WHERE "is_sample");--> statement-breakpoint
DELETE FROM "vehicles" WHERE "is_sample"
  OR "customer_id" IN (SELECT "id" FROM "customers" WHERE "is_sample");--> statement-breakpoint
DELETE FROM "customers" WHERE "is_sample";--> statement-breakpoint
ALTER TABLE "customers" DROP COLUMN "is_sample";--> statement-breakpoint
ALTER TABLE "invoices" DROP COLUMN "is_sample";--> statement-breakpoint
ALTER TABLE "job_cards" DROP COLUMN "is_sample";--> statement-breakpoint
ALTER TABLE "vehicles" DROP COLUMN "is_sample";
