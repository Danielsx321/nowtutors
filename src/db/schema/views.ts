import { pgView, text, uuid } from "drizzle-orm/pg-core";
import { tutorLiveMode } from "./enums";

// The two read views from drizzle/0004, declared with `.existing()` so Drizzle
// can query them without emitting DDL (they are created by the raw SQL migration,
// and remain the single source of truth for column lists + staleness threshold).

// Safe columns of ANY user (Decision B). Browse display reads go through this.
export const publicProfiles = pgView("public_profiles", {
  id: uuid("id"),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  country: text("country"),
  bio: text("bio"),
}).existing();

// Derived live-tutor membership (is_live + approved + fresh last_seen). Card live
// status derives from this, never from tutor_profiles.is_live (SPEC §3.1). Only
// the columns the browse query needs are declared.
export const liveTutors = pgView("live_tutors", {
  userId: uuid("user_id"),
  liveMode: tutorLiveMode("live_mode"),
}).existing();
