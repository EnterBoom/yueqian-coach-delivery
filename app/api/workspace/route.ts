import { ensureSchema, getD1 } from "@/db";
import { getSiteUser } from "@/lib/site-auth";
import { parseLearnerRows } from "@/lib/import-learners.mjs";
import type { DayPlan, Member, Phase, PlanSource, Role, WorkspaceSnapshot } from "@/lib/types";
import {
  assertCohortWritable,
  canAccessGroup,
  exceptionStatuses,
  validateHttpsLinksInText,
  validateProgressEvidence,
} from "@/lib/policy.mjs";

export const dynamic = "force-dynamic";

type D1Row = Record<string, unknown>;
type PlanSeed = [Phase, number, string, string, string, string, string, string, string, string, string, string, string, number, number];

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

function clean(value: unknown, max = 2000) {
  return String(value ?? "").trim().slice(0, max);
}

function requireDate(value: unknown, label: string) {
  const text = clean(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) throw new Error(`${label}日期不正确`);
  return text;
}

function requireEmail(value: unknown) {
  const email = clean(value, 160).toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("教练邮箱格式不正确");
  return email;
}

function addDays(date: string, offset: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

function dueDate(phase: Phase, dayNumber: number, starts: Record<Phase, string>) {
  return addDays(starts[phase], dayNumber - 1);
}

const preCamp = [
  ["基础建档营地｜信息卡", "完成个人信息与业务基础建档", "超级IP信息卡", "关键信息完整，可供教练快速判断"],
  ["基础建档营地｜人设九宫格", "梳理关键经历、优势与故事线", "人设九宫格与故事素材", "形成可用于定位访谈的个人基础档案"],
  ["定位校准站｜导师访谈", "明确目标用户、核心故事与内容方向", "定位诊断结论", "目标用户、核心故事、三个内容方向清楚"],
  ["内容试跑场｜账号体检", "识别账号当前问题与可放大优势", "账号体检记录", "问题、优势与首轮调整方向可执行"],
  ["内容试跑场｜初版脚本", "围绕定位完成第一版人设内容", "初版脚本", "观点明确、素材真实、可直接试拍"],
  ["内容试跑场｜人设 Demo", "完成第一条有效人设内容试拍", "人设 Demo 链接", "画面与表达完整，可进入教练反馈"],
  ["内容试跑场｜教练修改", "根据反馈完成一次有效修改", "修改版 Demo", "核心问题已修正，达到线下开工标准"],
  ["人设弹药库", "汇总后续内容可调用的事实与证明", "案例、见证、花絮、逐字稿等素材包", "素材分类清楚、来源可核验、可直接调用"],
  ["入营检票口｜设备住行", "补齐线下开工所需设备、软件与住行", "入营就绪单", "设备、软件、交通、住宿与战袍已确认"],
  ["入营检票口｜教练终验", "完成五项成果终验并取得通行证", "跃迁入营通行证", "个人档案、定位、Demo、弹药包、就绪单全部通过"],
] as const;

function standardRows(starts: Record<Phase, string>): PlanSeed[] {
  const rows: PlanSeed[] = preCamp.map((item, index) => [
    "pre_online", index + 1, `D-${10 - index}`, item[0], "", "", "", "", "", item[1], item[2], item[3], dueDate("pre_online", index + 1, starts), index + 1, 1,
  ]);
  for (let index = 0; index < 5; index += 1) rows.push(["offline_camp", index + 1, `Day ${index + 1}`, `待配置｜线下第${index + 1}天`, "", "", "", "", "", "", "", "", dueDate("offline_camp", index + 1, starts), 11 + index, 0]);
  for (let index = 0; index < 10; index += 1) rows.push(["post_online", index + 1, `P+${index + 1}`, `待配置｜线上陪跑第${index + 1}天`, "", "", "", "", "", "", "", "", dueDate("post_online", index + 1, starts), 16 + index, 0]);
  return rows;
}

function blankRows(starts: Record<Phase, string>): PlanSeed[] {
  return standardRows(starts).map((row) => [row[0], row[1], row[2], `待配置｜${row[2]}`, "", "", "", "", "", "", "", "", row[12], row[13], 0]);
}

async function authorize() {
  const user = await getSiteUser();
  if (!user) throw Object.assign(new Error("请先登录 ChatGPT 后再进入作战台"), { status: 401 });
  await ensureSchema();
  const db = getD1();
  const initialOwnerEmail = process.env.INITIAL_OWNER_EMAIL?.trim().toLowerCase();
  if (initialOwnerEmail) await db.prepare("INSERT OR IGNORE INTO members (email,display_name,role) VALUES (?,?,'owner')").bind(initialOwnerEmail, initialOwnerEmail).run();
  else if (process.env.NODE_ENV === "development") await db.prepare("INSERT OR IGNORE INTO members (email,user_id,display_name,role) VALUES (?,?,?,'owner')").bind(user.email, user.userId, user.displayName).run();
  const member = await db.prepare("SELECT email,user_id,display_name,role FROM members WHERE email=?").bind(user.email).first<Member>();
  if (!member) throw Object.assign(new Error("该邮箱尚未分配项目角色"), { status: 403 });
  await db.prepare("UPDATE members SET user_id=?,updated_at=CURRENT_TIMESTAMP WHERE email=?").bind(user.userId, user.email).run();
  return { db, user: { ...user, displayName: member.display_name }, member };
}

async function availableCohorts(db: ReturnType<typeof getD1>, role: Role, email: string) {
  return (role === "owner"
    ? await db.prepare("SELECT id,name,pre_start_date,offline_start_date,post_start_date,status,archived_at,archived_by FROM cohorts ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END,id DESC").all()
    : await db.prepare("SELECT DISTINCT c.id,c.name,c.pre_start_date,c.offline_start_date,c.post_start_date,c.status,c.archived_at,c.archived_by FROM cohorts c JOIN groups g ON g.cohort_id=c.id WHERE g.coach_email=? ORDER BY CASE c.status WHEN 'active' THEN 0 ELSE 1 END,c.id DESC").bind(email).all()
  ).results as WorkspaceSnapshot["cohorts"];
}

async function requireCohort(db: ReturnType<typeof getD1>, role: Role, email: string, requested?: number) {
  const cohorts = await availableCohorts(db, role, email);
  const cohort = requested ? cohorts.find((item) => item.id === requested) : cohorts[0];
  if (requested && !cohort) throw Object.assign(new Error("你没有权限访问这个营期"), { status: 403 });
  return { cohorts, cohort: cohort ?? null };
}

async function requireGroupAccess(db: ReturnType<typeof getD1>, role: Role, email: string, groupId: number, cohortId: number) {
  const group = await db.prepare("SELECT id,coach_email FROM groups WHERE id=? AND cohort_id=?").bind(groupId, cohortId).first<{ id: number; coach_email: string }>();
  if (!group || !canAccessGroup(role, email, group.coach_email)) throw Object.assign(new Error("你没有权限操作这个小组"), { status: 403 });
  return group;
}

async function groupForLearner(db: ReturnType<typeof getD1>, learnerId: number) {
  return db.prepare("SELECT g.id,g.cohort_id,g.coach_email,l.name FROM learners l JOIN groups g ON g.id=l.group_id WHERE l.id=?").bind(learnerId).first<{ id: number; cohort_id: number; coach_email: string; name: string }>();
}

function resolvedDay(row: D1Row, showPublished: boolean): DayPlan {
  const hasPublication = Boolean(row.published_at);
  const fields = ["title", "coach_action", "group_announcement", "materials", "learner_instructions", "reminder", "goal", "deliverable", "acceptance", "due_date"] as const;
  const result = { ...row } as D1Row;
  if (showPublished) {
    for (const field of fields) result[field] = hasPublication ? row[`published_${field}`] : field === "title" ? "待项目方发布" : field === "due_date" ? row.due_date : "";
    result.configured = hasPublication ? 1 : 0;
  }
  result.dispatch_status = hasPublication && (showPublished || !Number(row.has_unpublished_changes)) ? "published" : "draft";
  return result as DayPlan;
}

async function snapshot(requestedCohortId?: number): Promise<WorkspaceSnapshot> {
  const { db, user, member } = await authorize();
  const owner = member.role === "owner";
  const { cohorts, cohort } = await requireCohort(db, member.role, user.email, requestedCohortId);
  const members = owner ? await db.prepare("SELECT email,user_id,display_name,role FROM members ORDER BY role DESC,display_name").all() : { results: [] };
  if (!cohort) return { user: { ...user, role: member.role }, cohort: null, cohorts, groups: [], learners: [], dayPlans: [], progress: [], exceptions: [], members: members.results as WorkspaceSnapshot["members"] };
  const cohortId = cohort.id;
  const groupSql = owner
    ? "SELECT g.id,g.name,g.coach_email,COALESCE(m.display_name,g.coach_email) coach_name,COUNT(l.id) learner_count FROM groups g LEFT JOIN members m ON m.email=g.coach_email LEFT JOIN learners l ON l.group_id=g.id WHERE g.cohort_id=? GROUP BY g.id ORDER BY g.id"
    : "SELECT g.id,g.name,g.coach_email,COALESCE(m.display_name,g.coach_email) coach_name,COUNT(l.id) learner_count FROM groups g LEFT JOIN members m ON m.email=g.coach_email LEFT JOIN learners l ON l.group_id=g.id WHERE g.cohort_id=? AND g.coach_email=? GROUP BY g.id ORDER BY g.id";
  const learnerSql = owner ? "SELECT l.id,l.name,l.group_id,g.name group_name,l.note FROM learners l JOIN groups g ON g.id=l.group_id WHERE g.cohort_id=? ORDER BY g.id,l.id" : "SELECT l.id,l.name,l.group_id,g.name group_name,l.note FROM learners l JOIN groups g ON g.id=l.group_id WHERE g.cohort_id=? AND g.coach_email=? ORDER BY g.id,l.id";
  const progressSql = owner ? "SELECT p.* FROM progress p JOIN learners l ON l.id=p.learner_id JOIN groups g ON g.id=l.group_id WHERE g.cohort_id=? ORDER BY p.updated_at DESC" : "SELECT p.* FROM progress p JOIN learners l ON l.id=p.learner_id JOIN groups g ON g.id=l.group_id WHERE g.cohort_id=? AND g.coach_email=? ORDER BY p.updated_at DESC";
  const exceptionSql = `${owner ? "SELECT e.*,l.name learner_name,g.name group_name,d.label day_label FROM exceptions e LEFT JOIN learners l ON l.id=e.learner_id JOIN groups g ON g.id=e.group_id LEFT JOIN day_plans d ON d.id=e.day_plan_id WHERE g.cohort_id=?" : "SELECT e.*,l.name learner_name,g.name group_name,d.label day_label FROM exceptions e LEFT JOIN learners l ON l.id=e.learner_id JOIN groups g ON g.id=e.group_id LEFT JOIN day_plans d ON d.id=e.day_plan_id WHERE g.cohort_id=? AND g.coach_email=?"} ORDER BY CASE e.status WHEN 'open' THEN 0 WHEN 'handling' THEN 1 ELSE 2 END,e.updated_at DESC`;
  const daySql = "SELECT d.*,p.title published_title,p.coach_action published_coach_action,p.group_announcement published_group_announcement,p.materials published_materials,p.learner_instructions published_learner_instructions,p.reminder published_reminder,p.goal published_goal,p.deliverable published_deliverable,p.acceptance published_acceptance,p.due_date published_due_date,p.published_at,p.published_by FROM day_plans d LEFT JOIN day_plan_publications p ON p.day_plan_id=d.id WHERE d.cohort_id=? ORDER BY d.sort_order";
  const bind = <T extends D1Row>(sql: string) => owner ? db.prepare(sql).bind(cohortId).all<T>() : db.prepare(sql).bind(cohortId, user.email).all<T>();
  const [groups, learners, days, progress, exceptions] = await Promise.all([bind(groupSql), bind(learnerSql), db.prepare(daySql).bind(cohortId).all<D1Row>(), bind(progressSql), bind(exceptionSql)]);
  const exceptionRows = exceptions.results as D1Row[];
  const exceptionIds = exceptionRows.map((item) => Number(item.id));
  let events: D1Row[] = [];
  if (exceptionIds.length) {
    const placeholders = exceptionIds.map(() => "?").join(",");
    events = (await db.prepare(`SELECT * FROM exception_events WHERE exception_id IN (${placeholders}) ORDER BY created_at`).bind(...exceptionIds).all()).results;
  }
  const showPublished = !owner || cohort.status === "archived";
  return {
    user: { ...user, role: member.role }, cohort, cohorts,
    groups: groups.results as WorkspaceSnapshot["groups"], learners: learners.results as WorkspaceSnapshot["learners"],
    dayPlans: (days.results as D1Row[]).map((row) => resolvedDay(row, showPublished)), progress: progress.results as WorkspaceSnapshot["progress"],
    exceptions: exceptionRows.map((item) => ({ ...item, events: events.filter((event) => Number(event.exception_id) === Number(item.id)) })) as WorkspaceSnapshot["exceptions"],
    members: members.results as WorkspaceSnapshot["members"],
  };
}

async function planSeeds(db: ReturnType<typeof getD1>, source: PlanSource, sourceCohortId: number | undefined, starts: Record<Phase, string>) {
  if (source === "blank") return blankRows(starts);
  if (source === "standard") return standardRows(starts);
  if (!sourceCohortId) throw new Error("请选择要复制的营期");
  const rows = (await db.prepare("SELECT * FROM day_plans WHERE cohort_id=? ORDER BY sort_order").bind(sourceCohortId).all<D1Row>()).results;
  if (rows.length !== 25) throw new Error("来源营期的25天计划不完整");
  return rows.map((row): PlanSeed => [row.phase as Phase, Number(row.day_number), String(row.label), String(row.title), String(row.coach_action ?? ""), String(row.group_announcement ?? ""), String(row.materials ?? ""), String(row.learner_instructions ?? ""), String(row.reminder ?? ""), String(row.goal ?? ""), String(row.deliverable ?? ""), String(row.acceptance ?? ""), dueDate(row.phase as Phase, Number(row.day_number), starts), Number(row.sort_order), Number(row.configured)]);
}

export async function GET(request: Request) {
  try { return json(await snapshot(Number(new URL(request.url).searchParams.get("cohortId")) || undefined)); }
  catch (error) { const problem = error as Error & { status?: number }; return json({ error: problem.message || "读取失败" }, problem.status ?? 500); }
}

export async function POST(request: Request) {
  try {
    const { db, user, member } = await authorize();
    const body = await request.json() as Record<string, unknown>;
    const action = clean(body.action, 40);
    const owner = member.role === "owner";
    const requestedCohortId = Number(body.cohortId) || undefined;
    let responseCohortId = requestedCohortId;
    let writableCohort: WorkspaceSnapshot["cohort"] = null;
    if (!["initialize", "archive_cohort", "reopen_cohort"].includes(action)) {
      writableCohort = (await requireCohort(db, member.role, user.email, requestedCohortId)).cohort;
      if (!writableCohort) throw new Error("请先创建营期");
      try { assertCohortWritable(writableCohort.status); } catch (error) { throw Object.assign(error as Error, { status: 409 }); }
    }

    if (action === "initialize") {
      if (!owner) throw Object.assign(new Error("只有项目方可以创建营期"), { status: 403 });
      const name = clean(body.name, 80);
      if (!name) throw new Error("请填写营期名称");
      const starts = { pre_online: requireDate(body.preStartDate, "线上前10天"), offline_camp: requireDate(body.offlineStartDate, "线下5天"), post_online: requireDate(body.postStartDate, "线上后10天") };
      const source = clean(body.planSource, 20) || "standard";
      if (!["standard", "cohort", "blank"].includes(source)) throw new Error("计划来源不正确");
      const rows = await planSeeds(db, source as PlanSource, Number(body.sourceCohortId) || undefined, starts);
      const result = await db.prepare("INSERT INTO cohorts (name,pre_start_date,offline_start_date,post_start_date,initialized_by) VALUES (?,?,?,?,?)").bind(name, starts.pre_online, starts.offline_camp, starts.post_online, user.email).run();
      responseCohortId = Number(result.meta.last_row_id);
      await db.batch(rows.map((row) => db.prepare("INSERT INTO day_plans (cohort_id,phase,day_number,label,title,coach_action,group_announcement,materials,learner_instructions,reminder,goal,deliverable,acceptance,due_date,sort_order,configured,has_unpublished_changes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)").bind(responseCohortId, ...row)));
    } else if (action === "archive_cohort" || action === "reopen_cohort") {
      if (!owner) throw Object.assign(new Error("只有项目方可以变更营期状态"), { status: 403 });
      const { cohort } = await requireCohort(db, member.role, user.email, requestedCohortId);
      if (!cohort) throw new Error("营期不存在");
      if (action === "archive_cohort") await db.prepare("UPDATE cohorts SET status='archived',archived_at=CURRENT_TIMESTAMP,archived_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(user.email, cohort.id).run();
      else await db.prepare("UPDATE cohorts SET status='active',archived_at=NULL,archived_by=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(cohort.id).run();
    } else if (action === "save_day_draft") {
      const cohort = writableCohort!;
      if (!owner) throw Object.assign(new Error("只有项目方可以编辑教练执行卡"), { status: 403 });
      const id = Number(body.id);
      const title = clean(body.title, 120);
      if (!id || !title) throw new Error("请填写任务名称");
      const materials = validateHttpsLinksInText(clean(body.materials, 8000));
      const result = await db.prepare("UPDATE day_plans SET title=?,coach_action=?,group_announcement=?,materials=?,learner_instructions=?,reminder=?,goal=?,deliverable=?,acceptance=?,due_date=?,configured=1,has_unpublished_changes=1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND cohort_id=?").bind(title, clean(body.coachAction, 4000), clean(body.groupAnnouncement, 8000), materials, clean(body.learnerInstructions, 4000), clean(body.reminder, 2000), clean(body.goal, 2000), clean(body.deliverable, 2000), clean(body.acceptance, 2000), requireDate(body.dueDate, "任务"), id, cohort.id).run();
      if (!result.meta.changes) throw new Error("任务不属于当前营期");
    } else if (action === "publish_day") {
      const cohort = writableCohort!;
      if (!owner) throw Object.assign(new Error("只有项目方可以发布教练执行卡"), { status: 403 });
      const id = Number(body.id);
      const day = await db.prepare("SELECT * FROM day_plans WHERE id=? AND cohort_id=?").bind(id, cohort.id).first<D1Row>();
      if (!day) throw new Error("任务不属于当前营期");
      if (![day.title, day.coach_action, day.learner_instructions, day.goal, day.deliverable, day.acceptance].every((value) => clean(value))) throw new Error("发布前请完整填写教练动作、学员说明、目标、提交物和验收标准");
      validateHttpsLinksInText(day.materials);
      await db.batch([
        db.prepare("INSERT INTO day_plan_publications (day_plan_id,title,coach_action,group_announcement,materials,learner_instructions,reminder,goal,deliverable,acceptance,due_date,published_by,published_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(day_plan_id) DO UPDATE SET title=excluded.title,coach_action=excluded.coach_action,group_announcement=excluded.group_announcement,materials=excluded.materials,learner_instructions=excluded.learner_instructions,reminder=excluded.reminder,goal=excluded.goal,deliverable=excluded.deliverable,acceptance=excluded.acceptance,due_date=excluded.due_date,published_by=excluded.published_by,published_at=CURRENT_TIMESTAMP").bind(id, day.title, day.coach_action, day.group_announcement, day.materials, day.learner_instructions, day.reminder, day.goal, day.deliverable, day.acceptance, day.due_date, user.email),
        db.prepare("UPDATE day_plans SET has_unpublished_changes=0 WHERE id=? AND cohort_id=?").bind(id, cohort.id),
      ]);
    } else if (action === "add_coach_group" || action === "update_coach_group") {
      const cohort = writableCohort!;
      if (!owner) throw Object.assign(new Error("只有项目方可以管理教练和分组"), { status: 403 });
      const email = requireEmail(body.email);
      const displayName = clean(body.displayName, 80);
      const groupName = clean(body.groupName, 80);
      if (!displayName || !groupName) throw new Error("请完整填写教练姓名和组名");
      const existing = await db.prepare("SELECT role FROM members WHERE email=?").bind(email).first<{ role: Role }>();
      if (existing?.role === "owner") throw new Error("项目负责人不能改为教练");
      const statements = [db.prepare("INSERT INTO members (email,display_name,role) VALUES (?,?,'coach') ON CONFLICT(email) DO UPDATE SET display_name=excluded.display_name,updated_at=CURRENT_TIMESTAMP").bind(email, displayName)];
      if (action === "add_coach_group") statements.push(db.prepare("INSERT INTO groups (cohort_id,name,coach_email) VALUES (?,?,?)").bind(cohort.id, groupName, email));
      else {
        const groupId = Number(body.groupId);
        if (!await db.prepare("SELECT id FROM groups WHERE id=? AND cohort_id=?").bind(groupId, cohort.id).first()) throw new Error("小组不属于当前营期");
        statements.push(db.prepare("UPDATE groups SET name=?,coach_email=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND cohort_id=?").bind(groupName, email, groupId, cohort.id));
      }
      await db.batch(statements);
    } else if (action === "remove_empty_group") {
      const cohort = writableCohort!;
      if (!owner) throw Object.assign(new Error("只有项目方可以管理教练和分组"), { status: 403 });
      const groupId = Number(body.groupId);
      if (!await db.prepare("SELECT id FROM groups WHERE id=? AND cohort_id=?").bind(groupId, cohort.id).first()) throw new Error("小组不属于当前营期");
      const usage = await db.prepare("SELECT (SELECT COUNT(*) FROM learners WHERE group_id=?) learners,(SELECT COUNT(*) FROM exceptions WHERE group_id=?) exceptions_count").bind(groupId, groupId).first<{ learners: number; exceptions_count: number }>();
      if (Number(usage?.learners) || Number(usage?.exceptions_count)) throw new Error("该组已有学员或异常记录，请先合并到其他小组");
      await db.prepare("DELETE FROM groups WHERE id=? AND cohort_id=?").bind(groupId, cohort.id).run();
    } else if (action === "merge_group") {
      const cohort = writableCohort!;
      if (!owner) throw Object.assign(new Error("只有项目方可以管理教练和分组"), { status: 403 });
      const fromGroupId = Number(body.fromGroupId);
      const toGroupId = Number(body.toGroupId);
      if (!fromGroupId || !toGroupId || fromGroupId === toGroupId) throw new Error("请选择不同的目标小组");
      const groups = (await db.prepare("SELECT id FROM groups WHERE cohort_id=? AND id IN (?,?)").bind(cohort.id, fromGroupId, toGroupId).all()).results;
      if (groups.length !== 2) throw new Error("小组不属于当前营期");
      const duplicate = await db.prepare("SELECT 1 FROM learners a JOIN learners b ON lower(a.name)=lower(b.name) WHERE a.group_id=? AND b.group_id=? LIMIT 1").bind(fromGroupId, toGroupId).first();
      if (duplicate) throw new Error("两个小组存在同名学员，请先处理重名记录");
      await db.batch([db.prepare("UPDATE learners SET group_id=?,updated_at=CURRENT_TIMESTAMP WHERE group_id=?").bind(toGroupId, fromGroupId), db.prepare("UPDATE exceptions SET group_id=?,updated_at=CURRENT_TIMESTAMP WHERE group_id=?").bind(toGroupId, fromGroupId), db.prepare("DELETE FROM groups WHERE id=? AND cohort_id=?").bind(fromGroupId, cohort.id)]);
    } else if (action === "import_learners") {
      const cohort = writableCohort!;
      if (!owner) throw Object.assign(new Error("只有项目方可以导入学员"), { status: 403 });
      const groupRows = (await db.prepare("SELECT id,name FROM groups WHERE cohort_id=?").bind(cohort.id).all<{ id: number; name: string }>()).results;
      if (!groupRows.length) throw new Error("请先创建教练和小组");
      const records = parseLearnerRows(clean(body.text, 30000), Number(body.groupId) || null, groupRows);
      if (!records.length) throw new Error("没有可导入的学员");
      await db.batch(records.map((item) => db.prepare("INSERT OR IGNORE INTO learners (name,group_id,note) VALUES (?,?,?)").bind(item.name, item.groupId, item.note)));
    } else if (action === "update_progress") {
      const cohort = writableCohort!;
      const learnerId = Number(body.learnerId);
      const dayPlanId = Number(body.dayPlanId);
      const learnerGroup = await groupForLearner(db, learnerId);
      if (!learnerGroup) throw new Error("学员不存在");
      await requireGroupAccess(db, member.role, user.email, learnerGroup.id, cohort.id);
      const day = await db.prepare("SELECT d.id,p.day_plan_id published FROM day_plans d LEFT JOIN day_plan_publications p ON p.day_plan_id=d.id WHERE d.id=? AND d.cohort_id=?").bind(dayPlanId, cohort.id).first<{ id: number; published: number | null }>();
      if (!day || learnerGroup.cohort_id !== cohort.id) throw new Error("学员与任务不属于当前营期");
      if (!owner && !day.published) throw Object.assign(new Error("该任务尚未发布"), { status: 403 });
      const { evidenceUrl, evidenceNote } = validateProgressEvidence(body.status, body.evidenceUrl, body.evidenceNote);
      await db.prepare("INSERT INTO progress (learner_id,day_plan_id,status,evidence_url,evidence_note,updated_by) VALUES (?,?,?,?,?,?) ON CONFLICT(learner_id,day_plan_id) DO UPDATE SET status=excluded.status,evidence_url=excluded.evidence_url,evidence_note=excluded.evidence_note,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP").bind(learnerId, dayPlanId, body.status, evidenceUrl, evidenceNote.slice(0, 2000), user.email).run();
    } else if (action === "create_exception") {
      const cohort = writableCohort!;
      const learnerId = Number(body.learnerId);
      const learnerGroup = await groupForLearner(db, learnerId);
      if (!learnerGroup) throw new Error("请选择学员");
      await requireGroupAccess(db, member.role, user.email, learnerGroup.id, cohort.id);
      const problem = clean(body.problem, 2000);
      const requested = clean(body.request, 2000);
      if (!problem || !requested) throw new Error("请填写问题和需要的支持");
      const dayPlanId = Number(body.dayPlanId) || null;
      if (dayPlanId) {
        const day = await db.prepare("SELECT d.id,p.day_plan_id published FROM day_plans d LEFT JOIN day_plan_publications p ON p.day_plan_id=d.id WHERE d.id=? AND d.cohort_id=?").bind(dayPlanId, cohort.id).first<{ id: number; published: number | null }>();
        if (!day) throw new Error("任务不属于当前营期");
        if (!owner && !day.published) throw Object.assign(new Error("该任务尚未发布"), { status: 403 });
      }
      const result = await db.prepare("INSERT INTO exceptions (learner_id,group_id,day_plan_id,created_by,problem,request) VALUES (?,?,?,?,?,?)").bind(learnerId, learnerGroup.id, dayPlanId, user.email, problem, requested).run();
      await db.prepare("INSERT INTO exception_events (exception_id,actor_email,action,detail) VALUES (?,?,?,?)").bind(result.meta.last_row_id, user.email, "created", requested).run();
    } else if (action === "update_exception") {
      const cohort = writableCohort!;
      if (!owner) throw Object.assign(new Error("只有项目方可以处理异常"), { status: 403 });
      const id = Number(body.id);
      const status = clean(body.status, 30);
      const resolution = clean(body.resolution, 2000);
      if (!exceptionStatuses.includes(status)) throw new Error("异常状态不正确");
      if (status === "resolved" && !resolution) throw new Error("解决异常时必须填写处理结果");
      if (!await db.prepare("SELECT e.id FROM exceptions e JOIN groups g ON g.id=e.group_id WHERE e.id=? AND g.cohort_id=?").bind(id, cohort.id).first()) throw new Error("异常不属于当前营期");
      await db.batch([db.prepare("UPDATE exceptions SET status=?,resolution=?,handled_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(status, resolution, user.email, id), db.prepare("INSERT INTO exception_events (exception_id,actor_email,action,detail) VALUES (?,?,?,?)").bind(id, user.email, status, resolution)]);
    } else throw new Error("未知操作");
    return json(await snapshot(responseCohortId));
  } catch (error) {
    const problem = error as Error & { status?: number };
    return json({ error: problem.message || "保存失败" }, problem.status ?? 400);
  }
}
