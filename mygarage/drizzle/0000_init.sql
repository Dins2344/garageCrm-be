CREATE SEQUENCE "public"."sync_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "cloud_files" (
	"user_id" text NOT NULL,
	"file_id" text NOT NULL,
	"size" integer NOT NULL,
	"status" text NOT NULL,
	"uploaded_at" timestamp with time zone,
	CONSTRAINT "cloud_files_user_id_file_id_pk" PRIMARY KEY("user_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_records" (
	"user_id" text NOT NULL,
	"tbl" text NOT NULL,
	"id" text NOT NULL,
	"updated_at" bigint NOT NULL,
	"deleted_at" bigint,
	"payload" text NOT NULL,
	"seq" bigint DEFAULT nextval('sync_seq') NOT NULL,
	CONSTRAINT "sync_records_user_id_tbl_id_pk" PRIMARY KEY("user_id","tbl","id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"google_sub" text NOT NULL,
	"email" text NOT NULL,
	"wrapped_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_googleSub_unique" UNIQUE("google_sub")
);
--> statement-breakpoint
ALTER TABLE "cloud_files" ADD CONSTRAINT "cloud_files_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_records" ADD CONSTRAINT "sync_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sync_records_user_id_seq_index" ON "sync_records" USING btree ("user_id","seq");