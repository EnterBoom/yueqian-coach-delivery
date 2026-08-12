import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canAccessGroup, normalizeHttpsUrl, validateProgressEvidence } from "../lib/policy.mjs";
import { parseLearnerRows } from "../lib/import-learners.mjs";

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

test("finished site has no starter or performance surface", async () => {
  const [page, layout, client, packageJson, hosting] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/operations-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
  ]);
  assert.match(page, /OperationsApp/);
  assert.match(page, /requireChatGPTUser\("\/"\)/);
  assert.match(layout, /教练交付作战台/);
  assert.match(client, /线上前10天/);
  assert.match(client, /线下5天/);
  assert.match(client, /线上后10天/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.doesNotMatch(page + layout + client, /绩效|奖金|结算|排名/);
  assert.match(hosting, /"d1": "DB"/);
  assert.match(hosting, /"r2": null/);
});

test("production owner bootstrap is explicit", async () => {
  const route = await readFile(new URL("../app/api/workspace/route.ts", import.meta.url), "utf8");
  assert.match(route, /INITIAL_OWNER_EMAIL/);
  assert.match(route, /NODE_ENV === "development"/);
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

test("signed-in email remains usable when Sites omits user id", async () => {
  const auth = await readFile(new URL("../app/chatgpt-auth.ts", import.meta.url), "utf8");
  assert.match(auth, /if \(!email\) return null/);
  assert.match(auth, /userId \?\? `email:\$\{email\.toLowerCase\(\)\}`/);
  assert.doesNotMatch(auth, /if \(!userId \|\| !email\) return null/);
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
