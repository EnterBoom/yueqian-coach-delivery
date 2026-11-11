"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { deliveryStatuses } from "@/lib/admissions.mjs";

type Admission = {
  id: string; student_id: number | null; name: string; nickname: string; phone: string;
  sales_name: string; channel: string; registered_on: string; product: string; price_cents: number;
  promise: string; status: string; cohort_id: number | null; group_id: number | null;
  cohort_name: string | null; cohort_code: string | null; group_name: string | null; coach_name: string | null;
  intended_cohort: string; follow_up_owner: string; delivery_note: string; source_error: string;
  version: number; synced_version: number;
};
type Event = { id: number; admission_id: string; actor: string; action: string; detail: string; created_at: string };
type Refund = { id: string; admission_id: string; name: string; amount_cents: number; explanation: string; attachments_json: string; source_error: string };
type Data = {
  admissions: Admission[]; events: Event[]; refunds: Refund[];
  groups: { id: number; cohort_id: number; name: string; coach_name: string }[];
  cohorts: { id: number; name: string; status: string; code: string | null }[];
  learners: { id: number; name: string; group_id: number; cohort_id: number }[];
  sync: { last_success: string | null; last_error: string; pull_offset: number };
  formUrl: string; refundFormUrl: string; baseUrl: string; configured: boolean;
};

async function request(body?: Record<string, unknown>) {
  const response = await fetch("/api/admissions", body ? {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  } : { cache: "no-store" });
  const data = await response.json() as Data & { error?: string; busy?: boolean };
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

const money = (cents: number) => new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(cents / 100);
const localTime = (value: string | null) => value ? new Date(`${value.replace(" ", "T")}Z`).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "尚未同步";
const studentCode = (id: number | null) => id ? `YQ${String(id).padStart(6, "0")}` : "待核对";

export function AdmissionsPanel() {
  const [data, setData] = useState<Data | null>(null);
  const [selected, setSelected] = useState("");
  const [filter, setFilter] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => { setData(await request()); }, []);
  useEffect(() => {
    request().then((result) => {
      setData(result);
      setSelected(new URLSearchParams(window.location.search).get("admission") || "");
    }).catch((e) => setError(e.message));
  }, [load]);

  async function mutate(body: Record<string, unknown>) {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await request(body);
      await load();
      setNotice(result.busy ? "同步正在进行，请稍后刷新。" : body.action === "sync" ? "已完成本轮同步。" : "安排已保存，分组结果将在下一轮同步回写飞书。");
      return true;
    } catch (e) { setError((e as Error).message); return false; }
    finally { setBusy(false); }
  }
  if (!data) return <section className="content-page"><h1>报名与交接</h1><p>{error || "正在读取报名工单…"}</p><button onClick={() => load().catch((e) => setError(e.message))}>重新读取</button></section>;
  const current = data.admissions.find((row) => row.id === selected);
  const rows = data.admissions.filter((row) => (!filter || row.status === filter) &&
    `${row.name} ${row.nickname} ${row.phone} ${row.sales_name} ${studentCode(row.student_id)}`.includes(query));
  const invalidRefunds = data.refunds.filter((row) => row.source_error);
  return <section className="content-page admissions-page">
    <div className="section-head"><div><h1>报名与交接</h1><p>销售登记、营期安排、延期结转和退费记录</p></div><button className="primary" disabled={busy || !data.configured} onClick={() => mutate({ action: "sync" })}>{busy ? "处理中…" : "立即同步飞书"}</button></div>
    <div className="admission-links">
      {data.formUrl && <a href={data.formUrl} target="_blank" rel="noreferrer">销售报名表 ↗</a>}
      {data.refundFormUrl && <a href={data.refundFormUrl} target="_blank" rel="noreferrer">退费申请表 ↗</a>}
      {data.baseUrl && <a href={data.baseUrl} target="_blank" rel="noreferrer">飞书台账 ↗</a>}
      <span>{data.configured ? "每5分钟自动同步" : "待配置飞书连接"}</span>
    </div>
    <p className="admission-sync">最近成功同步 {localTime(data.sync.last_success)}{data.sync.last_error && ` · ${data.sync.last_error}`}</p>
    {(error || notice) && <p role="status" className={error ? "form-error" : "admission-notice"}>{error || notice}</p>}
    {invalidRefunds.length > 0 && <details className="admission-warning"><summary>{invalidRefunds.length} 条退费申请待核对</summary>{invalidRefunds.map((row) => <p key={row.id}>{row.name} · {row.source_error} · {row.id}</p>)}</details>}
    <div className="admission-filters"><label>查找学员<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="姓名、微信昵称、手机号、销售"/></label><label>交付状态<select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="">全部（{data.admissions.length}）</option>{deliveryStatuses.map((status: string) => <option key={status}>{status}</option>)}</select></label><button disabled={busy} onClick={() => load().catch((e) => setError(e.message))}>刷新</button></div>
    <div className="admission-table-wrap"><table className="admission-table"><thead><tr><th>学员</th><th>销售 / 渠道</th><th>报名产品</th><th>交付状态</th><th>营期 / 教练</th><th>操作</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}>
      <td><strong>{row.name || "待补姓名"}</strong><small>{row.nickname} · {row.phone}</small><small>{studentCode(row.student_id)}</small></td>
      <td>{row.sales_name}<small>{row.channel}</small></td><td>{row.product}<small>{money(row.price_cents)} · {row.registered_on}</small></td>
      <td>{row.status}<small className={row.source_error ? "form-error" : ""}>{row.source_error || (row.synced_version < row.version ? "待回写飞书" : "已同步")}</small></td>
      <td>{row.cohort_name || "待安排"}<small>{row.group_name || "待分配"} · {row.coach_name || "待分配"}</small></td>
      <td><button onClick={() => setSelected(row.id)}>查看 / 安排</button></td></tr>)}</tbody></table></div>
    {!rows.length && <p className="admission-empty">{data.admissions.length ? "没有符合条件的学员。" : "销售提交报名表后，记录会出现在这里。"}</p>}
    {current && <AdmissionEditor key={`${current.id}-${current.version}`} row={current} data={data} busy={busy} mutate={mutate} close={() => setSelected("")}/>}
  </section>;
}

function AdmissionEditor({ row, data, busy, mutate, close }: { row: Admission; data: Data; busy: boolean; mutate: (body: Record<string, unknown>) => Promise<boolean>; close: () => void }) {
  const [status, setStatus] = useState(row.status);
  const [cohortId, setCohortId] = useState(String(row.cohort_id || ""));
  const [groupId, setGroupId] = useState(String(row.group_id || ""));
  const [code, setCode] = useState(row.cohort_code || "");
  const terminal = row.status === "已退费";
  const selectStatus = (next: string) => {
    setStatus(next);
    if (["待安排", "延期待交付", "已退费"].includes(next)) { setCohortId(""); setGroupId(""); setCode(""); }
  };
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.currentTarget));
    await mutate({ ...values, action: "update", id: row.id, version: row.version, status, cohortId, groupId, cohortCode: code });
  };
  const events = data.events.filter((event) => event.admission_id === row.id);
  return <div className="admission-detail">
    <div className="section-head"><div><h2>{row.name} · {studentCode(row.student_id)}</h2><small>报名编号 {row.id}</small></div><button onClick={close}>关闭详情</button></div>
    <div className="admission-handoff"><p><strong>报名交接</strong> {row.sales_name} · {row.channel} · {row.registered_on}</p><p>{row.product} · {money(row.price_cents)}</p><p><strong>特别承诺</strong></p><p className="copy-block">{row.promise}</p></div>
    {row.source_error && <p className="form-error">请在飞书修正资料后重新同步。{row.source_error}</p>}
    <form onSubmit={submit}><fieldset disabled={busy || terminal || Boolean(row.source_error)}><div className="admission-edit-grid">
      <label>交付状态<select value={status} onChange={(e) => selectStatus(e.target.value)}>{deliveryStatuses.map((value: string) => <option key={value}>{value}</option>)}</select></label>
      <label>当前营期<select value={cohortId} onChange={(e) => { setCohortId(e.target.value); setGroupId(""); setCode(data.cohorts.find((c) => String(c.id) === e.target.value)?.code || ""); }}><option value="">待安排</option>{data.cohorts.filter((c) => c.status === "active").map((c) => <option value={c.id} key={c.id}>{c.name}</option>)}</select></label>
      <label>营期编号<input value={code} onChange={(e) => setCode(e.target.value)} placeholder="例如 YQ11" required={Boolean(cohortId)}/></label>
      <label>小组及交付教练<select value={groupId} onChange={(e) => setGroupId(e.target.value)}><option value="">待分配</option>{data.groups.filter((g) => String(g.cohort_id) === cohortId).map((g) => <option value={g.id} key={g.id}>{g.name} · {g.coach_name}</option>)}</select></label>
      <label>关联本期已有学员<select name="existingLearnerId" defaultValue=""><option value="">首次分组时新建，已有绑定时沿用</option>{data.learners.filter((l) => String(l.cohort_id) === cohortId).map((l) => <option key={l.id} value={l.id}>{l.name} · {data.groups.find((g) => g.id === l.group_id)?.name}</option>)}</select></label>
      <label>意向参加营期<input name="intendedCohort" defaultValue={row.intended_cohort} placeholder="尚未确认时可填写待定"/></label>
      <label>跟进人<input name="followUpOwner" defaultValue={row.follow_up_owner || row.sales_name}/></label>
      <label>交付进度备注<textarea name="deliveryNote" defaultValue={row.delivery_note} placeholder="例如已跟线上，线下待安排"/></label>
      <label className="wide">本次处理说明<textarea name="detail" required={["延期待交付", "退费处理中", "已退费"].includes(status)} placeholder="填写延期、转期或退费处理情况"/></label>
      {status === "已退费" && <><label>实际退费金额（元）<input type="number" min="0" step="0.01" max={row.price_cents / 100} name="refundAmount" required/></label><label>退费日期<input type="date" name="refundDate" required/></label></>}
    </div><button className="primary" disabled={busy}>{busy ? "正在保存…" : "保存安排"}</button></fieldset></form>
    {terminal && <p>本次报名已退费归档。</p>}
    {data.refunds.filter((r) => r.admission_id === row.id).map((refund) => <section className="admission-refund" key={refund.id}><h3>退费申请 · {money(refund.amount_cents)}</h3><p className="copy-block">{refund.explanation}</p>{refund.source_error && <p className="form-error">{refund.source_error}</p>}<RefundAttachments refund={refund}/></section>)}
    <h3>流转记录</h3><div className="admission-events">{events.map((event) => <details key={event.id}><summary>{localTime(event.created_at)} · {event.action} · {event.actor}</summary><pre>{formatEvent(event.detail)}</pre></details>)}</div>
  </div>;
}

function formatEvent(detail: string) {
  const labels: Record<string, string> = {
    from: "原状态", to: "更新后状态", previousCohortId: "原营期记录", cohortId: "当前营期记录",
    groupId: "小组记录", detail: "处理说明", intendedCohort: "意向营期", deliveryNote: "交付备注",
    name: "真实姓名", nickname: "微信昵称", phone: "手机号", sales_name: "销售负责人",
    channel: "报名渠道", registered_on: "报名日期", product: "购买产品", price_cents: "成交金额（分）",
    promise: "特别承诺", refundId: "退费申请编号", refundAmount: "实际退费金额（元）", refundDate: "退费日期",
  };
  try {
    return Object.entries(JSON.parse(detail)).map(([key, value]) =>
      `${labels[key] || key} · ${typeof value === "object" ? JSON.stringify(value) : value ?? "待安排"}`).join("\n");
  } catch { return detail; }
}

function RefundAttachments({ refund }: { refund: Refund }) {
  let attachments: { token?: string; file_token?: string; name?: string; type?: string }[] = [];
  try { attachments = JSON.parse(refund.attachments_json); } catch { return <p>附件信息无法解析，请在飞书查看。</p>; }
  return <div className="refund-attachments">{attachments.map((file, index) => {
    const token = file.file_token || file.token;
    if (!token) return <p key={index}>{file.name || "附件"} · 请在飞书台账查看</p>;
    const url = `/api/admissions/attachment?refund=${encodeURIComponent(refund.id)}&token=${encodeURIComponent(token)}`;
    // eslint-disable-next-line jsx-a11y/media-has-caption -- Original uploaded recordings have no captions; the refund explanation is shown alongside.
    return <div key={token}><a href={url} target="_blank" rel="noreferrer">{file.name || "查看附件"}</a>{/\.(mp3|m4a|wav|ogg|aac)$/i.test(file.name || "") && <audio controls preload="none" src={url}/>}</div>;
  })}</div>;
}
