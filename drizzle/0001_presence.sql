ALTER TABLE "room_players" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "room_players" ADD COLUMN "active_tab" text;