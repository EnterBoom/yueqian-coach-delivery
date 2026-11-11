import { ensureSchema, getD1 } from "@/db";
import { getSiteUser } from "@/lib/site-auth";
import type { Member } from "@/lib/types";

export async function authorizeWorkspace() {
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

