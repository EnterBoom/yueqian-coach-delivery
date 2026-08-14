import { OperationsApp } from "./operations-app";
import { requireChatGPTUser } from "./chatgpt-auth";
import { getSiteUser } from "@/lib/site-auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (process.env.NODE_ENV === "development") await getSiteUser();
  else await requireChatGPTUser("/");
  return <OperationsApp />;
}
