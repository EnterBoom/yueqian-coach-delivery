import { ensureSchema, getD1 } from "@/db";
import { buildInterviewPrompt, buildInterviewSummaryPrompt, parseInterviewReply } from "@/lib/interview.mjs";
import { getSiteUser } from "@/lib/site-auth";
import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

type ChatMessage = { role: "user" | "assistant"; content: string };
type StoryNode = { node: string; value: number; completeness: number };

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

function clean(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

function messages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-30).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const role = record.role === "user" ? "user" : record.role === "assistant" ? "assistant" : null;
    const content = clean(record.content, 8000);
    return role && content ? [{ role, content }] : [];
  });
}

function storyNodes(value: unknown): StoryNode[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-80).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const node = clean(record.node, 200);
    return node ? [{ node, value: Number(record.value) || 0, completeness: Number(record.completeness) || 0 }] : [];
  });
}

async function authorizeMember() {
  const user = await getSiteUser();
  if (!user) throw Object.assign(new Error("请先登录后再使用访谈工具"), { status: 401 });
  await ensureSchema();
  const member = await getD1().prepare("SELECT email FROM members WHERE email=?").bind(user.email).first();
  if (!member) throw Object.assign(new Error("该邮箱尚未分配项目角色"), { status: 403 });
}

async function callModel(body: Array<{ role: string; content: string }>, temperature: number) {
  const runtimeEnv = env as unknown as {
    DEEPSEEK_API_KEY?: string;
    INTERVIEW_LLM_BASE_URL?: string;
    INTERVIEW_LLM_MODEL?: string;
  };
  const apiKey = runtimeEnv.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) throw Object.assign(new Error("访谈模型尚未配置，请联系项目负责人"), { status: 503 });
  const baseUrl = (runtimeEnv.INTERVIEW_LLM_BASE_URL || "https://api.deepseek.com/v1").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: runtimeEnv.INTERVIEW_LLM_MODEL || "deepseek-chat",
      messages: body,
      temperature,
      max_tokens: 1200,
      stream: false,
    }),
  });
  if (!response.ok) {
    const detail = clean(await response.text().catch(() => ""), 300);
    throw Object.assign(new Error(`访谈模型暂时不可用（${response.status}）${detail ? `：${detail}` : ""}`), { status: 502 });
  }
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return clean(data.choices?.[0]?.message?.content, 12000);
}

export async function POST(request: Request) {
  try {
    await authorizeMember();
    const body = await request.json() as Record<string, unknown>;
    const action = clean(body.action, 20);
    const history = messages(body.history);
    if (action === "chat") {
      const raw = await callModel([
        { role: "system", content: buildInterviewPrompt(clean(body.nineGrid, 12000)) },
        ...history,
      ], 0.8);
      const reply = parseInterviewReply(raw);
      if (!reply.reply) throw Object.assign(new Error("访谈模型没有返回有效内容"), { status: 502 });
      return json(reply);
    }
    if (action === "summary") {
      const raw = await callModel(buildInterviewSummaryPrompt(history, storyNodes(body.nodes)), 0.6);
      if (!raw) throw Object.assign(new Error("访谈小结生成失败"), { status: 502 });
      return json({ summary: raw });
    }
    return json({ error: "不支持的访谈操作" }, 400);
  } catch (error) {
    const problem = error as Error & { status?: number };
    return json({ error: problem.message || "访谈服务异常" }, problem.status ?? 500);
  }
}
