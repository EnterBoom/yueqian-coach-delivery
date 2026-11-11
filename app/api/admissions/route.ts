import { env } from "cloudflare:workers";
import { authorizeWorkspace } from "@/lib/workspace-auth";
import { admissionSelect, ensureAdmissionSchema, syncAdmissions } from "@/lib/admissions.mjs";
import { updateAdmission } from "@/lib/admission-actions.mjs";

export const dynamic = "force-dynamic";

async function ownerAccess() {
  const access = await authorizeWorkspace();
  if (access.member.role !== "owner") throw Object.assign(new Error("只有项目负责人可以管理报名工单"), { status: 403 });
  await ensureAdmissionSchema(access.db);
  return access;
}

function reply(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "cache-control": "no-store" } });
}

function failure(error: unknown) {
  const problem = error as Error & { status?: number };
  return reply({ error: problem.message }, problem.status || 400);
}

export async function GET() {
  try {
    const { db } = await ownerAccess();
    const [admissions, events, groups, cohorts, learners, refunds, sync] = await Promise.all([
      db.prepare(`${admissionSelect} ORDER BY a.created_at DESC,a.id`).all(),
      db.prepare("SELECT * FROM admission_events ORDER BY id DESC").all(),
      db.prepare("SELECT g.*,COALESCE(m.display_name,g.coach_email) coach_name FROM groups g LEFT JOIN members m ON m.email=g.coach_email").all(),
      db.prepare("SELECT c.*,cc.code FROM cohorts c LEFT JOIN admission_cohort_codes cc ON cc.cohort_id=c.id ORDER BY c.id DESC").all(),
      db.prepare("SELECT l.id,l.name,l.group_id,g.cohort_id FROM learners l JOIN groups g ON g.id=l.group_id").all(),
      db.prepare("SELECT * FROM refund_requests ORDER BY created_at DESC").all(),
      db.prepare("SELECT last_success,last_error,pull_offset FROM admission_sync_state WHERE id=1").first(),
    ]);
    const runtime = env as unknown as Record<string, string>;
    return reply({ admissions: admissions.results, events: events.results, groups: groups.results,
      cohorts: cohorts.results, learners: learners.results, refunds: refunds.results, sync,
      formUrl: runtime.FEISHU_REGISTRATION_FORM_URL || "", refundFormUrl: runtime.FEISHU_REFUND_FORM_URL || "",
      baseUrl: runtime.FEISHU_BASE_URL || "", configured: Boolean(runtime.FEISHU_APP_SECRET && runtime.FEISHU_BASE_TOKEN) });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin) return reply({ error: "请求来源不匹配" }, 403);
    const { db, user } = await ownerAccess();
    const body = await request.json() as Record<string, unknown>;
    if (body.action === "sync") return reply(await syncAdmissions(db, env));
    if (body.action !== "update") throw new Error("未知操作");
    await updateAdmission(db, body, user.email);
    return reply({ ok: true });
  } catch (error) { return failure(error); }
}
