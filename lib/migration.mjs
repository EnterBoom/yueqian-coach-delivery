const TABLES = [
  "members",
  "cohorts",
  "groups",
  "learners",
  "day_plans",
  "day_plan_publications",
  "progress",
  "exceptions",
  "exception_events",
];

function requiredArray(value, name) {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  return value;
}

function uniqueRows(rows, key, name) {
  const result = new Map();
  for (const row of rows) {
    const id = row?.[key];
    if (id === undefined || id === null || id === "") throw new Error(`${name} row is missing ${key}`);
    const existing = result.get(id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(row)) throw new Error(`${name} contains conflicting ${key}=${id}`);
    result.set(id, row);
  }
  return [...result.values()];
}

function sqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Migration contains a non-finite number");
    return String(value);
  }
  if (typeof value === "boolean") return value ? "1" : "0";
  return `'${String(value).replaceAll("\0", "").replaceAll("'", "''")}'`;
}

function insert(table, columns, rows) {
  return rows.map((row) => {
    const values = columns.map((column) => sqlValue(row[column])).join(",");
    return `INSERT INTO ${table} (${columns.join(",")}) VALUES (${values});`;
  });
}

function timestamp(value, fallback) {
  return typeof value === "string" && value ? value : fallback;
}

function email(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function buildD1Migration(payload) {
  const snapshots = requiredArray(payload?.snapshots, "snapshots");
  if (!snapshots.length) throw new Error("At least one cohort snapshot is required");
  const migratedAt = typeof payload.exportedAt === "string" && payload.exportedAt ? payload.exportedAt : new Date().toISOString();

  const members = uniqueRows(snapshots.flatMap((item) => requiredArray(item.members, "members")).map((row) => ({
    email: email(row.email),
    user_id: row.user_id ?? null,
    display_name: String(row.display_name ?? row.email ?? ""),
    role: row.role,
    created_at: timestamp(row.created_at, migratedAt),
    updated_at: timestamp(row.updated_at, migratedAt),
  })), "email", "members");
  const ownerEmail = members.find((item) => item.role === "owner")?.email || email(snapshots[0]?.user?.email);
  if (!ownerEmail) throw new Error("Migration export does not contain an owner email");

  const cohorts = uniqueRows(snapshots.flatMap((item) => requiredArray(item.cohorts, "cohorts")).map((row) => ({
    id: Number(row.id),
    name: String(row.name ?? ""),
    pre_start_date: row.pre_start_date,
    offline_start_date: row.offline_start_date,
    post_start_date: row.post_start_date,
    status: row.status ?? "active",
    archived_at: row.archived_at ?? null,
    archived_by: row.archived_by ?? null,
    initialized_by: row.initialized_by ?? ownerEmail,
    created_at: timestamp(row.created_at, migratedAt),
    updated_at: timestamp(row.updated_at, migratedAt),
  })), "id", "cohorts");

  const scoped = snapshots.filter((item) => item.cohort?.id);
  const groups = uniqueRows(scoped.flatMap((item) => requiredArray(item.groups, "groups").map((row) => ({
    id: Number(row.id),
    cohort_id: Number(item.cohort.id),
    name: String(row.name ?? ""),
    coach_email: email(row.coach_email),
    created_at: timestamp(row.created_at, migratedAt),
    updated_at: timestamp(row.updated_at, migratedAt),
  }))), "id", "groups");
  const learners = uniqueRows(scoped.flatMap((item) => requiredArray(item.learners, "learners").map((row) => ({
    id: Number(row.id),
    name: String(row.name ?? ""),
    group_id: Number(row.group_id),
    note: String(row.note ?? ""),
    created_at: timestamp(row.created_at, migratedAt),
    updated_at: timestamp(row.updated_at, migratedAt),
  }))), "id", "learners");

  const dayPlans = uniqueRows(scoped.flatMap((item) => requiredArray(item.dayPlans, "dayPlans").map((row) => ({
    id: Number(row.id),
    cohort_id: Number(item.cohort.id),
    phase: row.phase,
    day_number: Number(row.day_number),
    label: String(row.label ?? ""),
    title: String(row.title ?? ""),
    coach_action: String(row.coach_action ?? ""),
    group_announcement: String(row.group_announcement ?? ""),
    materials: String(row.materials ?? ""),
    learner_instructions: String(row.learner_instructions ?? ""),
    reminder: String(row.reminder ?? ""),
    goal: String(row.goal ?? ""),
    deliverable: String(row.deliverable ?? ""),
    acceptance: String(row.acceptance ?? ""),
    due_date: row.due_date,
    sort_order: Number(row.sort_order),
    configured: Number(row.configured ?? 0),
    has_unpublished_changes: Number(row.has_unpublished_changes ?? 0),
    created_at: timestamp(row.created_at, migratedAt),
    updated_at: timestamp(row.updated_at, migratedAt),
    published_at: row.published_at ?? null,
    published_by: row.published_by ?? null,
    published_title: row.published_title ?? row.title,
    published_coach_action: row.published_coach_action ?? row.coach_action ?? "",
    published_group_announcement: row.published_group_announcement ?? row.group_announcement ?? "",
    published_materials: row.published_materials ?? row.materials ?? "",
    published_learner_instructions: row.published_learner_instructions ?? row.learner_instructions ?? "",
    published_reminder: row.published_reminder ?? row.reminder ?? "",
    published_goal: row.published_goal ?? row.goal ?? "",
    published_deliverable: row.published_deliverable ?? row.deliverable ?? "",
    published_acceptance: row.published_acceptance ?? row.acceptance ?? "",
    published_due_date: row.published_due_date ?? row.due_date,
  }))), "id", "dayPlans");
  const publications = dayPlans.filter((row) => row.published_at).map((row) => ({
    day_plan_id: row.id,
    title: row.published_title,
    coach_action: row.published_coach_action,
    group_announcement: row.published_group_announcement,
    materials: row.published_materials,
    learner_instructions: row.published_learner_instructions,
    reminder: row.published_reminder,
    goal: row.published_goal,
    deliverable: row.published_deliverable,
    acceptance: row.published_acceptance,
    due_date: row.published_due_date,
    published_by: row.published_by ?? "migration",
    published_at: row.published_at,
  }));

  const progress = uniqueRows(scoped.flatMap((item) => requiredArray(item.progress, "progress").map((row) => ({
    id: Number(row.id), learner_id: Number(row.learner_id), day_plan_id: Number(row.day_plan_id), status: row.status,
    evidence_url: String(row.evidence_url ?? ""), evidence_note: String(row.evidence_note ?? ""), updated_by: email(row.updated_by),
    created_at: timestamp(row.created_at, migratedAt), updated_at: timestamp(row.updated_at, migratedAt),
  }))), "id", "progress");
  const exceptions = uniqueRows(scoped.flatMap((item) => requiredArray(item.exceptions, "exceptions").map((row) => ({
    id: Number(row.id), learner_id: row.learner_id === null ? null : Number(row.learner_id), group_id: Number(row.group_id),
    day_plan_id: row.day_plan_id === null ? null : Number(row.day_plan_id), created_by: email(row.created_by),
    problem: String(row.problem ?? ""), request: String(row.request ?? ""), status: row.status,
    resolution: String(row.resolution ?? ""), handled_by: row.handled_by ? email(row.handled_by) : null,
    created_at: timestamp(row.created_at, migratedAt), updated_at: timestamp(row.updated_at, migratedAt),
  }))), "id", "exceptions");
  const exceptionEvents = uniqueRows(scoped.flatMap((item) => requiredArray(item.exceptions, "exceptions").flatMap((row) => requiredArray(row.events ?? [], "exception events").map((event) => ({
    id: Number(event.id), exception_id: Number(event.exception_id), actor_email: email(event.actor_email), action: String(event.action ?? ""),
    detail: String(event.detail ?? ""), created_at: timestamp(event.created_at, migratedAt),
  })))), "id", "exception events");

  const rows = { members, cohorts, groups, learners, day_plans: dayPlans, day_plan_publications: publications, progress, exceptions, exception_events: exceptionEvents };
  const statements = ["PRAGMA foreign_keys=ON;"];
  statements.push(...insert("members", ["email", "user_id", "display_name", "role", "created_at", "updated_at"], members));
  statements.push(...insert("cohorts", ["id", "name", "pre_start_date", "offline_start_date", "post_start_date", "status", "archived_at", "archived_by", "initialized_by", "created_at", "updated_at"], cohorts));
  statements.push(...insert("groups", ["id", "cohort_id", "name", "coach_email", "created_at", "updated_at"], groups));
  statements.push(...insert("learners", ["id", "name", "group_id", "note", "created_at", "updated_at"], learners));
  statements.push(...insert("day_plans", ["id", "cohort_id", "phase", "day_number", "label", "title", "coach_action", "group_announcement", "materials", "learner_instructions", "reminder", "goal", "deliverable", "acceptance", "due_date", "sort_order", "configured", "has_unpublished_changes", "created_at", "updated_at"], dayPlans));
  statements.push(...insert("day_plan_publications", ["day_plan_id", "title", "coach_action", "group_announcement", "materials", "learner_instructions", "reminder", "goal", "deliverable", "acceptance", "due_date", "published_by", "published_at"], publications));
  statements.push(...insert("progress", ["id", "learner_id", "day_plan_id", "status", "evidence_url", "evidence_note", "updated_by", "created_at", "updated_at"], progress));
  statements.push(...insert("exceptions", ["id", "learner_id", "group_id", "day_plan_id", "created_by", "problem", "request", "status", "resolution", "handled_by", "created_at", "updated_at"], exceptions));
  statements.push(...insert("exception_events", ["id", "exception_id", "actor_email", "action", "detail", "created_at"], exceptionEvents));

  return {
    sql: `${statements.join("\n")}\n`,
    manifest: {
      source: payload.source ?? null,
      exportedAt: migratedAt,
      counts: Object.fromEntries(TABLES.map((table) => [table, rows[table].length])),
      accessEmails: members.map((item) => item.email).sort(),
    },
  };
}
