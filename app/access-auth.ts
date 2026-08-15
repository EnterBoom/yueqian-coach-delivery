import { headers } from "next/headers";
import { accessUserFromHeaders } from "@/lib/access-auth.mjs";

export type AccessUser = {
  userId: string;
  displayName: string;
  email: string;
  fullName: string | null;
};

export async function getAccessUser(): Promise<AccessUser | null> {
  return accessUserFromHeaders(await headers(), {
    teamDomain: process.env.CF_ACCESS_TEAM_DOMAIN,
    audience: process.env.CF_ACCESS_AUD,
  });
}

export async function requireAccessUser(): Promise<AccessUser> {
  const user = await getAccessUser();
  if (!user) throw Object.assign(new Error("请先通过邮箱验证后再进入作战台"), { status: 401 });
  return user;
}

export const accessSignOutPath = "/cdn-cgi/access/logout";
