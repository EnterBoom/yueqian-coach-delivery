import { ensureSchema, getD1 } from "@/db";
import { getSiteUser } from "@/lib/site-auth";
import { parseLearnerRows } from "@/lib/import-learners.mjs";
import type { Member, Phase, Role, WorkspaceSnapshot } from "@/lib/types";
import {
  canAccessGroup,
  exceptionStatuses,
  validateProgressEvidence,
} from "@/lib/policy.mjs";

export const dynamic = "force-dynamic";

type D1Row = Record<string, unknown>;

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

function clean(value: unknown, max = 2000) {
  return String(value ?? "").trim().slice(0, max);
}

function requireDate(value: unknown, label: string) {
  const text = clean(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new Error(`${label}日期不正确`);
  }
  return text;
}

function addDays(date: string, offset: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
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

function planRows(preStart: string, offlineStart: string, postStart: string) {
  const rows: Array<[Phase, number, string, string, string, string, string, string, number, number]> = [];
  preCamp.forEach((item, index) => rows.push([
    "pre_online", index + 1, `D-${10 - index}`, ...item, addDays(preStart, index), index + 1, 1,
  ]));
  for (let index = 0; index < 5; index += 1) rows.push([
    "offline_camp", index + 1, `Day ${index + 1}`, `待配置｜线下第${index + 1}天`, "", "", "", addDays(offlineStart, index), 11 + index, 0,
  ]);
  for (let index = 0; index < 10; index += 1) rows.push([
    "post_online", index + 1, `P+${index + 1}`, `待配置｜线上陪跑第${index + 1}天`, "", "", "", addDays(postStart, index), 16 + index, 0,
  ]);
  return rows;
}

async function authorize() {
  const user = await getSiteUser();
  if (!user) throw Object.assign(new Error("请先登录 ChatGPT 后再进入作战台"), { status: 401 });
  await ensureSchema();
  const db = getD1();
  const initialOwnerEmail = process.env.INITIAL_OWNER_EMAIL?.trim().toLowerCase();
  if (initialOwnerEmail) {
    await db.prepare("INSERT OR IGNORE INTO members (email,display_name,role) VALUES (?,?,'owner')")
      .bind(initialOwnerEmail, initialOwnerEmail).run();
  } else if (process.env.NODE_ENV === "development") {
    await db.prepare("INSERT OR IGNORE INTO members (email,user_id,display_name,role) VALUES (?,?,?,'owner')")
      .bind(user.email, user.userId, user.displayName).run();
  }
  const member = await db.prepare("SELECT email,user_id,display_name,role FROM members WHERE email = ?")
    .bind(user.email).first<Member>();
  if (!member) throw Object.assign(new Error("该邮箱尚未分配项目角色"), { status: 403 });
  await db.prepare("UPDATE members SET user_id=?, display_name=?, updated_at=CURRENT_TIMESTAMP WHERE email=?")
    .bind(user.userId, user.displayName, user.email).run();
  return { db, user, member };
}

async function groupForLearner(db: ReturnType<typeof getD1>, learnerId: number) {
  return db.prepare("SELECT g.id,g.coach_email,l.name FROM learners l JOIN groups g ON g.id=l.group_id WHERE l.id=?")
    .bind(learnerId).first<{ id: number; coach_email: string; name: string }>();
}

async function requireGroupAccess(db: ReturnType<typeof getD1>, role: Role, email: string, groupId: number) {
  const group = await db.prepare("SELECT id,coach_email FROM groups WHERE id=?").bind(groupId)
    .first<{ id: number; coach_email: string }>();
  if (!group || !canAccessGroup(role, email, group.coach_email)) {
    throw Object.assign(new Error("你没有权限操作这个小组"), { status: 403 });
  }
  return group;
}

async function snapshot(): Promise<WorkspaceSnapshot> {
  const { db, user, member } = await authorize();
  const owner = member.role === "owner";
  const cohort = await db.prepare("SELECT id,name,pre_start_date,offline_start_date,post_start_date FROM cohorts WHERE id=1").first();
  const groupSql = owner
    ? "SELECT g.id,g.name,g.coach_email,COUNT(l.id) learner_count FROM groups g LEFT JOIN learners l ON l.group_id=g.id GROUP BY g.id ORDER BY g.id"
    : "SELECT g.id,g.name,g.coach_email,COUNT(l.id) learner_count FROM groups g LEFT JOIN learners l ON l.group_id=g.id WHERE g.coach_email=? GROUP BY g.id ORDER BY g.id";
  const learnerSql = owner
    ? "SELECT l.id,l.name,l.group_id,g.name group_name,l.note FROM learners l JOIN groups g ON g.id=l.group_id ORDER BY g.id,l.id"
    : "SELECT l.id,l.name,l.group_id,g.name group_name,l.note FROM learners l JOIN groups g ON g.id=l.group_id WHERE g.coach_email=? ORDER BY g.id,l.id";
  const progressSql = owner
    ? "SELECT p.* FROM progress p JOIN learners l ON l.id=p.learner_id ORDER BY p.updated_at DESC"
    : "SELECT p.* FROM progress p JOIN learners l ON l.id=p.learner_id JOIN groups g ON g.id=l.group_id WHERE g.coach_email=? ORDER BY p.updated_at DESC";
  const exceptionSql = `${owner
    ? "SELECT e.*,l.name learner_name,g.name group_name,d.label day_label FROM exceptions e LEFT JOIN learners l ON l.id=e.learner_id JOIN groups g ON g.id=e.group_id LEFT JOIN day_plans d ON d.id=e.day_plan_id"
    : "SELECT e.*,l.name learner_name,g.name group_name,d.label day_label FROM exceptions e LEFT JOIN learners l ON l.id=e.learner_id JOIN groups g ON g.id=e.group_id LEFT JOIN day_plans d ON d.id=e.day_plan_id WHERE g.coach_email=?"} ORDER BY CASE e.status WHEN 'open' THEN 0 WHEN 'handling' THEN 1 ELSE 2 END,e.updated_at DESC`;
  const bind = <T extends D1Row>(sql: string) => owner ? db.prepare(sql).all<T>() : db.prepare(sql).bind(user.email).all<T>();
  const [groups, learners, dayPlans, progress, exceptions, members] = await Promise.all([
    bind(groupSql), bind(learnerSql), db.prepare("SELECT * FROM day_plans ORDER BY sort_order").all(), bind(progressSql), bind(exceptionSql),
    owner ? db.prepare("SELECT email,user_id,display_name,role FROM members ORDER BY role DESC,display_name").all() : Promise.resolve({ results: [] }),
  ]);
  const exceptionRows = exceptions.results as D1Row[];
  const exceptionIds = exceptionRows.map((item: D1Row) => Number(item.id));
  let events: D1Row[] = [];
  if (exceptionIds.length) {
    const placeholders = exceptionIds.map(() => "?").join(",");
    events = (await db.prepare(`SELECT * FROM exception_events WHERE exception_id IN (${placeholders}) ORDER BY created_at`).bind(...exceptionIds).all()).results;
  }
  return {
    user: { ...user, role: member.role },
    cohort: cohort as WorkspaceSnapshot["cohort"],
    groups: groups.results as WorkspaceSnapshot["groups"],
    learners: learners.results as WorkspaceSnapshot["learners"],
    dayPlans: dayPlans.results as WorkspaceSnapshot["dayPlans"],
    progress: progress.results as WorkspaceSnapshot["progress"],
    exceptions: exceptionRows.map((item: D1Row) => ({
      ...item,
      events: events.filter((event) => Number(event.exception_id) === Number(item.id)),
    })) as WorkspaceSnapshot["exceptions"],
    members: members.results as WorkspaceSnapshot["members"],
  };
}

export async function GET() {
  try {
    return json(await snapshot());
  } catch (error) {
    const problem = error as Error & { status?: number };
    return json({ error: problem.message || "读取失败" }, problem.status ?? 500);
  }
}

export async function POST(request: Request) {
  try {
    const { db, user, member } = await authorize();
    const body = await request.json() as Record<string, unknown>;
    const action = clean(body.action, 40);
    const owner = member.role === "owner";

    if (action === "initialize") {
      if (!owner) throw Object.assign(new Error("只有项目方可以初始化营期"), { status: 403 });
      if (await db.prepare("SELECT id FROM cohorts WHERE id=1").first()) throw new Error("营期已经初始化");
      const name = clean(body.name, 80);
      if (!name) throw new Error("请填写营期名称");
      const preStart = requireDate(body.preStartDate, "线上前10天");
      const offlineStart = requireDate(body.offlineStartDate, "线下5天");
      const postStart = requireDate(body.postStartDate, "线上后10天");
      const rows = planRows(preStart, offlineStart, postStart);
      await db.batch([
        db.prepare("INSERT INTO cohorts (id,name,pre_start_date,offline_start_date,post_start_date,initialized_by) VALUES (1,?,?,?,?,?)")
          .bind(name, preStart, offlineStart, postStart, user.email),
        ...rows.map((row) => db.prepare("INSERT INTO day_plans (phase,day_number,label,title,goal,deliverable,acceptance,due_date,sort_order,configured) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(...row)),
      ]);
    } else if (action === "update_day") {
      if (!owner) throw Object.assign(new Error("只有项目方可以编辑25天计划"), { status: 403 });
      const id = Number(body.id);
      const title = clean(body.title, 120);
      if (!id || !title) throw new Error("任务信息不完整");
      await db.prepare("UPDATE day_plans SET title=?,goal=?,deliverable=?,acceptance=?,due_date=?,configured=1,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(title, clean(body.goal), clean(body.deliverable), clean(body.acceptance), requireDate(body.dueDate, "任务"), id).run();
    } else if (action === "add_coach_group") {
      if (!owner) throw Object.assign(new Error("只有项目方可以管理教练和分组"), { status: 403 });
      const email = clean(body.email, 160).toLowerCase();
      const displayName = clean(body.displayName, 80);
      const groupName = clean(body.groupName, 80);
      if (!/^\S+@\S+\.\S+$/.test(email) || !displayName || !groupName) throw new Error("请完整填写教练姓名、邮箱和组名");
      const existing = await db.prepare("SELECT role FROM members WHERE email=?").bind(email).first<{ role: Role }>();
      if (existing?.role === "owner") throw new Error("项目负责人不能改为教练");
      await db.batch([
        db.prepare("INSERT INTO members (email,display_name,role) VALUES (?,?,'coach') ON CONFLICT(email) DO UPDATE SET display_name=excluded.display_name,updated_at=CURRENT_TIMESTAMP").bind(email, displayName),
        db.prepare("INSERT INTO groups (name,coach_email) VALUES (?,?)").bind(groupName, email),
      ]);
    } else if (action === "import_learners") {
      if (!owner) throw Object.assign(new Error("只有项目方可以导入学员"), { status: 403 });
      const text = clean(body.text, 30000);
      const groupRows = (await db.prepare("SELECT id,name FROM groups").all<{ id: number; name: string }>()).results as Array<{ id: number; name: string }>;
      if (!groupRows.length) throw new Error("请先创建教练和小组");
      const records = parseLearnerRows(text, Number(body.groupId) || null, groupRows);
      if (!records.length) throw new Error("没有可导入的学员");
      await db.batch(records.map((item) => db.prepare("INSERT OR IGNORE INTO learners (name,group_id,note) VALUES (?,?,?)").bind(item.name, item.groupId, item.note)));
    } else if (action === "update_progress") {
      const learnerId = Number(body.learnerId);
      const dayPlanId = Number(body.dayPlanId);
      const learnerGroup = await groupForLearner(db, learnerId);
      if (!learnerGroup) throw new Error("学员不存在");
      await requireGroupAccess(db, member.role, user.email, learnerGroup.id);
      const { evidenceUrl, evidenceNote } = validateProgressEvidence(body.status, body.evidenceUrl, body.evidenceNote);
      await db.prepare("INSERT INTO progress (learner_id,day_plan_id,status,evidence_url,evidence_note,updated_by) VALUES (?,?,?,?,?,?) ON CONFLICT(learner_id,day_plan_id) DO UPDATE SET status=excluded.status,evidence_url=excluded.evidence_url,evidence_note=excluded.evidence_note,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP")
        .bind(learnerId, dayPlanId, body.status, evidenceUrl, evidenceNote.slice(0, 2000), user.email).run();
    } else if (action === "create_exception") {
      const learnerId = Number(body.learnerId);
      const learnerGroup = await groupForLearner(db, learnerId);
      if (!learnerGroup) throw new Error("请选择学员");
      await requireGroupAccess(db, member.role, user.email, learnerGroup.id);
      const problem = clean(body.problem, 2000);
      const requested = clean(body.request, 2000);
      if (!problem || !requested) throw new Error("请填写问题和需要的支持");
      const result = await db.prepare("INSERT INTO exceptions (learner_id,group_id,day_plan_id,created_by,problem,request) VALUES (?,?,?,?,?,?)")
        .bind(learnerId, learnerGroup.id, Number(body.dayPlanId) || null, user.email, problem, requested).run();
      await db.prepare("INSERT INTO exception_events (exception_id,actor_email,action,detail) VALUES (?,?,?,?)")
        .bind(result.meta.last_row_id, user.email, "created", requested).run();
    } else if (action === "update_exception") {
      if (!owner) throw Object.assign(new Error("只有项目方可以处理异常"), { status: 403 });
      const id = Number(body.id);
      const status = clean(body.status, 30);
      const resolution = clean(body.resolution, 2000);
      if (!exceptionStatuses.includes(status)) throw new Error("异常状态不正确");
      if (status === "resolved" && !resolution) throw new Error("解决异常时必须填写处理结果");
      await db.batch([
        db.prepare("UPDATE exceptions SET status=?,resolution=?,handled_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(status, resolution, user.email, id),
        db.prepare("INSERT INTO exception_events (exception_id,actor_email,action,detail) VALUES (?,?,?,?)").bind(id, user.email, status, resolution),
      ]);
    } else {
      throw new Error("未知操作");
    }
    return json(await snapshot());
  } catch (error) {
    const problem = error as Error & { status?: number };
    return json({ error: problem.message || "保存失败" }, problem.status ?? 400);
  }
}
