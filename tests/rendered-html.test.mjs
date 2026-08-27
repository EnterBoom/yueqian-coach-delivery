import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertCohortWritable, canAccessGroup, normalizeHttpsUrl, validateHttpsLinksInText, validateProgressEvidence } from "../lib/policy.mjs";
import { parseLearnerRows } from "../lib/import-learners.mjs";
import { defaultDayId } from "../lib/day-view.mjs";

test("group authorization is enforced at the shared boundary", () => {
  assert.equal(canAccessGroup("owner", "owner@example.com", "coach@example.com"), true);
  assert.equal(canAccessGroup("coach", "coach@example.com", "coach@example.com"), true);
  assert.equal(canAccessGroup("coach", "other@example.com", "coach@example.com"), false);
});

test("passed progress requires safe evidence", () => {
  assert.throws(() => validateProgressEvidence("passed", "", ""), /必须填写证据/);
  assert.throws(() => normalizeHttpsUrl("javascript:alert(1)"), /HTTPS/);
  assert.equal(validateProgressEvidence("passed", "https://example.com/work", "").evidenceUrl, "https://example.com/work");
  assert.equal(validateProgressEvidence("passed", "", "教练现场验收通过").evidenceNote, "教练现场验收通过");
});

test("coach materials accept text and HTTPS links only", () => {
  assert.equal(validateHttpsLinksInText("信息卡 https://example.com/card"), "信息卡 https://example.com/card");
  assert.throws(() => validateHttpsLinksInText("旧链接 http://example.com/card"), /HTTPS/);
});

test("finished site has no starter or performance surface", async () => {
  const [page, layout, client, packageJson, wrangler] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/operations-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
  ]);
  assert.match(page, /OperationsApp/);
  assert.match(page, /requireAccessUser\(\)/);
  assert.match(layout, /教练交付作战台/);
  assert.match(client, /线上前10天/);
  assert.match(client, /线下5天/);
  assert.match(client, /线上后10天/);
  assert.match(client, /packageJson\.version/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.doesNotMatch(page + layout + client, /绩效|奖金|结算|排名/);
  assert.match(wrangler, /"binding": "DB"/);
  assert.match(wrangler, /"name": "yueqian-coach-ops-prod"/);
  assert.match(wrangler, /"preview_urls": false/);
});

test("production owner bootstrap is explicit", async () => {
  const route = await readFile(new URL("../app/api/workspace/route.ts", import.meta.url), "utf8");
  assert.match(route, /INITIAL_OWNER_EMAIL/);
  assert.match(route, /NODE_ENV === "development"/);
  assert.match(route, /if \(!member\).*尚未分配项目角色/s);
  assert.doesNotMatch(route, /SELECT COUNT\(\*\) AS count FROM members/);
});

test("learner import accepts a selected group and Chinese commas", () => {
  const groups = [{ id: 2, name: "测试 2 组" }];
  assert.deepEqual(parseLearnerRows("苏娜\n陈晨，成长型", 2, groups), [
    { name: "苏娜", groupId: 2, note: "" },
    { name: "陈晨", groupId: 2, note: "成长型" },
  ]);
  assert.deepEqual(parseLearnerRows("苏娜，测试 2 组", null, groups), [
    { name: "苏娜", groupId: 2, note: "" },
  ]);
});

test("production identity comes only from a verified Cloudflare Access JWT", async () => {
  const auth = await readFile(new URL("../lib/access-auth.mjs", import.meta.url), "utf8");
  assert.match(auth, /cf-access-jwt-assertion/);
  assert.match(auth, /jwtVerify/);
  assert.doesNotMatch(auth, /oai-authenticated-user/);
});

test("each cohort has isolated delivery data and an internal manager", async () => {
  const [route, schema, client] = await Promise.all([
    readFile(new URL("../app/api/workspace/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/operations-app.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(schema, /cohortId: integer\("cohort_id"\)/);
  assert.match(route, /WHERE g\.cohort_id=\?/);
  assert.match(route, /WHERE cohort_id=\? ORDER BY sort_order/);
  assert.match(client, /营期管理/);
  assert.match(client, /当前营期/);
  assert.match(client, /创建并进入新营期/);
});

test("archived cohorts are read-only at the shared server boundary", async () => {
  assert.doesNotThrow(() => assertCohortWritable("active"));
  assert.throws(() => assertCohortWritable("archived"), /只能查看历史数据/);
  const [route, client] = await Promise.all([
    readFile(new URL("../app/api/workspace/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/operations-app.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(route, /\["initialize", "archive_cohort", "reopen_cohort"\]/);
  assert.match(route, /只有项目方可以变更营期状态/);
  assert.match(client, /已归档 · 只读/);
  assert.match(client, /window\.confirm/);
});

test("route day selection defaults to the calendar and drives the overview", async () => {
  const days = [
    { id: 1, due_date: "2026-08-12" },
    { id: 2, due_date: "2026-08-13" },
  ];
  assert.equal(defaultDayId(days, "2026-08-12"), 1);
  assert.equal(defaultDayId(days, "2026-08-11"), 1);
  assert.equal(defaultDayId(days, "2026-08-20"), 2);
  const client = await readFile(new URL("../app/operations-app.tsx", import.meta.url), "utf8");
  assert.match(client, /aria-pressed=\{day\.id === currentId\}/);
  assert.match(client, /点击日期，打开对应执行卡/);
  assert.match(client, /当日通过率/);
  assert.match(client, /setSelectedDayId\(null\)/);
  assert.doesNotMatch(client, /scrollIntoView/);
});

test("coach dispatch uses drafts, immutable publications and independent cohort sources", async () => {
  const [route, schema, client] = await Promise.all([
    readFile(new URL("../app/api/workspace/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/operations-app.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(schema, /dayPlanPublications/);
  assert.match(schema, /hasUnpublishedChanges/);
  assert.match(route, /save_day_draft/);
  assert.match(route, /publish_day/);
  assert.match(route, /source as PlanSource/);
  assert.match(route, /该任务尚未发布/);
  assert.match(client, /复制群公告/);
  assert.match(client, /showHeading=\{false\}/);
  assert.match(client, /标准25天模板/);
  assert.match(client, /复制已有营期/);
  assert.match(client, /25天空白计划/);
});

test("group lifecycle and archived learner records are explicit", async () => {
  const [route, client] = await Promise.all([
    readFile(new URL("../app/api/workspace/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/operations-app.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(route, /update_coach_group/);
  assert.match(route, /remove_empty_group/);
  assert.match(route, /merge_group/);
  assert.match(route, /两个小组存在同名学员/);
  assert.match(client, /当前营期分组/);
  assert.match(client, /查看历史档案/);
  assert.match(client, /学员全周期档案/);
});

test("the interview experiment is an authenticated internal toolbox", async () => {
  const [client, tool, route, prompt, wrangler] = await Promise.all([
    readFile(new URL("../app/operations-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/interview-tool.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/interview/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/interview.mjs", import.meta.url), "utf8"),
    readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
  ]);
  assert.match(client, /工具箱/);
  assert.match(client, /InterviewTool/);
  assert.match(tool, /AI 人设深访/);
  assert.match(tool, /yueqian-interview-session-v1/);
  assert.match(route, /SELECT email FROM members WHERE email=\?/);
  assert.match(route, /DEEPSEEK_API_KEY/);
  assert.doesNotMatch(client + tool, /DEEPSEEK_API_KEY/);
  assert.match(prompt, /九宫格话题骨架/);
  assert.match(wrangler, /INTERVIEW_LLM_MODEL/);
});

test("users can recover from an incorrect Cloudflare Access account", async () => {
  const client = await readFile(new URL("../app/operations-app.tsx", import.meta.url), "utf8");
  assert.match(client, /\/cdn-cgi\/access\/logout/);
  assert.match(client, /退出并切换邮箱/);
  assert.match(client, /切换账号/);
});
