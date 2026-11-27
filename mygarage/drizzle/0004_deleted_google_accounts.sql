CREATE TABLE "deleted_google_accounts" (
	"sub_hash" text PRIMARY KEY NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL
);
