import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

let schemaReady: Promise<void> | null = null;

export function getD1() {
  const runtimeEnv = env as unknown as { DB?: D1Database };
  if (!runtimeEnv.DB) throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  return runtimeEnv.DB;
}

export function getDb() {
  return drizzle(getD1(), { schema });
}

export function ensureSchema() {
  if (schemaReady) return schemaReady;
  const db = getD1();
  const statements = [
    `CREATE TABLE IF NOT EXISTS members (email TEXT PRIMARY KEY, user_id TEXT, display_name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','coach')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_members_user_id ON members(user_id) WHERE user_id IS NOT NULL`,
    `CREATE TABLE IF NOT EXISTS cohorts (id INTEGER PRIMARY KEY, name TEXT NOT NULL, pre_start_date TEXT NOT NULL, offline_start_date TEXT NOT NULL, post_start_date TEXT NOT NULL, initialized_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, coach_email TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_groups_name ON groups(name)`,
    `CREATE INDEX IF NOT EXISTS idx_groups_coach_email ON groups(coach_email)`,
    `CREATE TABLE IF NOT EXISTS learners (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, group_id INTEGER NOT NULL REFERENCES groups(id), note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_learners_group_name ON learners(group_id, name)`,
    `CREATE INDEX IF NOT EXISTS idx_learners_group_id ON learners(group_id)`,
    `CREATE TABLE IF NOT EXISTS day_plans (id INTEGER PRIMARY KEY AUTOINCREMENT, phase TEXT NOT NULL CHECK(phase IN ('pre_online','offline_camp','post_online')), day_number INTEGER NOT NULL, label TEXT NOT NULL, title TEXT NOT NULL, goal TEXT NOT NULL DEFAULT '', deliverable TEXT NOT NULL DEFAULT '', acceptance TEXT NOT NULL DEFAULT '', due_date TEXT NOT NULL, sort_order INTEGER NOT NULL, configured INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_day_plans_phase_day ON day_plans(phase, day_number)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_day_plans_sort_order ON day_plans(sort_order)`,
    `CREATE TABLE IF NOT EXISTS progress (id INTEGER PRIMARY KEY AUTOINCREMENT, learner_id INTEGER NOT NULL REFERENCES learners(id), day_plan_id INTEGER NOT NULL REFERENCES day_plans(id), status TEXT NOT NULL DEFAULT 'not_started' CHECK(status IN ('not_started','in_progress','needs_revision','passed')), evidence_url TEXT NOT NULL DEFAULT '', evidence_note TEXT NOT NULL DEFAULT '', updated_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_progress_learner_day ON progress(learner_id, day_plan_id)`,
    `CREATE INDEX IF NOT EXISTS idx_progress_day_status ON progress(day_plan_id, status)`,
    `CREATE TABLE IF NOT EXISTS exceptions (id INTEGER PRIMARY KEY AUTOINCREMENT, learner_id INTEGER REFERENCES learners(id), group_id INTEGER NOT NULL REFERENCES groups(id), day_plan_id INTEGER REFERENCES day_plans(id), created_by TEXT NOT NULL, problem TEXT NOT NULL, request TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','handling','resolved')), resolution TEXT NOT NULL DEFAULT '', handled_by TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE INDEX IF NOT EXISTS idx_exceptions_group_status ON exceptions(group_id, status)`,
    `CREATE TABLE IF NOT EXISTS exception_events (id INTEGER PRIMARY KEY AUTOINCREMENT, exception_id INTEGER NOT NULL REFERENCES exceptions(id), actor_email TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE INDEX IF NOT EXISTS idx_exception_events_exception_id ON exception_events(exception_id)`,
  ];
  schemaReady = db.batch(statements.map((statement) => db.prepare(statement))).then(() => undefined);
  return schemaReady;
}
