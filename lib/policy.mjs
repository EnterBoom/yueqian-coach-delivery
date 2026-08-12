export const roles = ["owner", "coach"];
export const phases = ["pre_online", "offline_camp", "post_online"];
export const progressStatuses = ["not_started", "in_progress", "needs_revision", "passed"];
export const exceptionStatuses = ["open", "handling", "resolved"];

export function canAccessGroup(role, actorEmail, coachEmail) {
  return role === "owner" || actorEmail.toLowerCase() === coachEmail.toLowerCase();
}

export function normalizeHttpsUrl(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("证据链接格式不正确");
  }
  if (url.protocol !== "https:") throw new Error("证据链接必须使用 HTTPS");
  return url.toString();
}

export function validateProgressEvidence(status, url, note) {
  if (!progressStatuses.includes(status)) throw new Error("进度状态不正确");
  const evidenceUrl = normalizeHttpsUrl(url);
  const evidenceNote = String(note ?? "").trim();
  if (status === "passed" && !evidenceUrl && !evidenceNote) {
    throw new Error("标记已通过时必须填写证据链接或验收记录");
  }
  return { evidenceUrl, evidenceNote };
}
