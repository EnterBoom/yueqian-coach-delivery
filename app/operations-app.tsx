"use client";

import { FormEvent, useEffect, useState } from "react";
import type { DayPlan, DeliveryException, Learner, ProgressStatus, WorkspaceSnapshot } from "@/lib/types";

type Tab = "overview" | "learners" | "exceptions" | "plan" | "cohorts" | "settings";

const phaseMeta = {
  pre_online: { name: "线上前10天", short: "前置蓄能", tone: "coral" },
  offline_camp: { name: "线下5天", short: "集中突破", tone: "violet" },
  post_online: { name: "线上后10天", short: "持续陪跑", tone: "teal" },
} as const;
const statusMeta: Record<ProgressStatus, { label: string; className: string }> = {
  not_started: { label: "未开始", className: "neutral" },
  in_progress: { label: "进行中", className: "blue" },
  needs_revision: { label: "待修改", className: "amber" },
  passed: { label: "已通过", className: "green" },
};

async function api(action?: Record<string, unknown>, cohortId?: number) {
  const response = await fetch(action ? "/api/workspace" : `/api/workspace${cohortId ? `?cohortId=${cohortId}` : ""}`, action ? {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cohortId, ...action }),
  } : { cache: "no-store" });
  const data = await response.json() as WorkspaceSnapshot & { error?: string };
  if (!response.ok) throw new Error(data.error || "操作失败");
  return data as WorkspaceSnapshot;
}

function isoToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
}

export function OperationsApp() {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");

  const refresh = async () => {
    try { setSnapshot(await api(undefined, snapshot?.cohort?.id)); setError(""); } catch (problem) { setError((problem as Error).message); }
  };
  useEffect(() => {
    let active = true;
    api().then((data) => { if (active) setSnapshot(data); }).catch((problem) => { if (active) setError((problem as Error).message); });
    return () => { active = false; };
  }, []);

  async function mutate(payload: Record<string, unknown>, message: string) {
    setBusy(true); setError(""); setNotice("");
    try { setSnapshot(await api(payload, snapshot?.cohort?.id)); setNotice(message); window.setTimeout(() => setNotice(""), 3500); return true; }
    catch (problem) { setError((problem as Error).message); return false; }
    finally { setBusy(false); }
  }

  if (error && !snapshot) return <div className="center-state"><div className="state-mark">!</div><h1>暂时无法进入作战台</h1><p>{error}</p><button onClick={refresh}>重新连接</button></div>;
  if (!snapshot) return <div className="center-state"><div className="spinner"/><p>正在连接交付数据…</p></div>;
  if (!snapshot.cohort && snapshot.user.role === "owner") return <Onboarding snapshot={snapshot} busy={busy} mutate={mutate} error={error}/>;
  if (!snapshot.cohort) return <div className="center-state"><div className="state-mark">○</div><h1>暂未分配营期</h1><p>请联系项目负责人，把你添加到对应营期的小组。</p><button onClick={refresh}>刷新</button></div>;
  const readOnly = snapshot.cohort.status === "archived";

  const nav: Array<[Tab, string, string]> = [
    ["overview", "01", "交付总览"], ["learners", "02", "学员推进"], ["exceptions", "03", "异常协同"], ["plan", "04", "25天计划"],
  ];
  if (snapshot.user.role === "owner") nav.push(["cohorts", "05", "营期管理"], ["settings", "06", "成员与分组"]);

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-seal">跃</span><div><strong>跃迁计划</strong><small>教练交付作战台</small></div></div>
      <nav aria-label="主导航">{nav.map(([key, number, label]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}><span>{number}</span>{label}</button>)}</nav>
      <div className="sidebar-foot"><div className="avatar">{snapshot.user.displayName.slice(0, 1).toUpperCase()}</div><div><strong>{snapshot.user.displayName}</strong><small>{snapshot.user.role === "owner" ? "项目负责人" : "带组教练"}</small></div></div>
    </aside>
    <main>
      <header className="topbar"><button className="mobile-brand" onClick={() => setTab("overview")}>跃迁计划</button><div><span className={`live-dot ${readOnly ? "archived" : ""}`}/>{readOnly ? "历史营期" : "营期协同中"}</div><div className="topbar-right"><label className="cohort-switch"><span>当前营期</span><select value={snapshot.cohort.id} onChange={async (event) => { setBusy(true); try { setSnapshot(await api(undefined, Number(event.target.value))); setTab("overview"); setError(""); } catch (problem) { setError((problem as Error).message); } finally { setBusy(false); } }} disabled={busy}>{snapshot.cohorts.map((cohort) => <option key={cohort.id} value={cohort.id}>{cohort.name}{cohort.status === "archived" ? " · 已归档" : ""}</option>)}</select></label><button onClick={refresh} aria-label="刷新数据">刷新</button></div></header>
      {(notice || error) && <div className={`toast ${error ? "error" : "success"}`}>{error || notice}<button onClick={() => { setError(""); setNotice(""); }}>×</button></div>}
      <div className="page-wrap">
        {readOnly && <div className="read-only-banner"><strong>已归档 · 只读</strong><span>历史学员、进度、证据和异常记录完整保留；项目方可在“营期管理”中重新开启。</span></div>}
        {tab === "overview" && <Overview snapshot={snapshot} setTab={setTab}/>}
        {tab === "learners" && <Learners snapshot={snapshot} busy={busy} mutate={mutate} readOnly={readOnly}/>}
        {tab === "exceptions" && <Exceptions snapshot={snapshot} busy={busy} mutate={mutate} readOnly={readOnly}/>}
        {tab === "plan" && <Plan snapshot={snapshot} busy={busy} mutate={mutate} readOnly={readOnly}/>}
        {tab === "cohorts" && snapshot.user.role === "owner" && <CohortManager snapshot={snapshot} busy={busy} mutate={mutate}/>}
        {tab === "settings" && snapshot.user.role === "owner" && <Settings snapshot={snapshot} busy={busy} mutate={mutate} readOnly={readOnly}/>}
      </div>
    </main>
    <nav className="mobile-nav" aria-label="移动端导航">{nav.slice(0, 4).map(([key,,label]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label.replace("交付", "")}</button>)}</nav>
  </div>;
}

function Onboarding({ snapshot, busy, mutate, error }: { snapshot: WorkspaceSnapshot; busy: boolean; error: string; mutate: (p: Record<string, unknown>, m: string) => Promise<boolean> }) {
  const today = isoToday();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    await mutate({ action: "initialize", name: data.get("name"), preStartDate: data.get("preStartDate"), offlineStartDate: data.get("offlineStartDate"), postStartDate: data.get("postStartDate") }, "营期已创建");
  };
  return <div className="onboarding"><section><div className="eyebrow">YUEQIAN · DELIVERY OS</div><h1>把25天交付<br/>放进一张作战地图</h1><p>这不是学员打卡工具。它帮助项目方和教练看清：今天必须推进什么、谁卡住了、什么结果才算通过。</p><div className="phase-preview"><span>线上 10 天</span><i>→</i><span>线下 5 天</span><i>→</i><span>线上 10 天</span></div></section><form onSubmit={submit} className="onboarding-card"><span className="step-label">首次设置 · 只需要一次</span><h2>创建真实营期</h2><p>系统不会写入示例学员。创建后再导入名单和分配教练。</p>{error && <div className="form-error">{error}</div>}<label>营期名称<input name="name" required placeholder="例如：跃迁计划 · 2026 秋季营"/></label><div className="date-grid"><label>线上前10天开始<input name="preStartDate" type="date" defaultValue={today} required/></label><label>线下5天开始<input name="offlineStartDate" type="date" required/></label><label>线上后10天开始<input name="postStartDate" type="date" required/></label></div><button className="primary" disabled={busy}>{busy ? "正在创建…" : "创建25天作战台"}</button><small>当前负责人：{snapshot.user.displayName} · {snapshot.user.email}</small></form></div>;
}

function Overview({ snapshot, setTab }: { snapshot: WorkspaceSnapshot; setTab: (tab: Tab) => void }) {
  const today = isoToday();
  const current = snapshot.dayPlans.find((day) => day.due_date === today) ?? snapshot.dayPlans.find((day) => day.due_date > today) ?? snapshot.dayPlans.at(-1)!;
  const openExceptions = snapshot.exceptions.filter((item) => item.status !== "resolved").length;
  const overdue = snapshot.progress.filter((item) => item.status !== "passed" && (snapshot.dayPlans.find((day) => day.id === item.day_plan_id)?.due_date ?? "") < today).length;
  const revision = snapshot.progress.filter((item) => item.status === "needs_revision").length;
  const passed = snapshot.progress.filter((item) => item.status === "passed").length;
  const totalPossible = Math.max(snapshot.learners.length * snapshot.dayPlans.filter((day) => day.due_date <= today).length, 1);
  const completion = Math.min(100, Math.round(passed / totalPossible * 100));
  return <>
    <section className="hero-panel"><div><div className="eyebrow">DAY COMMAND · 今日作战面</div><h1>{current.label}<br/><span>{current.title}</span></h1><p>{current.goal || "该日任务待项目方配置"}</p><div className="hero-actions"><button className="primary" onClick={() => setTab("learners")}>推进今日验收</button><button className="ghost" onClick={() => setTab("exceptions")}>处理异常 {openExceptions ? `· ${openExceptions}` : ""}</button></div></div><div className="today-card"><span className={`phase-tag ${phaseMeta[current.phase].tone}`}>{phaseMeta[current.phase].name}</span><dl><div><dt>今日提交物</dt><dd>{current.deliverable || "待配置"}</dd></div><div><dt>通过标准</dt><dd>{current.acceptance || "待配置"}</dd></div><div><dt>截止日期</dt><dd>{current.due_date}</dd></div></dl></div></section>
    <section className="metrics"><article><span>整体通过率</span><strong>{completion}<small>%</small></strong><div className="bar"><i style={{ width: `${completion}%` }}/></div></article><article><span>待修改</span><strong>{revision}</strong><small>需要教练继续推进</small></article><article><span>历史逾期</span><strong>{overdue}</strong><small>尚未验收通过</small></article><article className={openExceptions ? "alert" : ""}><span>未解决异常</span><strong>{openExceptions}</strong><small>等待项目方响应</small></article></section>
    <section className="section-block"><div className="section-head"><div><span className="kicker">25 DAY ROUTE</span><h2>一条路线，三个交付阶段</h2></div><button className="text-button" onClick={() => setTab("plan")}>查看完整计划 →</button></div><div className="route-strip">{Object.entries(phaseMeta).map(([phase, meta]) => { const days = snapshot.dayPlans.filter((day) => day.phase === phase); return <div className={`route-phase ${meta.tone}`} key={phase}><header><div><strong>{meta.name}</strong><span>{meta.short}</span></div><b>{days.filter((day) => day.configured).length}/{days.length}</b></header><div>{days.map((day) => <span title={`${day.label} ${day.title}`} className={`${day.id === current.id ? "today" : ""} ${day.configured ? "configured" : ""}`} key={day.id}>{day.day_number}</span>)}</div></div>; })}</div></section>
    <section className="section-block"><div className="section-head"><div><span className="kicker">GROUP PULSE</span><h2>小组推进脉搏</h2></div><button className="text-button" onClick={() => setTab("learners")}>进入学员推进 →</button></div><div className="group-grid">{snapshot.groups.length ? snapshot.groups.map((group) => { const groupLearners = snapshot.learners.filter((learner) => learner.group_id === group.id); const groupProgress = groupLearners.map((learner) => snapshot.progress.find((item) => item.learner_id === learner.id && item.day_plan_id === current.id)?.status ?? "not_started"); return <article key={group.id}><div className="group-title"><span>{group.name.slice(0, 2)}</span><div><strong>{group.name}</strong><small>{group.coach_email}</small></div></div><div className="status-line"><span><i className="green"/>{groupProgress.filter((s) => s === "passed").length} 已通过</span><span><i className="amber"/>{groupProgress.filter((s) => s === "needs_revision").length} 待修改</span><span><i className="neutral"/>{groupProgress.filter((s) => s === "not_started").length} 未开始</span></div><footer>{group.learner_count} 名学员 <b>{groupProgress.some((status) => status !== "not_started") ? "推进中" : "待启动"}</b></footer></article>; }) : <Empty title="还没有小组" detail="项目方先在“成员与分组”中添加教练。"/>}</div></section>
  </>;
}

function Learners({ snapshot, busy, mutate, readOnly }: { snapshot: WorkspaceSnapshot; busy: boolean; readOnly: boolean; mutate: (p: Record<string, unknown>, m: string) => Promise<boolean> }) {
  const today = isoToday();
  const initial = snapshot.dayPlans.find((day) => day.due_date === today)?.id ?? snapshot.dayPlans[0].id;
  const [dayId, setDayId] = useState(initial);
  const plan = snapshot.dayPlans.find((day) => day.id === dayId)!;
  return <section className="content-page"><PageTitle kicker="LEARNER DELIVERY" title="学员推进" detail="一次只推进一天。状态、证据与验收结论都沉淀在同一行。"/><div className="toolbar"><label>当前任务<select value={dayId} onChange={(event) => setDayId(Number(event.target.value))}>{snapshot.dayPlans.map((day) => <option value={day.id} key={day.id}>{day.label} · {day.title}</option>)}</select></label><div className="legend">{Object.entries(statusMeta).map(([key, meta]) => <span key={key}><i className={meta.className}/>{meta.label}</span>)}</div></div><div className="task-context"><span className={`phase-tag ${phaseMeta[plan.phase].tone}`}>{phaseMeta[plan.phase].name}</span><div><strong>{plan.goal || "任务目标待配置"}</strong><small>提交：{plan.deliverable || "待配置"} · 验收：{plan.acceptance || "待配置"}</small></div><time>{plan.due_date}</time></div><div className="learner-list">{snapshot.learners.length ? snapshot.learners.map((learner) => <ProgressEditor key={`${learner.id}-${dayId}`} learner={learner} dayId={dayId} current={snapshot.progress.find((item) => item.learner_id === learner.id && item.day_plan_id === dayId)} busy={busy} mutate={mutate} readOnly={readOnly}/>) : <Empty title="还没有学员" detail="项目方可从飞书或表格复制名单后批量导入。"/>}</div></section>;
}

function ProgressEditor({ learner, dayId, current, busy, mutate, readOnly }: { learner: Learner; dayId: number; current?: WorkspaceSnapshot["progress"][number]; busy: boolean; readOnly: boolean; mutate: (p: Record<string, unknown>, m: string) => Promise<boolean> }) {
  const [status, setStatus] = useState<ProgressStatus>(current?.status ?? "not_started");
  const [url, setUrl] = useState(current?.evidence_url ?? "");
  const [note, setNote] = useState(current?.evidence_note ?? "");
  return <article className="learner-row"><div className="learner-name"><span>{learner.name.slice(0, 1)}</span><div><strong>{learner.name}</strong><small>{learner.group_name}{learner.note ? ` · ${learner.note}` : ""}</small></div></div><label className="compact-label">状态<select value={status} disabled={readOnly} onChange={(event) => setStatus(event.target.value as ProgressStatus)}>{Object.entries(statusMeta).map(([key, meta]) => <option value={key} key={key}>{meta.label}</option>)}</select></label><label className="compact-label grow">证据链接<input value={url} disabled={readOnly} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" inputMode="url"/></label><label className="compact-label grow">验收记录<input value={note} disabled={readOnly} onChange={(event) => setNote(event.target.value)} placeholder="写清已完成什么或需修改什么"/></label>{!readOnly && <button className="save-button" disabled={busy} onClick={() => mutate({ action: "update_progress", learnerId: learner.id, dayPlanId: dayId, status, evidenceUrl: url, evidenceNote: note }, `${learner.name} 的进度已保存`)}>保存</button>}</article>;
}

function Exceptions({ snapshot, busy, mutate, readOnly }: { snapshot: WorkspaceSnapshot; busy: boolean; readOnly: boolean; mutate: (p: Record<string, unknown>, m: string) => Promise<boolean> }) {
  const [showForm, setShowForm] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); if (await mutate({ action: "create_exception", learnerId: data.get("learnerId"), dayPlanId: data.get("dayPlanId"), problem: data.get("problem"), request: data.get("request") }, "异常已提交给项目方")) { form.reset(); setShowForm(false); } };
  return <section className="content-page"><PageTitle kicker="ESCALATION LOOP" title="异常协同" detail="只处理真正阻塞交付的问题：写清现状、需要什么支持、最后如何解决。" action={!readOnly && <button className="primary" onClick={() => setShowForm(!showForm)}>+ 发起异常</button>}/>{showForm && !readOnly && <form className="exception-form" onSubmit={submit}><label>关联学员<select name="learnerId" required defaultValue=""><option value="" disabled>请选择</option>{snapshot.learners.map((learner) => <option key={learner.id} value={learner.id}>{learner.group_name} · {learner.name}</option>)}</select></label><label>关联任务<select name="dayPlanId" defaultValue=""><option value="">不关联具体任务</option>{snapshot.dayPlans.map((day) => <option key={day.id} value={day.id}>{day.label} · {day.title}</option>)}</select></label><label className="wide">当前问题<textarea name="problem" required placeholder="发生了什么？为什么会阻塞交付？"/></label><label className="wide">需要项目方支持<textarea name="request" required placeholder="需要决策、资源还是跨组协调？"/></label><button className="primary" disabled={busy}>提交异常</button></form>}<div className="exception-list">{snapshot.exceptions.length ? snapshot.exceptions.map((item) => <ExceptionCard key={item.id} item={item} owner={snapshot.user.role === "owner"} busy={busy} mutate={mutate} readOnly={readOnly}/>) : <Empty title="当前没有异常" detail="正常推进无需填报；只有真正阻塞交付的问题才在这里升级。"/>}</div></section>;
}

function ExceptionCard({ item, owner, busy, mutate, readOnly }: { item: DeliveryException; owner: boolean; busy: boolean; readOnly: boolean; mutate: (p: Record<string, unknown>, m: string) => Promise<boolean> }) {
  const [status, setStatus] = useState(item.status); const [resolution, setResolution] = useState(item.resolution);
  const labels = { open: "待处理", handling: "处理中", resolved: "已解决" };
  return <article className={`exception-card ${item.status}`}><header><span className={`exception-status ${item.status}`}>{labels[item.status]}</span><div><strong>{item.learner_name || item.group_name}</strong><small>{item.group_name}{item.day_label ? ` · ${item.day_label}` : ""}</small></div><time>{item.updated_at.slice(0, 16).replace("T", " ")}</time></header><div className="exception-body"><div><span>当前问题</span><p>{item.problem}</p></div><div><span>需要支持</span><p>{item.request}</p></div>{item.resolution && <div><span>处理结果</span><p>{item.resolution}</p></div>}</div>{owner && !readOnly && <div className="exception-handle"><select value={status} onChange={(event) => setStatus(event.target.value as DeliveryException["status"])}><option value="open">待处理</option><option value="handling">处理中</option><option value="resolved">已解决</option></select><input value={resolution} onChange={(event) => setResolution(event.target.value)} placeholder="记录处理动作或最终结果"/><button disabled={busy} onClick={() => mutate({ action: "update_exception", id: item.id, status, resolution }, "异常处理记录已更新")}>更新</button></div>}<details><summary>处理轨迹 · {item.events.length} 条</summary>{item.events.map((event) => <p key={event.id}><b>{event.action}</b> {event.detail}<time>{event.created_at}</time></p>)}</details></article>;
}

function Plan({ snapshot, busy, mutate, readOnly }: { snapshot: WorkspaceSnapshot; busy: boolean; readOnly: boolean; mutate: (p: Record<string, unknown>, m: string) => Promise<boolean> }) {
  return <section className="content-page"><PageTitle kicker="25 DAY BLUEPRINT" title="25天计划" detail="每一天只保留四件事：唯一目标、提交物、验收标准、截止日期。"/><div className="plan-board">{Object.entries(phaseMeta).map(([phase, meta]) => <section key={phase} className={`plan-phase ${meta.tone}`}><header><div><span>{meta.name}</span><h2>{meta.short}</h2></div><b>{snapshot.dayPlans.filter((day) => day.phase === phase && day.configured).length}/{snapshot.dayPlans.filter((day) => day.phase === phase).length} 已配置</b></header><div>{snapshot.dayPlans.filter((day) => day.phase === phase).map((day) => <DayCard key={day.id} day={day} owner={snapshot.user.role === "owner" && !readOnly} busy={busy} mutate={mutate}/>)}</div></section>)}</div></section>;
}

function DayCard({ day, owner, busy, mutate }: { day: DayPlan; owner: boolean; busy: boolean; mutate: (p: Record<string, unknown>, m: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const data = new FormData(event.currentTarget); if (await mutate({ action: "update_day", id: day.id, title: data.get("title"), goal: data.get("goal"), deliverable: data.get("deliverable"), acceptance: data.get("acceptance"), dueDate: data.get("dueDate") }, `${day.label} 已更新`)) setEditing(false); };
  if (editing) return <form className="day-card editing" onSubmit={submit}><div className="day-card-top"><b>{day.label}</b><button type="button" onClick={() => setEditing(false)}>取消</button></div><label>任务名称<input name="title" defaultValue={day.title} required/></label><label>今日唯一目标<textarea name="goal" defaultValue={day.goal}/></label><label>提交物<input name="deliverable" defaultValue={day.deliverable}/></label><label>验收标准<textarea name="acceptance" defaultValue={day.acceptance}/></label><label>截止日期<input name="dueDate" type="date" defaultValue={day.due_date} required/></label><button className="primary" disabled={busy}>保存这一天</button></form>;
  return <article className={`day-card ${day.configured ? "" : "unconfigured"}`}><div className="day-card-top"><b>{day.label}</b><time>{day.due_date.slice(5)}</time></div><h3>{day.title}</h3><p>{day.goal || "由项目方补充当天唯一目标"}</p><dl><div><dt>提交</dt><dd>{day.deliverable || "待配置"}</dd></div><div><dt>验收</dt><dd>{day.acceptance || "待配置"}</dd></div></dl>{owner && <button className="edit-button" onClick={() => setEditing(true)}>{day.configured ? "编辑任务" : "配置这一天"}</button>}</article>;
}

function CohortManager({ snapshot, busy, mutate }: { snapshot: WorkspaceSnapshot; busy: boolean; mutate: (p: Record<string, unknown>, m: string) => Promise<boolean> }) {
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    if (await mutate({ action: "initialize", name: data.get("name"), preStartDate: data.get("preStartDate"), offlineStartDate: data.get("offlineStartDate"), postStartDate: data.get("postStartDate") }, "新营期已创建并切换")) form.reset();
  };
  const changeStatus = async (cohort: WorkspaceSnapshot["cohorts"][number]) => {
    const archive = cohort.status === "active";
    if (archive && !window.confirm(`确认归档“${cohort.name}”？归档后所有历史数据保留，但只能查看。`)) return;
    await mutate({ action: archive ? "archive_cohort" : "reopen_cohort", cohortId: cohort.id }, archive ? "营期已归档，只读保存" : "营期已重新开启");
  };
  return <section className="content-page"><PageTitle kicker="COHORT CONTROL" title="营期管理" detail="每个营期独立保存小组、学员、25天任务、进度和异常。归档后只读保留，项目方可重新开启。"/><div className="cohort-layout"><form className="settings-card cohort-create" onSubmit={submit}><span className="card-number">NEW COHORT</span><h2>创建新营期</h2><label>营期名称<input name="name" required placeholder="例如：跃迁计划 · 2026 冬季营"/></label><div className="date-grid"><label>线上前10天开始<input name="preStartDate" type="date" required/></label><label>线下5天开始<input name="offlineStartDate" type="date" required/></label><label>线上后10天开始<input name="postStartDate" type="date" required/></label></div><button className="primary" disabled={busy}>{busy ? "正在创建…" : "创建并进入新营期"}</button></form><div className="cohort-list"><div className="section-head"><div><span className="kicker">COHORT ARCHIVE</span><h2>全部营期</h2></div><b>{snapshot.cohorts.length} 期</b></div>{snapshot.cohorts.map((cohort) => <article key={cohort.id} className={`${cohort.id === snapshot.cohort?.id ? "active" : ""} ${cohort.status}`}><div><strong>{cohort.name}</strong><small>{cohort.pre_start_date} → {cohort.post_start_date}</small>{cohort.archived_at && <small>归档于 {cohort.archived_at.slice(0, 16).replace("T", " ")} · {cohort.archived_by}</small>}</div><div className="cohort-actions"><span>{cohort.status === "archived" ? "已归档" : cohort.id === snapshot.cohort?.id ? "当前营期" : "进行中"}</span><button type="button" disabled={busy} onClick={() => changeStatus(cohort)}>{cohort.status === "archived" ? "重新开启" : "归档营期"}</button></div></article>)}</div></div></section>;
}

function Settings({ snapshot, busy, mutate, readOnly }: { snapshot: WorkspaceSnapshot; busy: boolean; readOnly: boolean; mutate: (p: Record<string, unknown>, m: string) => Promise<boolean> }) {
  const add = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); if (await mutate({ action: "add_coach_group", displayName: data.get("displayName"), email: data.get("email"), groupName: data.get("groupName") }, "教练与小组已添加")) form.reset(); };
  const importRows = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); if (await mutate({ action: "import_learners", groupId: data.get("groupId"), text: data.get("text") }, "学员名单已导入并匹配教练")) form.reset(); };
  const coachName = (email: string) => snapshot.members.find((member) => member.email === email)?.display_name ?? email;
  return <section className="content-page"><PageTitle kicker="TEAM SETUP" title="成员与分组" detail="先建立教练与小组，再选择小组导入学员；系统会自动匹配该组教练。"/><div className="settings-grid"><form className="settings-card" onSubmit={add}><fieldset disabled={readOnly}><span className="card-number">01</span><h2>添加教练和小组</h2><label>教练姓名<input name="displayName" required placeholder="例如：小雨教练"/></label><label>登录邮箱<input name="email" type="email" required placeholder="coach@example.com"/></label><label>小组名称<input name="groupName" required placeholder="例如：破浪一组"/></label><button className="primary" disabled={busy}>添加</button></fieldset></form><form className="settings-card" onSubmit={importRows}><fieldset disabled={readOnly}><span className="card-number">02</span><h2>批量导入学员</h2><p>先从下拉框选择小组，系统自动匹配教练。文本框每行一名学员，可写“姓名，备注”。</p><label>选择小组与教练<select name="groupId" required defaultValue=""><option value="" disabled>请选择小组</option>{snapshot.groups.map((group) => <option key={group.id} value={group.id}>{group.name} · {coachName(group.coach_email)}</option>)}</select></label><textarea name="text" required rows={7} placeholder={"苏娜\n陈晨，成长型\n林晓，放大型"}/><button className="primary" disabled={busy || !snapshot.groups.length}>导入并匹配</button></fieldset></form></div><section className="member-table"><div className="section-head"><div><span className="kicker">ACTIVE TEAM</span><h2>当前协作成员</h2></div></div>{snapshot.members.map((member) => <div key={member.email}><span className="avatar mini">{member.display_name.slice(0, 1)}</span><strong>{member.display_name}</strong><small>{member.email}</small><b>{member.role === "owner" ? "项目方" : "教练"}</b></div>)}</section></section>;
}

function PageTitle({ kicker, title, detail, action }: { kicker: string; title: string; detail: string; action?: React.ReactNode }) { return <div className="page-title"><div><span className="kicker">{kicker}</span><h1>{title}</h1><p>{detail}</p></div>{action}</div>; }
function Empty({ title, detail }: { title: string; detail: string }) { return <div className="empty"><span>○</span><strong>{title}</strong><p>{detail}</p></div>; }
