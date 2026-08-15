import assert from "node:assert/strict";
import test from "node:test";
import { buildD1Migration } from "../lib/migration.mjs";

test("Sites snapshots become a complete ordered D1 import", () => {
  const exportedAt = "2026-08-15T12:00:00.000Z";
  const snapshot = {
    user: { email: "owner@example.com" },
    members: [
      { email: "owner@example.com", user_id: "old-owner", display_name: "Owner", role: "owner" },
      { email: "coach@example.com", user_id: "old-coach", display_name: "Coach", role: "coach" },
    ],
    cohorts: [{ id: 1, name: "秋季营", pre_start_date: "2026-08-01", offline_start_date: "2026-08-11", post_start_date: "2026-08-16", status: "active", archived_at: null, archived_by: null }],
    cohort: { id: 1 },
    groups: [{ id: 2, name: "破浪一组", coach_email: "coach@example.com" }],
    learners: [{ id: 3, name: "苏娜", group_id: 2, note: "成长型" }],
    dayPlans: [{
      id: 4, cohort_id: 1, phase: "pre_online", day_number: 1, label: "D-10", title: "教练任务",
      coach_action: "发布公告", group_announcement: "同学们'好", materials: "https://example.com", learner_instructions: "填写信息卡",
      reminder: "当天完成", goal: "完成建档", deliverable: "信息卡", acceptance: "信息完整", due_date: "2026-08-01",
      sort_order: 1, configured: 1, has_unpublished_changes: 0, published_at: "2026-08-01T08:00:00Z", published_by: "owner@example.com",
    }],
    progress: [{ id: 5, learner_id: 3, day_plan_id: 4, status: "passed", evidence_url: "https://example.com/evidence", evidence_note: "通过", updated_by: "coach@example.com" }],
    exceptions: [{
      id: 6, learner_id: 3, group_id: 2, day_plan_id: 4, created_by: "coach@example.com", problem: "缺资料", request: "补交",
      status: "resolved", resolution: "已补", handled_by: "owner@example.com", events: [{ id: 7, exception_id: 6, actor_email: "owner@example.com", action: "resolved", detail: "完成", created_at: exportedAt }],
    }],
  };

  const result = buildD1Migration({ source: "old-site", exportedAt, snapshots: [snapshot] });
  assert.deepEqual(result.manifest.counts, {
    members: 2, cohorts: 1, groups: 1, learners: 1, day_plans: 1,
    day_plan_publications: 1, progress: 1, exceptions: 1, exception_events: 1,
  });
  assert.deepEqual(result.manifest.accessEmails, ["coach@example.com", "owner@example.com"]);
  assert.ok(result.sql.indexOf("INSERT INTO members") < result.sql.indexOf("INSERT INTO cohorts"));
  assert.ok(result.sql.indexOf("INSERT INTO cohorts") < result.sql.indexOf("INSERT INTO groups"));
  assert.match(result.sql, /同学们''好/);
  assert.match(result.sql, /INSERT INTO day_plan_publications/);
  assert.match(result.sql, /INSERT INTO exception_events/);
});
