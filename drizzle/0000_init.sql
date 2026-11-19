CREATE TABLE "metrics_counters" (
	"key" text NOT NULL,
	"day" date NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "metrics_counters_key_day_pk" PRIMARY KEY("key","day")
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key_hash" text NOT NULL,
	"bucket" text NOT NULL,
	"count" integer NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	CONSTRAINT "rate_limits_key_hash_bucket_pk" PRIMARY KEY("key_hash","bucket")
);
--> statement-breakpoint
CREATE TABLE "room_deck_state" (
	"room_id" uuid NOT NULL,
	"card_id" text NOT NULL,
	"status" text NOT NULL,
	"position" integer NOT NULL,
	"assigned_roles" jsonb,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "room_deck_state_room_id_card_id_pk" PRIMARY KEY("room_id","card_id")
);
--> statement-breakpoint
CREATE TABLE "room_players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"session_id" uuid,
	"local_profile" jsonb,
	"role_prefs" jsonb NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	CONSTRAINT "room_players_room_session_uq" UNIQUE("room_id","session_id")
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" char(6) NOT NULL,
	"host_session_id" uuid,
	"mode" text NOT NULL,
	"track" text,
	"genres" text[] NOT NULL,
	"intensity" text,
	"turn_mode" text NOT NULL,
	"state" text NOT NULL,
	"runtime" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rooms_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"age_verified" boolean DEFAULT false NOT NULL,
	"age_band" text NOT NULL,
	"gender" text NOT NULL,
	"preference" text NOT NULL,
	"genres" text[] NOT NULL,
	"display_name" text,
	"settings" jsonb NOT NULL,
	"boundaries" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "room_deck_state" ADD CONSTRAINT "room_deck_state_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_players" ADD CONSTRAINT "room_players_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_players" ADD CONSTRAINT "room_players_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_host_session_id_sessions_id_fk" FOREIGN KEY ("host_session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_last_seen_idx" ON "sessions" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");