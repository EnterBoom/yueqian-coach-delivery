import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
};

export const members = sqliteTable("members", {
  email: text("email").primaryKey(),
  userId: text("user_id"),
  displayName: text("display_name").notNull(),
  role: text("role", { enum: ["owner", "coach"] }).notNull(),
  ...timestamps,
}, (table) => [uniqueIndex("idx_members_user_id").on(table.userId)]);

export const cohorts = sqliteTable("cohorts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  preStartDate: text("pre_start_date").notNull(),
  offlineStartDate: text("offline_start_date").notNull(),
  postStartDate: text("post_start_date").notNull(),
  status: text("status", { enum: ["active", "archived"] }).notNull().default("active"),
  archivedAt: text("archived_at"),
  archivedBy: text("archived_by"),
  initializedBy: text("initialized_by").notNull(),
  ...timestamps,
});

export const groups = sqliteTable("groups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  cohortId: integer("cohort_id").notNull().references(() => cohorts.id),
  name: text("name").notNull(),
  coachEmail: text("coach_email").notNull(),
  ...timestamps,
}, (table) => [
  uniqueIndex("idx_groups_cohort_name").on(table.cohortId, table.name),
  index("idx_groups_cohort_id").on(table.cohortId),
  index("idx_groups_coach_email").on(table.coachEmail),
]);

export const learners = sqliteTable("learners", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  groupId: integer("group_id").notNull().references(() => groups.id),
  note: text("note").notNull().default(""),
  ...timestamps,
}, (table) => [
  uniqueIndex("idx_learners_group_name").on(table.groupId, table.name),
  index("idx_learners_group_id").on(table.groupId),
]);

export const dayPlans = sqliteTable("day_plans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  cohortId: integer("cohort_id").notNull().references(() => cohorts.id),
  phase: text("phase", { enum: ["pre_online", "offline_camp", "post_online"] }).notNull(),
  dayNumber: integer("day_number").notNull(),
  label: text("label").notNull(),
  title: text("title").notNull(),
  coachAction: text("coach_action").notNull().default(""),
  groupAnnouncement: text("group_announcement").notNull().default(""),
  materials: text("materials").notNull().default(""),
  learnerInstructions: text("learner_instructions").notNull().default(""),
  reminder: text("reminder").notNull().default(""),
  goal: text("goal").notNull().default(""),
  deliverable: text("deliverable").notNull().default(""),
  acceptance: text("acceptance").notNull().default(""),
  dueDate: text("due_date").notNull(),
  sortOrder: integer("sort_order").notNull(),
  configured: integer("configured", { mode: "boolean" }).notNull().default(false),
  hasUnpublishedChanges: integer("has_unpublished_changes", { mode: "boolean" }).notNull().default(false),
  ...timestamps,
}, (table) => [
  uniqueIndex("idx_day_plans_cohort_phase_day").on(table.cohortId, table.phase, table.dayNumber),
  uniqueIndex("idx_day_plans_cohort_sort_order").on(table.cohortId, table.sortOrder),
  index("idx_day_plans_cohort_id").on(table.cohortId),
]);

export const dayPlanPublications = sqliteTable("day_plan_publications", {
  dayPlanId: integer("day_plan_id").primaryKey().references(() => dayPlans.id),
  title: text("title").notNull(),
  coachAction: text("coach_action").notNull().default(""),
  groupAnnouncement: text("group_announcement").notNull().default(""),
  materials: text("materials").notNull().default(""),
  learnerInstructions: text("learner_instructions").notNull().default(""),
  reminder: text("reminder").notNull().default(""),
  goal: text("goal").notNull().default(""),
  deliverable: text("deliverable").notNull().default(""),
  acceptance: text("acceptance").notNull().default(""),
  dueDate: text("due_date").notNull(),
  publishedBy: text("published_by").notNull(),
  publishedAt: text("published_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const progress = sqliteTable("progress", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  learnerId: integer("learner_id").notNull().references(() => learners.id),
  dayPlanId: integer("day_plan_id").notNull().references(() => dayPlans.id),
  status: text("status", { enum: ["not_started", "in_progress", "needs_revision", "passed"] }).notNull().default("not_started"),
  evidenceUrl: text("evidence_url").notNull().default(""),
  evidenceNote: text("evidence_note").notNull().default(""),
  updatedBy: text("updated_by").notNull(),
  ...timestamps,
}, (table) => [
  uniqueIndex("idx_progress_learner_day").on(table.learnerId, table.dayPlanId),
  index("idx_progress_day_status").on(table.dayPlanId, table.status),
]);

export const exceptions = sqliteTable("exceptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  learnerId: integer("learner_id").references(() => learners.id),
  groupId: integer("group_id").notNull().references(() => groups.id),
  dayPlanId: integer("day_plan_id").references(() => dayPlans.id),
  createdBy: text("created_by").notNull(),
  problem: text("problem").notNull(),
  request: text("request").notNull(),
  status: text("status", { enum: ["open", "handling", "resolved"] }).notNull().default("open"),
  resolution: text("resolution").notNull().default(""),
  handledBy: text("handled_by"),
  ...timestamps,
}, (table) => [
  index("idx_exceptions_group_status").on(table.groupId, table.status),
]);

export const exceptionEvents = sqliteTable("exception_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  exceptionId: integer("exception_id").notNull().references(() => exceptions.id),
  actorEmail: text("actor_email").notNull(),
  action: text("action").notNull(),
  detail: text("detail").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_exception_events_exception_id").on(table.exceptionId)]);
