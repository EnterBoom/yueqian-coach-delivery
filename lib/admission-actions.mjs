import { deliveryStatuses } from "./admissions.mjs";

export async function updateAdmission(db, body, actor) {
  const row = await db.prepare("SELECT * FROM admissions WHERE id=?").bind(String(body.id || "")).first();
  if (!row) throw new Error("报名记录不存在");
  if (!Number.isInteger(body.version) || row.version !== body.version) throw Object.assign(new Error("记录已更新，请刷新后重试"), { status: 409 });
  if (row.source_error) throw new Error("请先在飞书补齐报名资料，再同步");
  const status = String(body.status || row.status);
  if (!deliveryStatuses.includes(status)) throw new Error("交付状态不正确");
  if (row.status === "已退费") throw new Error("已退费记录已归档");
  const detail = String(body.detail || "").trim();
  if (["延期待交付", "退费处理中", "已退费"].includes(status) && !detail) throw new Error("请填写延期或退费说明");
  if (status === "已退费" && row.status !== "退费处理中") throw new Error("请先登记退费申请及挽退记录");
  const cohortId = Number(body.cohortId) || null;
  const groupId = Number(body.groupId) || null;
  let group;
  if (cohortId) {
    const cohort = await db.prepare("SELECT * FROM cohorts WHERE id=?").bind(cohortId).first();
    if (!cohort || cohort.status !== "active") throw new Error("请选择可安排的进行中营期");
  }
  if (["已排期", "交付中", "已完成"].includes(status) && !cohortId) throw new Error("请先选择营期");
  if (["待安排", "延期待交付", "已退费"].includes(status) && (cohortId || groupId)) throw new Error("该状态请清空当前营期和小组，历史安排会保留");
  if (groupId) {
    group = await db.prepare("SELECT * FROM groups WHERE id=? AND cohort_id=?").bind(groupId, cohortId).first();
    if (!group) throw new Error("小组不属于所选营期");
  }
  if (status === "交付中" && !groupId) throw new Error("开始交付前请分配小组和教练");
  const code = String(body.cohortCode || "").trim().toUpperCase();
  if (cohortId && !/^YQ[1-9]\d*$/.test(code)) throw new Error("请填写营期编号，例如 YQ11");
  if (cohortId) {
    const existingCode = await db.prepare("SELECT * FROM admission_cohort_codes WHERE code=? OR cohort_id=?").bind(code, cohortId).all();
    if (existingCode.results.some((item) => item.code !== code || item.cohort_id !== cohortId)) throw new Error("营期编号与已有对应关系冲突");
  }
  let learnerId = null;
  if (group) {
    const placement = await db.prepare("SELECT learner_id FROM admission_placements WHERE admission_id=? AND cohort_id=?").bind(row.id, cohortId).first();
    learnerId = placement?.learner_id || Number(body.existingLearnerId) || null;
    if (learnerId) {
      const learner = await db.prepare("SELECT l.*,g.cohort_id FROM learners l JOIN groups g ON g.id=l.group_id WHERE l.id=?").bind(learnerId).first();
      if (!learner || learner.cohort_id !== cohortId) throw new Error("关联的历史学员不属于本营期");
      const used = await db.prepare("SELECT admission_id FROM admission_placements WHERE learner_id=? AND admission_id!=?").bind(learnerId, row.id).first();
      if (used) throw new Error("该学员档案已关联另一条报名记录，请核对");
    }
    const sameName = await db.prepare("SELECT id FROM learners WHERE group_id=? AND name=?").bind(groupId, row.name).first();
    if (sameName && sameName.id !== learnerId) throw new Error("所选小组已有同名学员，请选择关联已有学员档案");
  }
  let refund = null;
  if (["退费处理中", "已退费"].includes(status)) {
    refund = await db.prepare("SELECT * FROM refund_requests WHERE admission_id=? AND source_error='' ORDER BY created_at DESC LIMIT 1").bind(row.id).first();
    if (!refund) throw new Error("请先通过飞书退费表提交退费说明和挽退附件，并同步");
    if (status === "已退费") {
      const amount = Number(body.refundAmount);
      if (body.refundAmount == null || body.refundAmount === "" || !Number.isFinite(amount) || amount < 0 || Math.round(amount * 100) > row.price_cents) throw new Error("请核对实际退费金额");
      const refundDate = String(body.refundDate || "");
      const parsedDate = new Date(`${refundDate}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(refundDate) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== refundDate) throw new Error("请填写有效退费日期");
    }
  }
  const token = crypto.randomUUID();
  const statements = [db.prepare(`UPDATE admissions SET status=?,cohort_id=?,group_id=?,learner_id=?,
    original_cohort_id=COALESCE(original_cohort_id,?),intended_cohort=?,follow_up_owner=?,delivery_note=?,
    version=version+1,last_mutation=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND version=?`)
    .bind(status, cohortId, groupId, learnerId, cohortId, String(body.intendedCohort || "").slice(0, 200),
      String(body.followUpOwner || "").slice(0, 100), String(body.deliveryNote || "").slice(0, 10000), token, row.id, body.version)];
  if (cohortId) statements.push(db.prepare(`INSERT INTO admission_cohort_codes (cohort_id,code)
    SELECT ?,? FROM admissions WHERE id=? AND last_mutation=?
    ON CONFLICT(cohort_id) DO UPDATE SET code=CASE WHEN admission_cohort_codes.code=excluded.code THEN excluded.code ELSE NULL END`)
    .bind(cohortId, code, row.id, token));
  if (group) {
    if (!learnerId) statements.push(db.prepare(`INSERT INTO learners (name,group_id,note)
      SELECT name,?,? FROM admissions WHERE id=? AND last_mutation=?`).bind(groupId, `报名交接 · ${row.id}`, row.id, token));
    else {
      statements.push(db.prepare(`UPDATE learners SET group_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?
        AND EXISTS (SELECT 1 FROM admissions WHERE id=? AND last_mutation=?)`).bind(groupId, learnerId, row.id, token));
      statements.push(db.prepare(`UPDATE exceptions SET group_id=?,updated_at=CURRENT_TIMESTAMP WHERE learner_id=?
        AND EXISTS (SELECT 1 FROM admissions WHERE id=? AND last_mutation=?)`).bind(groupId, learnerId, row.id, token));
    }
    if (!learnerId) statements.push(db.prepare(`UPDATE admissions SET learner_id=(SELECT id FROM learners WHERE group_id=? AND name=?)
      WHERE id=? AND last_mutation=?`).bind(groupId, row.name, row.id, token));
    statements.push(db.prepare(`INSERT OR IGNORE INTO admission_placements (admission_id,cohort_id,learner_id)
      SELECT id,cohort_id,learner_id FROM admissions WHERE id=? AND last_mutation=?`).bind(row.id, token));
  }
  const event = { from: row.status, to: status, previousCohortId: row.cohort_id, cohortId, groupId, detail,
    intendedCohort: body.intendedCohort || "", deliveryNote: body.deliveryNote || "" };
  if (status === "已退费") Object.assign(event, { refundId: refund.id, refundAmount: Number(body.refundAmount), refundDate: body.refundDate });
  statements.push(db.prepare(`INSERT INTO admission_events (admission_id,actor,action,detail)
    SELECT id,?,?,? FROM admissions WHERE id=? AND last_mutation=?`).bind(actor, "交付安排更新", JSON.stringify(event), row.id, token));
  const results = await db.batch(statements);
  if (!results[0].meta.changes) throw Object.assign(new Error("记录已更新，请刷新后重试"), { status: 409 });
}
