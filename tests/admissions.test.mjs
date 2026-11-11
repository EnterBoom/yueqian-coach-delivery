import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { ensureAdmissionSchema, importRegistration, importRefund, parseRegistration, syncAdmissions } from "../lib/admissions.mjs";
import { updateAdmission } from "../lib/admission-actions.mjs";

async function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE cohorts (id INTEGER PRIMARY KEY,name TEXT,status TEXT);
    CREATE TABLE members (email TEXT PRIMARY KEY,display_name TEXT);
    CREATE TABLE groups (id INTEGER PRIMARY KEY,cohort_id INTEGER,name TEXT,coach_email TEXT);
    CREATE TABLE learners (id INTEGER PRIMARY KEY,name TEXT,group_id INTEGER,note TEXT,updated_at TEXT, UNIQUE(group_id,name));
    CREATE TABLE exceptions (id INTEGER PRIMARY KEY,learner_id INTEGER,group_id INTEGER,updated_at TEXT);
    INSERT INTO cohorts VALUES (1,'11期','active'),(2,'12期','active'),(3,'历史期','archived');
    INSERT INTO members VALUES ('coach@test','教练');
    INSERT INTO groups VALUES (1,1,'一组','coach@test'),(2,2,'二组','coach@test');`);
  const db = {
    prepare(sql) {
      const wrap = (args = []) => ({
        bind: (...values) => wrap(values),
        first: async () => sqlite.prepare(sql).get(...args) || null,
        all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
        run: async () => ({ meta: { changes: sqlite.prepare(sql).run(...args).changes } }),
      });
      return wrap();
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try { const result = []; for (const statement of statements) result.push(await statement.run()); sqlite.exec("COMMIT"); return result; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  await ensureAdmissionSchema(db);
  return db;
}

const fields = { "学员真实姓名": "测试学员", "微信昵称": "昵称", "手机号": "13000000000", "销售负责人": "销售", "报名渠道": ["线上单转"], "报名日期": "2026-11-11T00:00:00.000+08:00", "购买产品": "跃迁计划", "产品价格": 100, "特别承诺": "无" };
const registration = { id: "recTest", fields };
const get = (db) => db.prepare("SELECT * FROM admissions WHERE id='recTest'").first();

test("registration validates mandatory phone, dates, amount and channels", () => {
  assert.equal(parseRegistration(fields).error, "");
  assert.match(parseRegistration({ ...fields, 手机号: "" }).error, /手机号/);
  assert.match(parseRegistration({ ...fields, 报名日期: "2026-02-30" }).error, /日期/);
  assert.match(parseRegistration({ ...fields, 产品价格: "" }).error, /金额/);
  assert.match(parseRegistration({ ...fields, 报名渠道: ["其他"] }).error, /渠道/);
});

test("replayed intake is idempotent and input corrections preserve delivery state", async () => {
  const db = await database();
  assert.equal(await importRegistration(db, registration), true);
  assert.equal(await importRegistration(db, registration), false);
  await updateAdmission(db, { id: "recTest", version: 1, status: "已排期", cohortId: 1, cohortCode: "YQ11", groupId: 1 }, "owner");
  await importRegistration(db, { ...registration, fields: { ...fields, 特别承诺: "补充约定" } });
  assert.equal((await get(db)).status, "已排期");
  assert.equal((await get(db)).promise, "补充约定");
  assert.equal((await db.prepare("SELECT count(*) n FROM learners").first()).n, 1);
});

test("stale assignment cannot create a second learner or event", async () => {
  const db = await database(); await importRegistration(db, registration);
  const body = { id: "recTest", version: 1, status: "已排期", cohortId: 1, cohortCode: "YQ11", groupId: 1 };
  await updateAdmission(db, body, "owner");
  await assert.rejects(updateAdmission(db, body, "owner"), /刷新/);
  assert.equal((await db.prepare("SELECT count(*) n FROM learners").first()).n, 1);
});

test("deferral retains past placement, student number and original cohort", async () => {
  const db = await database(); await importRegistration(db, registration);
  await updateAdmission(db, { id: "recTest", version: 1, status: "已排期", cohortId: 1, cohortCode: "YQ11", groupId: 1 }, "owner");
  const student = (await get(db)).student_id;
  await updateAdmission(db, { id: "recTest", version: 2, status: "延期待交付", detail: "时间不合适" }, "owner");
  assert.equal((await get(db)).learner_id, null);
  await updateAdmission(db, { id: "recTest", version: 3, status: "已排期", cohortId: 2, cohortCode: "YQ12", groupId: 2 }, "owner");
  assert.equal((await get(db)).student_id, student);
  assert.equal((await get(db)).original_cohort_id, 1);
  assert.equal((await db.prepare("SELECT count(*) n FROM admission_placements").first()).n, 2);
});

test("a refund requires matching intake and evidence, and a replay never reopens a refunded registration", async () => {
  const db = await database(); await importRegistration(db, registration);
  const refund = { id: "recRefund", fields: { 报名编号: "recTest", 学员真实姓名: "测试学员", 手机号: "13000000000", 销售负责人: "销售", 申请退费金额: 100, 退费说明: "学员申请", 挽退记录: [] } };
  await importRefund(db, refund);
  assert.equal((await get(db)).status, "待安排");
  refund.fields.挽退记录 = [{ token: "fileTest", name: "沟通.mp3" }];
  await importRefund(db, refund);
  assert.equal((await get(db)).status, "退费处理中");
  await updateAdmission(db, { id: "recTest", version: 2, status: "已退费", detail: "已退款", refundAmount: 100, refundDate: "2026-11-11" }, "owner");
  await importRefund(db, refund);
  assert.equal((await get(db)).status, "已退费");
});

test("sync retries failed writeback without duplicate intake and marks only the pushed version", async () => {
  const db = await database(); let fail = true;
  const client = { async request(path) {
    if (path.includes("batch_update")) { if (fail) throw new Error("temporary failure"); return {}; }
    return { fields: Object.keys(fields), data: [Object.values(fields)], record_id_list: ["recTest"], has_more: false };
  } };
  const env = { FEISHU_APP_ID: "test", FEISHU_APP_SECRET: "test", FEISHU_BASE_TOKEN: "test", FEISHU_REGISTRATION_TABLE: "test" };
  await assert.rejects(syncAdmissions(db, env, client), /temporary/);
  assert.equal((await get(db)).synced_version, 0);
  fail = false; await syncAdmissions(db, env, client);
  assert.equal((await get(db)).synced_version, 1);
  assert.equal((await db.prepare("SELECT count(*) n FROM admissions").first()).n, 1);
});
