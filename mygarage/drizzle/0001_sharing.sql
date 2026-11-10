CREATE TABLE "garage_invites" (
	"id" text PRIMARY KEY NOT NULL,
	"garage_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"token_hash" text NOT NULL,
	"garage_name" text NOT NULL,
	"inviter_name" text NOT NULL,
	"status" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "garage_invites_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "garage_members" (
	"garage_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "garage_members_garage_id_user_id_pk" PRIMARY KEY("garage_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "shared_garages" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"wrapped_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "sync_records_user_id_seq_index";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "cloud_files" ADD COLUMN "scope" text;--> statement-breakpoint
ALTER TABLE "cloud_files" ADD COLUMN "owner_id" text;--> statement-breakpoint
ALTER TABLE "sync_records" ADD COLUMN "scope" text;--> statement-breakpoint
ALTER TABLE "sync_records" ADD COLUMN "writer_id" text;--> statement-breakpoint
UPDATE "cloud_files" SET "scope" = 'u:' || "user_id", "owner_id" = "user_id";--> statement-breakpoint
UPDATE "sync_records" SET "scope" = 'u:' || "user_id", "writer_id" = "user_id";--> statement-breakpoint
ALTER TABLE "cloud_files" ALTER COLUMN "scope" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "cloud_files" ALTER COLUMN "owner_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sync_records" ALTER COLUMN "scope" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "cloud_files" DROP CONSTRAINT "cloud_files_user_id_file_id_pk";--> statement-breakpoint
ALTER TABLE "sync_records" DROP CONSTRAINT "sync_records_user_id_tbl_id_pk";--> statement-breakpoint
ALTER TABLE "cloud_files" DROP COLUMN "user_id";--> statement-breakpoint
ALTER TABLE "sync_records" DROP COLUMN "user_id";--> statement-breakpoint
ALTER TABLE "cloud_files" ADD CONSTRAINT "cloud_files_scope_file_id_pk" PRIMARY KEY("scope","file_id");--> statement-breakpoint
ALTER TABLE "sync_records" ADD CONSTRAINT "sync_records_scope_tbl_id_pk" PRIMARY KEY("scope","tbl","id");--> statement-breakpoint
ALTER TABLE "garage_invites" ADD CONSTRAINT "garage_invites_garage_id_shared_garages_id_fk" FOREIGN KEY ("garage_id") REFERENCES "public"."shared_garages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "garage_members" ADD CONSTRAINT "garage_members_garage_id_shared_garages_id_fk" FOREIGN KEY ("garage_id") REFERENCES "public"."shared_garages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "garage_members" ADD CONSTRAINT "garage_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_garages" ADD CONSTRAINT "shared_garages_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "garage_invites_email_status_index" ON "garage_invites" USING btree ("email","status");--> statement-breakpoint
CREATE INDEX "garage_invites_garage_id_index" ON "garage_invites" USING btree ("garage_id");--> statement-breakpoint
CREATE INDEX "garage_members_user_id_index" ON "garage_members" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "cloud_files" ADD CONSTRAINT "cloud_files_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_records" ADD CONSTRAINT "sync_records_writer_id_users_id_fk" FOREIGN KEY ("writer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cloud_files_owner_id_index" ON "cloud_files" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "sync_records_scope_seq_index" ON "sync_records" USING btree ("scope","seq");