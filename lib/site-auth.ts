import { getAccessUser } from "@/app/access-auth";
import type { SiteUser } from "./types";

export async function getSiteUser(): Promise<SiteUser | null> {
  const user = await getAccessUser();
  if (user) return { userId: user.userId, email: user.email.toLowerCase(), displayName: user.displayName };
  if (process.env.NODE_ENV === "development") {
    return { userId: "local-owner", email: "owner@local.test", displayName: "本地项目负责人" };
  }
  return null;
}
