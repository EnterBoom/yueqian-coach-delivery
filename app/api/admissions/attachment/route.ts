import { env } from "cloudflare:workers";
import { authorizeWorkspace } from "@/lib/workspace-auth";
import { createFeishuClient, ensureAdmissionSchema } from "@/lib/admissions.mjs";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { db, member } = await authorizeWorkspace();
    if (member.role !== "owner") return new Response("没有查看退费附件的权限", { status: 403 });
    await ensureAdmissionSchema(db);
    const params = new URL(request.url).searchParams;
    const token = params.get("token");
    const refund = await db.prepare("SELECT attachments_json FROM refund_requests WHERE id=?").bind(params.get("refund") || "").first<{ attachments_json: string }>();
    const attachments = JSON.parse(refund?.attachments_json || "[]") as { token?: string; file_token?: string; name?: string }[];
    const file = attachments.find((item) => (item.file_token || item.token) === token);
    if (!file || !token || !/^[a-zA-Z0-9_-]+$/.test(token)) return new Response("附件不存在", { status: 404 });
    const response = await createFeishuClient(env).request(`/drive/v1/medias/${encodeURIComponent(token)}/download`, "GET", undefined, true) as Response;
    const type = response.headers.get("content-type") || "application/octet-stream";
    const inline = /^(image\/(png|jpeg|webp|gif)|audio\/(mpeg|mp4|wav|x-wav|ogg|aac))(;|$)/i.test(type);
    return new Response(response.body, { headers: {
      "content-type": type, "cache-control": "private, no-store", "x-content-type-options": "nosniff",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name || "附件")}`,
    } });
  } catch {
    return new Response("附件读取失败，请在飞书台账打开原附件，或检查机器人的文件下载权限。", { status: 502 });
  }
}
