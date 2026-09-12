CREATE TABLE "admins" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_releases" (
	"id" text PRIMARY KEY NOT NULL,
	"platform" text NOT NULL,
	"latest_version" text NOT NULL,
	"min_supported_version" text DEFAULT '' NOT NULL,
	"store_url" text DEFAULT '' NOT NULL,
	"update_message" text DEFAULT '' NOT NULL,
	"blocking_message" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"address" jsonb DEFAULT '{"street":"","city":"","state":"","pincode":""}'::jsonb NOT NULL,
	"garage_id" text NOT NULL,
	"total_visits" double precision DEFAULT 0 NOT NULL,
	"total_spent" double precision DEFAULT 0 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "garages" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"country" text DEFAULT 'IN' NOT NULL,
	"address" jsonb DEFAULT '{"street":"","city":"","state":"","pincode":""}'::jsonb NOT NULL,
	"phone" text NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"gst_number" text DEFAULT '' NOT NULL,
	"logo" text DEFAULT '' NOT NULL,
	"owner_id" text,
	"settings" jsonb DEFAULT '{"currency":"","locale":"","taxLabel":"","timezone":"","taxRate":18,"laborRatePerHour":500,"serviceReminderDays":180}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory" (
	"id" text PRIMARY KEY NOT NULL,
	"part_name" text NOT NULL,
	"part_number" text DEFAULT '' NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"quantity" double precision DEFAULT 0 NOT NULL,
	"threshold" double precision DEFAULT 5 NOT NULL,
	"unit_price" double precision NOT NULL,
	"selling_price" double precision DEFAULT 0 NOT NULL,
	"supplier" jsonb DEFAULT '{"name":"","phone":"","email":""}'::jsonb NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"garage_id" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_number" text NOT NULL,
	"job_card_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"vehicle_id" text NOT NULL,
	"garage_id" text NOT NULL,
	"parts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"labor" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subtotal" double precision DEFAULT 0 NOT NULL,
	"tax_rate" double precision DEFAULT 18 NOT NULL,
	"tax_amount" double precision DEFAULT 0 NOT NULL,
	"discount" double precision DEFAULT 0 NOT NULL,
	"grand_total" double precision DEFAULT 0 NOT NULL,
	"payment_status" text DEFAULT 'unpaid' NOT NULL,
	"payment_method" text DEFAULT '' NOT NULL,
	"amount_paid" double precision DEFAULT 0 NOT NULL,
	"paid_at" timestamp with time zone,
	"notes" text DEFAULT '' NOT NULL,
	"created_by_id" text,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_cards" (
	"id" text PRIMARY KEY NOT NULL,
	"service_type" text NOT NULL,
	"job_card_number" text NOT NULL,
	"vehicle_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"garage_id" text NOT NULL,
	"complaints" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"photos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assigned_mechanic_id" text,
	"assigned_advisor_id" text,
	"status" text DEFAULT 'new' NOT NULL,
	"status_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"estimation" jsonb DEFAULT '{"parts":[],"labor":[],"subtotal":0,"taxRate":18,"taxAmount":0,"discount":0,"grandTotal":0,"approvedByCustomer":false,"approvedAt":null,"sentAt":null}'::jsonb NOT NULL,
	"odometer_at_intake" double precision NOT NULL,
	"expected_delivery_date" timestamp with time zone,
	"actual_delivery_date" timestamp with time zone,
	"internal_notes" text DEFAULT '' NOT NULL,
	"invoice_id" text,
	"created_by_id" text,
	"estimation_token" text,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_reminders" (
	"id" text PRIMARY KEY NOT NULL,
	"vehicle_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"garage_id" text NOT NULL,
	"job_card_id" text,
	"type" text DEFAULT 'periodic_service' NOT NULL,
	"next_service_date" timestamp with time zone NOT NULL,
	"next_service_km" double precision DEFAULT 0 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reminder_sent_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"password" text NOT NULL,
	"role" text DEFAULT 'mechanic' NOT NULL,
	"garage_id" text NOT NULL,
	"avatar" text DEFAULT '' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"reset_password_token" text,
	"reset_password_expire" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" text PRIMARY KEY NOT NULL,
	"license_plate" text NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"year" integer,
	"color" text DEFAULT '' NOT NULL,
	"fuel_type" text DEFAULT 'petrol' NOT NULL,
	"vin" text DEFAULT '' NOT NULL,
	"engine_number" text DEFAULT '' NOT NULL,
	"current_odometer_reading" double precision DEFAULT 0 NOT NULL,
	"customer_id" text NOT NULL,
	"garage_id" text NOT NULL,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_garage_id_garages_id_fk" FOREIGN KEY ("garage_id") REFERENCES "public"."garages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "garages" ADD CONSTRAINT "garages_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_garage_id_garages_id_fk" FOREIGN KEY ("garage_id") REFERENCES "public"."garages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_job_card_id_job_cards_id_fk" FOREIGN KEY ("job_card_id") REFERENCES "public"."job_cards"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_garage_id_garages_id_fk" FOREIGN KEY ("garage_id") REFERENCES "public"."garages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_garage_id_garages_id_fk" FOREIGN KEY ("garage_id") REFERENCES "public"."garages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_assigned_mechanic_id_users_id_fk" FOREIGN KEY ("assigned_mechanic_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_assigned_advisor_id_users_id_fk" FOREIGN KEY ("assigned_advisor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_reminders" ADD CONSTRAINT "service_reminders_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_reminders" ADD CONSTRAINT "service_reminders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_reminders" ADD CONSTRAINT "service_reminders_garage_id_garages_id_fk" FOREIGN KEY ("garage_id") REFERENCES "public"."garages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_reminders" ADD CONSTRAINT "service_reminders_job_card_id_job_cards_id_fk" FOREIGN KEY ("job_card_id") REFERENCES "public"."job_cards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_garage_id_garages_id_fk" FOREIGN KEY ("garage_id") REFERENCES "public"."garages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_garage_id_garages_id_fk" FOREIGN KEY ("garage_id") REFERENCES "public"."garages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admins_email_unique" ON "admins" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "app_releases_platform_unique" ON "app_releases" USING btree ("platform");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_garage_phone_unique" ON "customers" USING btree ("garage_id","phone");--> statement-breakpoint
CREATE INDEX "customers_garage_name_idx" ON "customers" USING btree ("garage_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "garages_owner_name_unique" ON "garages" USING btree ("owner_id","name");--> statement-breakpoint
CREATE INDEX "inventory_garage_category_idx" ON "inventory" USING btree ("garage_id","category");--> statement-breakpoint
CREATE INDEX "inventory_garage_name_idx" ON "inventory" USING btree ("garage_id","part_name");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_garage_number_unique" ON "invoices" USING btree ("garage_id","invoice_number");--> statement-breakpoint
CREATE INDEX "invoices_garage_created_idx" ON "invoices" USING btree ("garage_id","created_at");--> statement-breakpoint
CREATE INDEX "invoices_garage_payment_idx" ON "invoices" USING btree ("garage_id","payment_status");--> statement-breakpoint
CREATE INDEX "invoices_job_card_idx" ON "invoices" USING btree ("job_card_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_cards_garage_number_unique" ON "job_cards" USING btree ("garage_id","job_card_number");--> statement-breakpoint
CREATE INDEX "job_cards_garage_status_idx" ON "job_cards" USING btree ("garage_id","status");--> statement-breakpoint
CREATE INDEX "job_cards_garage_created_idx" ON "job_cards" USING btree ("garage_id","created_at");--> statement-breakpoint
CREATE INDEX "job_cards_mechanic_status_idx" ON "job_cards" USING btree ("assigned_mechanic_id","status");--> statement-breakpoint
CREATE INDEX "job_cards_vehicle_idx" ON "job_cards" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "job_cards_customer_idx" ON "job_cards" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "service_reminders_garage_date_idx" ON "service_reminders" USING btree ("garage_id","next_service_date");--> statement-breakpoint
CREATE INDEX "service_reminders_garage_status_idx" ON "service_reminders" USING btree ("garage_id","status");--> statement-breakpoint
CREATE INDEX "service_reminders_vehicle_idx" ON "service_reminders" USING btree ("vehicle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_garage_idx" ON "users" USING btree ("garage_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_garage_plate_unique" ON "vehicles" USING btree ("garage_id","license_plate");--> statement-breakpoint
CREATE INDEX "vehicles_customer_idx" ON "vehicles" USING btree ("customer_id");