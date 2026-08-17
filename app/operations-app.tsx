"use client";

import { FormEvent, useEffect, useState } from "react";
import { defaultDayId } from "@/lib/day-view.mjs";
import { isThemePreference, resolveTheme, THEME_STORAGE_KEY } from "@/lib/theme.mjs";
import type { DayPlan, DeliveryException, Group, Learner, PlanSource, ProgressStatus, WorkspaceSnapshot } from "@/lib/types";
import packageJson from "@/package.json";

type Tab = "overview" | "learners" | "exceptions" | "plan" | "cohorts" | "settings";
type ThemePreference = "system" | "light" | "dark";
type Mutate = (payload: Record<string, unknown>, message: string) => Promise<boolean>;

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
  const [selectedDayId, setSelectedDayId] = useState<number | null>(null);
  const [themePreference, setThemePreference] = useState<ThemePreference>("system");
  const [themeReady, setThemeReady] = useState(false);

  const refresh = async () => {
    try { setSnapshot(await api(undefined, snapshot?.cohort?.id)); setError(""); } catch (problem) { setError((problem as Error).message); }
  };
  useEffect(() => {
    let active = true;
    api().then((data) => { if (active) setSnapshot(data); }).catch((problem) => { if (active) setError((problem as Error).message); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
      setThemePreference(isThemePreference(stored) ? stored : "system");
      setThemeReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!themeReady) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const resolved = resolveTheme(themePreference, media.matches);
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
    };
    applyTheme();
    if (themePreference === "system") media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [themePreference, themeReady]);

  const changeTheme = (preference: ThemePreference) => {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
    setThemePreference(preference);
  };

  async function mutate(payload: Record<string, unknown>, message: string) {
    setBusy(true); setError(""); setNotice("");
    try { setSnapshot(await api(payload, snapshot?.cohort?.id)); setNotice(message); window.setTimeout(() => setNotice(""), 3500); return true; }
    catch (problem) { setError((problem as Error).message); return false; }
    finally { setBusy(false); }
  }

  async function switchCohort(cohortId: number, nextTab: Tab = "overview") {
    setBusy(true); setError("");
    try { setSnapshot(await api(undefined, cohortId)); setSelectedDayId(null); setTab(nextTab); }
    catch (problem) { setError((problem as Error).message); }
    finally { setBusy(false); }
  }

  if (error && !snapshot) return <div className="center-state"><div className="state-mark">!</div><h1>暂时无法进入作战台</h1><p>{error}</p><button onClick={refresh}>重新连接</button></div>;
  if (!snapshot) return <div className="center-state"><div className="spinner"/><p>正在连接交付数据…</p></div>;
  if (!snapshot.cohort && snapshot.user.role === "owner") return <Onboarding snapshot={snapshot} busy={busy} mutate={mutate} error={error}/>;
  if (!snapshot.cohort) return <div className="center-state"><div className="state-mark">○</div><h1>暂未分配营期</h1><p>请联系项目负责人，把你添加到对应营期的小组。</p><button onClick={refresh}>刷新</button></div>;
  const readOnly = snapshot.cohort.status === "archived";
  const nav: Array<[Tab, string, string]> = [["overview", "01", "交付总览"], ["learners", "02", "学员推进"], ["exceptions", "03", "异常协同"], ["plan", "04", "教练任务"]];
  if (snapshot.user.role === "owner") nav.push(["cohorts", "05", "营期管理"], ["settings", "06", "成员与分组"]);

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-seal">跃</span><div><strong>跃迁计划</strong><small>教练交付作战台 <span className="version-tag">v{packageJson.version}</span></small></div></div>
      <nav aria-label="主导航">{nav.map(([key, number, label]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}><span>{number}</span>{label}</button>)}</nav>
      <section className="sidebar-controls" aria-label="工作台设置"><div className="sidebar-live"><span className={`live-dot ${readOnly ? "archived" : ""}`}/>{readOnly ? "历史营期" : "营期协同中"}</div><label>当前营期<select aria-label="侧栏当前营期" value={snapshot.cohort.id} onChange={(event) => switchCohort(Number(event.target.value))} disabled={busy}>{snapshot.cohorts.map((cohort) => <option key={cohort.id} value={cohort.id}>{cohort.name}{cohort.status === "archived" ? " · 已归档" : ""}</option>)}</select></label><label>界面主题<select aria-label="侧栏界面主题" value={themePreference} onChange={(event) => changeTheme(event.target.value as ThemePreference)}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label><button onClick={refresh} aria-label="刷新工作台数据">刷新数据</button></section>
      <div className="sidebar-foot"><div className="avatar">{snapshot.user.displayName.slice(0, 1).toUpperCase()}</div><div><strong>{snapshot.user.displayName}</strong><small>{snapshot.user.role === "owner" ? "项目负责人" : "带组教练"}</small></div></div>
    </aside>
    <main>
      <header className="topbar"><button className="mobile-brand" onClick={() => setTab("overview")}>跃迁计划</button><div><span className={`live-dot ${readOnly ? "archived" : ""}`}/>{readOnly ? "历史营期" : "营期协同中"}</div><div className="topbar-right"><label className="theme-switch"><span>界面</span><select aria-label="界面主题" value={themePreference} onChange={(event) => changeTheme(event.target.value as ThemePreference)}><option value="system">系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label><label className="cohort-switch"><span>当前营期</span><select value={snapshot.cohort.id} onChange={(event) => switchCohort(Number(event.target.value))} disabled={busy}>{snapshot.cohorts.map((cohort) => <option key={cohort.id} value={cohort.id}>{cohort.name}{cohort.status === "archived" ? " · 已归档" : ""}</option>)}</select></label><button onClick={refresh} aria-label="刷新数据">刷新</button></div></header>
      {(notice || error) && <div className={`toast ${error ? "error" : "success"}`}>{error || notice}<button onClick={() => { setError(""); setNotice(""); }}>×</button></div>}
      <div className="page-wrap">
        {readOnly && <div className="read-only-banner"><strong>已归档 · 只读</strong><span>这里展示当期实际发布的任务、学员作业、证据与异常记录。</span></div>}
        {tab === "overview" && <Overview snapshot={snapshot} setTab={setTab} selectedDayId={selectedDayId} setSelectedDayId={setSelectedDayId}/>} 
        {tab === "learners" && <Learners key={`${snapshot.cohort.id}-${readOnly}`} snapshot={snapshot} busy={busy} mutate={mutate} readOnly={readOnly} selectedDayId={selectedDayId}/>} 
        {tab === "exceptions" && <Exceptions snapshot={snapshot} busy={busy} mutate={mutate} readOnly={readOnly}/>} 
        {tab === "plan" && <Plan snapshot={snapshot} busy={busy} mutate={mutate} readOnly={readOnly} selectedDayId={selectedDayId}/>} 
        {tab === "cohorts" && snapshot.user.role === "owner" && <CohortManager snapshot={snapshot} busy={busy} mutate={mutate} switchCohort={switchCohort}/>} 
        {tab === "settings" && snapshot.user.role === "owner" && <Settings snapshot={snapshot} busy={busy} mutate={mutate} readOnly={readOnly}/>} 
      </div>
    </main>
    <nav className="mobile-nav" aria-label="移动端导航">{nav.slice(0, 4).map(([key,,label]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label.replace("交付", "")}</button>)}</nav>
  </div>;
}

function Onboarding({ snapshot, busy, mutate, error }: { snapshot: WorkspaceSnapshot; busy: boolean; error: string; mutate: Mutate }) {
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const data = new FormData(event.currentTarget); await mutate({ action: "initialize", planSource: "standard", name: data.get("name"), preStartDate: data.get("preStartDate"), offlineStartDate: data.get("offlineStartDate"), postStartDate: data.get("postStartDate") }, "营期已创建"); };
  return <div className="onboarding"><section><div className="eyebrow">YUEQIAN · DELIVERY OS</div><h1>把25天交付<br/>放进一张作战地图</h1><p>项目方发布教练执行任务，教练推进学员结果，营期结束后完整归档。</p><div className="phase-preview"><span>线上 10 天</span><i>→</i><span>线下 5 天</span><i>→</i><span>线上 10 天</span></div></section><form onSubmit={submit} className="onboarding-card"><span className="step-label">首次设置 · 只需要一次</span><h2>创建真实营期</h2><p>首期从标准25天模板开始，创建后再发布教练任务、导入学员。</p>{error && <div className="form-error">{error}</div>}<label>营期名称<input name="name" required placeholder="例如：跃迁计划 · 2026 秋季营"/></label><div className="date-grid"><label>线上前10天开始<input name="preStartDate" type="date" defaultValue={isoToday()} required/></label><label>线下5天开始<input name="offlineStartDate" type="date" required/></label><label>线上后10天开始<input name="postStartDate" type="date" required/></label></div><button className="primary" disabled={busy}>{busy ? "正在创建…" : "创建25天作战台"}</button><small>当前负责人：{snapshot.user.displayName} · {snapshot.user.email}</small></form></div>;
}

function Overview({ snapshot, setTab, selectedDayId, setSelectedDayId }: { snapshot: WorkspaceSnapshot; setTab: (tab: Tab) => void; selectedDayId: number | null; setSelectedDayId: (id: number | null) => void }) {
  const automaticDayId = defaultDayId(snapshot.dayPlans, isoToday());
  const current = snapshot.dayPlans.find((day) => day.id === selectedDayId) ?? snapshot.dayPlans.find((day) => day.id === automaticDayId)!;
  const dayProgress = snapshot.progress.filter((item) => item.day_plan_id === current.id);
  const openExceptions = snapshot.exceptions.filter((item) => item.status !== "resolved" && item.day_plan_id === current.id).length;
  const revision = dayProgress.filter((item) => item.status === "needs_revision").length;
  const passed = dayProgress.filter((item) => item.status === "passed").length;
  const unfinished = Math.max(snapshot.learners.length - passed - revision, 0);
  const completion = snapshot.learners.length ? Math.round(passed / snapshot.learners.length * 100) : 0;
  const previewing = current.id !== automaticDayId;
  const selectDay = (id: number) => setSelectedDayId(id);
  return <>
    <section className="hero-panel"><div><div className="command-kicker"><div className="eyebrow">DAY COMMAND · {previewing ? "任务预览" : "今日作战面"}</div>{previewing && <button onClick={() => setSelectedDayId(null)}>回到今天</button>}</div><div className={`dispatch-pill ${current.dispatch_status}`}>{current.dispatch_status === "published" ? "已发布给全部教练" : "项目方草稿"}</div><h1>{current.label}<br/><span>{current.title}</span></h1><p>{current.coach_action || current.goal || "该日教练任务待项目方配置"}</p><div className="hero-actions"><button className="primary" onClick={() => setTab("plan")}>查看执行卡</button><button className="ghost" onClick={() => setTab("learners")}>推进学员验收</button></div></div><div className="today-card"><span className={`phase-tag ${phaseMeta[current.phase].tone}`}>{phaseMeta[current.phase].name}</span><dl><div><dt>学员提交物</dt><dd>{current.deliverable || "待配置"}</dd></div><div><dt>通过标准</dt><dd>{current.acceptance || "待配置"}</dd></div><div><dt>截止日期</dt><dd>{current.due_date}</dd></div></dl></div></section>
    <section className="metrics"><article><span>当日通过率</span><strong>{completion}<small>%</small></strong><div className="bar"><i style={{ width: `${completion}%` }}/></div></article><article><span>已通过</span><strong>{passed}</strong><small>{snapshot.learners.length} 名学员</small></article><article><span>待修改</span><strong>{revision}</strong><small>需要教练继续推进</small></article><article className={openExceptions ? "alert" : ""}><span>未完成 / 关联异常</span><strong>{unfinished}<small> / {openExceptions}</small></strong><small>进行中或尚未开始</small></article></section>
    <RouteIndex days={snapshot.dayPlans} currentId={current.id} selectDay={selectDay} action={<button className="text-button" onClick={() => setTab("plan")}>打开教练任务 →</button>}/>
    <section className="section-block"><div className="section-head"><div><span className="kicker">GROUP PULSE</span><h2>小组推进脉搏</h2></div><button className="text-button" onClick={() => setTab("learners")}>进入学员推进 →</button></div><div className="group-grid">{snapshot.groups.length ? snapshot.groups.map((group) => { const groupLearners = snapshot.learners.filter((learner) => learner.group_id === group.id); const groupProgress = groupLearners.map((learner) => snapshot.progress.find((item) => item.learner_id === learner.id && item.day_plan_id === current.id)?.status ?? "not_started"); return <article key={group.id}><div className="group-title"><span>{group.name.slice(0, 2)}</span><div><strong>{group.name}</strong><small>{group.coach_name} · {group.coach_email}</small></div></div><div className="status-line"><span><i className="green"/>{groupProgress.filter((s) => s === "passed").length} 已通过</span><span><i className="amber"/>{groupProgress.filter((s) => s === "needs_revision").length} 待修改</span><span><i className="neutral"/>{groupProgress.filter((s) => s === "not_started").length} 未开始</span></div><footer>{group.learner_count} 名学员 <b>{groupProgress.some((status) => status !== "not_started") ? "推进中" : "待启动"}</b></footer></article>; }) : <Empty title="还没有小组" detail="项目方先在“成员与分组”中添加教练。"/>}</div></section>
  </>;
}

function RouteIndex({ days, currentId, selectDay, action }: { days: DayPlan[]; currentId: number; selectDay: (id: number) => void; action?: React.ReactNode }) {
  return <section className="section-block route-section"><div className="section-head"><div><span className="kicker">25 DAY ROUTE</span><h2>点击日期，打开对应执行卡</h2></div>{action}</div><div className="route-strip">{Object.entries(phaseMeta).map(([phase, meta]) => { const phaseDays = days.filter((day) => day.phase === phase); return <div className={`route-phase ${meta.tone}`} key={phase}><header><div><strong>{meta.name}</strong><span>{meta.short}</span></div><b>{phaseDays.filter((day) => day.dispatch_status === "published").length}/{phaseDays.length} 已发布</b></header><div>{phaseDays.map((day) => <button type="button" aria-label={`打开 ${day.label} ${day.title}`} aria-pressed={day.id === currentId} title={`${day.label} · ${day.title} · ${day.due_date}`} onClick={() => selectDay(day.id)} className={`${day.id === currentId ? "selected" : ""} ${day.dispatch_status}`} key={day.id}>{day.day_number}</button>)}</div></div>; })}</div></section>;
}

function Plan({ snapshot, busy, mutate, readOnly, selectedDayId }: { snapshot: WorkspaceSnapshot; busy: boolean; mutate: Mutate; readOnly: boolean; selectedDayId: number | null }) {
  const initial = snapshot.dayPlans.some((day) => day.id === selectedDayId) ? selectedDayId! : defaultDayId(snapshot.dayPlans, isoToday())!;
  const [dayId, setDayId] = useState(initial);
  const [editing, setEditing] = useState(false);
  const day = snapshot.dayPlans.find((item) => item.id === dayId)!;
  return <section className="content-page"><PageTitle kicker="COACH DISPATCH" title="教练任务" detail="25天路线只做索引；每一天是一张项目方发布、教练可以直接执行的任务卡。"/><RouteIndex days={snapshot.dayPlans} currentId={dayId} selectDay={(id) => { setDayId(id); setEditing(false); }}/>{editing ? <DayEditor day={day} busy={busy} mutate={mutate} close={() => setEditing(false)}/> : <DispatchDetail day={day} owner={snapshot.user.role === "owner"} readOnly={readOnly} busy={busy} mutate={mutate} edit={() => setEditing(true)}/>}</section>;
}

function DispatchDetail({ day, owner, readOnly, busy, mutate, edit }: { day: DayPlan; owner: boolean; readOnly: boolean; busy: boolean; mutate: Mutate; edit: () => void }) {
  const [copied, setCopied] = useState(false);
  const copyAnnouncement = async () => { if (!day.group_announcement) return; await navigator.clipboard.writeText(day.group_announcement); setCopied(true); window.setTimeout(() => setCopied(false), 1800); };
  return <article className="dispatch-detail">
    <header><div><div className="dispatch-meta"><span className={`dispatch-pill ${day.dispatch_status}`}>{day.dispatch_status === "published" ? "已发布" : "草稿"}</span><span>{day.label}</span><time>更新于 {day.updated_at?.slice(0, 16).replace("T", " ")}</time></div><h2>{day.title}</h2><p>{day.coach_action || "教练执行动作待配置"}</p></div><div className="dispatch-head-actions">{owner && !readOnly && <button className="ghost" onClick={edit}>编辑草稿</button>}{owner && !readOnly && <button className="primary" disabled={busy} onClick={() => mutate({ action: "publish_day", id: day.id }, `${day.label} 已发布给全部教练`)}>{day.dispatch_status === "published" ? "重新发布" : "发布给全部教练"}</button>}</div></header>
    <div className="dispatch-facts"><div><span>执行日期</span><strong>{day.due_date}</strong></div><div><span>派发范围</span><strong>当前营期全部教练</strong></div><div><span>学员提交</span><strong>{day.deliverable || "待配置"}</strong></div><div><span>验收标准</span><strong>{day.acceptance || "待配置"}</strong></div></div>
    {day.reminder && <div className="dispatch-reminder"><b>现场提醒</b><p>{day.reminder}</p></div>}
    <div className="dispatch-content"><section><div className="content-title"><div><span>GROUP ANNOUNCEMENT</span><h3>群公告文案</h3></div><button disabled={!day.group_announcement} onClick={copyAnnouncement}>{copied ? "已复制" : "复制群公告"}</button></div><p className="copy-block">{day.group_announcement || "尚未配置群公告"}</p></section><aside><span>MATERIALS</span><h3>发给学员的资料</h3><RichText text={day.materials || "尚未配置资料链接"}/></aside></div>
    <div className="learner-brief"><section><span>LEARNER ACTION</span><h3>学员怎么操作</h3><p>{day.learner_instructions || "待配置"}</p></section><section><span>TODAY GOAL</span><h3>学员今日目标</h3><p>{day.goal || "待配置"}</p></section></div>
    {day.dispatch_status === "draft" && !owner && <div className="unpublished-note">这一天尚未由项目方发布。</div>}
  </article>;
}

function DayEditor({ day, busy, mutate, close }: { day: DayPlan; busy: boolean; mutate: Mutate; close: () => void }) {
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const data = new FormData(event.currentTarget); if (await mutate({ action: "save_day_draft", id: day.id, title: data.get("title"), coachAction: data.get("coachAction"), groupAnnouncement: data.get("groupAnnouncement"), materials: data.get("materials"), learnerInstructions: data.get("learnerInstructions"), reminder: data.get("reminder"), goal: data.get("goal"), deliverable: data.get("deliverable"), acceptance: data.get("acceptance"), dueDate: data.get("dueDate") }, `${day.label} 草稿已保存`)) close(); };
  return <form className="dispatch-editor" onSubmit={submit}><header><div><span className="kicker">{day.label} · DRAFT</span><h2>编辑教练执行卡</h2><p>保存草稿不会改变教练正在看到的已发布版本。</p></div><button type="button" className="ghost" onClick={close}>取消</button></header><div className="editor-grid"><section><h3>项目方给教练</h3><label>任务名称<input name="title" defaultValue={day.title} required/></label><label>教练今日要完成什么<textarea name="coachAction" defaultValue={day.coach_action} required/></label><label>群公告文案<textarea name="groupAnnouncement" defaultValue={day.group_announcement} rows={8}/></label><label>资料名称与 HTTPS 链接<textarea name="materials" defaultValue={day.materials} rows={5} placeholder={"信息卡模板 https://…\n填写示例 https://…"}/></label><label>现场提醒<textarea name="reminder" defaultValue={day.reminder}/></label></section><section><h3>教练发给学员</h3><label>学员填写／操作说明<textarea name="learnerInstructions" defaultValue={day.learner_instructions} required rows={6}/></label><label>学员今日目标<textarea name="goal" defaultValue={day.goal} required/></label><label>提交物<input name="deliverable" defaultValue={day.deliverable} required/></label><label>验收标准<textarea name="acceptance" defaultValue={day.acceptance} required/></label><label>截止日期<input name="dueDate" type="date" defaultValue={day.due_date} required/></label></section></div><footer><span>保存后仍是草稿，需要回到执行卡点击“发布给全部教练”。</span><button className="primary" disabled={busy}>{busy ? "正在保存…" : "保存草稿"}</button></footer></form>;
}

function RichText({ text }: { text: string }) {
  const parts = text.split(/(https:\/\/\S+)/g);
  return <p className="rich-text">{parts.map((part, index) => part.startsWith("https://") ? <a key={index} href={part.replace(/[，。；、)）\]]+$/, "")} target="_blank" rel="noreferrer">{part}</a> : <span key={index}>{part}</span>)}</p>;
}

function Learners({ snapshot, busy, mutate, readOnly, selectedDayId }: { snapshot: WorkspaceSnapshot; busy: boolean; mutate: Mutate; readOnly: boolean; selectedDayId: number | null }) {
  const [mode, setMode] = useState<"day" | "archive">(readOnly ? "archive" : "day");
  const initial = snapshot.dayPlans.some((day) => day.id === selectedDayId) ? selectedDayId! : defaultDayId(snapshot.dayPlans, isoToday())!;
  const [dayId, setDayId] = useState(initial);
  const plan = snapshot.dayPlans.find((day) => day.id === dayId)!;
  return <section className="content-page"><PageTitle kicker="LEARNER DELIVERY" title={readOnly ? "学员历史档案" : "学员推进"} detail={readOnly ? "按学员查看25天完整进度、作业证据和验收记录。" : "按天推进验收，也可以切换到学员全周期档案。"}/><div className="view-switch"><button className={mode === "day" ? "active" : ""} onClick={() => setMode("day")}>按天推进</button><button className={mode === "archive" ? "active" : ""} onClick={() => setMode("archive")}>学员全周期档案</button></div>{mode === "archive" ? <LearnerArchive snapshot={snapshot}/> : <><div className="toolbar"><label>当前任务<select value={dayId} onChange={(event) => setDayId(Number(event.target.value))}>{snapshot.dayPlans.map((day) => <option value={day.id} key={day.id}>{day.label} · {day.title}</option>)}</select></label><div className="legend">{Object.entries(statusMeta).map(([key, meta]) => <span key={key}><i className={meta.className}/>{meta.label}</span>)}</div></div><div className="task-context"><span className={`phase-tag ${phaseMeta[plan.phase].tone}`}>{phaseMeta[plan.phase].name}</span><div><strong>{plan.goal || "任务目标待配置"}</strong><small>提交：{plan.deliverable || "待配置"} · 验收：{plan.acceptance || "待配置"}</small></div><time>{plan.due_date}</time></div><div className="learner-list">{snapshot.learners.length ? snapshot.learners.map((learner) => <ProgressEditor key={`${learner.id}-${dayId}`} learner={learner} dayId={dayId} current={snapshot.progress.find((item) => item.learner_id === learner.id && item.day_plan_id === dayId)} busy={busy} mutate={mutate} readOnly={readOnly}/>) : <Empty title="还没有学员" detail="项目方可从飞书或表格复制名单后批量导入。"/>}</div></>}</section>;
}

function LearnerArchive({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  return <div className="archive-list">{snapshot.learners.length ? snapshot.learners.map((learner) => { const records = snapshot.progress.filter((item) => item.learner_id === learner.id); const passed = records.filter((item) => item.status === "passed").length; return <details key={learner.id} className="archive-learner"><summary><div className="learner-name"><span>{learner.name.slice(0, 1)}</span><div><strong>{learner.name}</strong><small>{learner.group_name}{learner.note ? ` · ${learner.note}` : ""}</small></div></div><div><strong>{passed}/25 已通过</strong><small>{records.length} 天有记录</small></div></summary><div className="archive-days">{snapshot.dayPlans.map((day) => { const current = records.find((item) => item.day_plan_id === day.id); const status = current?.status ?? "not_started"; return <article key={day.id}><div><b>{day.label}</b><span className={`status-chip ${statusMeta[status].className}`}>{statusMeta[status].label}</span></div><strong>{day.title}</strong><p>{current?.evidence_note || "暂无验收记录"}</p>{current?.evidence_url && <a href={current.evidence_url} target="_blank" rel="noreferrer">查看作业证据 ↗</a>}</article>; })}</div></details>; }) : <Empty title="还没有学员档案" detail="导入学员并推进任务后，完整记录会沉淀在这里。"/>}</div>;
}

function ProgressEditor({ learner, dayId, current, busy, mutate, readOnly }: { learner: Learner; dayId: number; current?: WorkspaceSnapshot["progress"][number]; busy: boolean; readOnly: boolean; mutate: Mutate }) {
  const [status, setStatus] = useState<ProgressStatus>(current?.status ?? "not_started"); const [url, setUrl] = useState(current?.evidence_url ?? ""); const [note, setNote] = useState(current?.evidence_note ?? "");
  return <article className="learner-row"><div className="learner-name"><span>{learner.name.slice(0, 1)}</span><div><strong>{learner.name}</strong><small>{learner.group_name}{learner.note ? ` · ${learner.note}` : ""}</small></div></div><label className="compact-label">状态<select value={status} disabled={readOnly} onChange={(event) => setStatus(event.target.value as ProgressStatus)}>{Object.entries(statusMeta).map(([key, meta]) => <option value={key} key={key}>{meta.label}</option>)}</select></label><label className="compact-label grow">证据链接<input value={url} disabled={readOnly} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" inputMode="url"/></label><label className="compact-label grow">验收记录<input value={note} disabled={readOnly} onChange={(event) => setNote(event.target.value)} placeholder="写清已完成什么或需修改什么"/></label>{!readOnly && <button className="save-button" disabled={busy} onClick={() => mutate({ action: "update_progress", learnerId: learner.id, dayPlanId: dayId, status, evidenceUrl: url, evidenceNote: note }, `${learner.name} 的进度已保存`)}>保存</button>}</article>;
}

function Exceptions({ snapshot, busy, mutate, readOnly }: { snapshot: WorkspaceSnapshot; busy: boolean; mutate: Mutate; readOnly: boolean }) {
  const [showForm, setShowForm] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); if (await mutate({ action: "create_exception", learnerId: data.get("learnerId"), dayPlanId: data.get("dayPlanId"), problem: data.get("problem"), request: data.get("request") }, "异常已提交给项目方")) { form.reset(); setShowForm(false); } };
  return <section className="content-page"><PageTitle kicker="ESCALATION LOOP" title="异常协同" detail="只处理真正阻塞交付的问题：写清现状、需要什么支持、最后如何解决。" action={!readOnly && <button className="primary" onClick={() => setShowForm(!showForm)}>+ 发起异常</button>}/>{showForm && !readOnly && <form className="exception-form" onSubmit={submit}><label>关联学员<select name="learnerId" required defaultValue=""><option value="" disabled>请选择</option>{snapshot.learners.map((learner) => <option key={learner.id} value={learner.id}>{learner.group_name} · {learner.name}</option>)}</select></label><label>关联任务<select name="dayPlanId" defaultValue=""><option value="">不关联具体任务</option>{snapshot.dayPlans.filter((day) => day.dispatch_status === "published").map((day) => <option key={day.id} value={day.id}>{day.label} · {day.title}</option>)}</select></label><label className="wide">当前问题<textarea name="problem" required/></label><label className="wide">需要项目方支持<textarea name="request" required/></label><button className="primary" disabled={busy}>提交异常</button></form>}<div className="exception-list">{snapshot.exceptions.length ? snapshot.exceptions.map((item) => <ExceptionCard key={item.id} item={item} owner={snapshot.user.role === "owner"} busy={busy} mutate={mutate} readOnly={readOnly}/>) : <Empty title="当前没有异常" detail="只有真正阻塞交付的问题才在这里升级。"/>}</div></section>;
}

function ExceptionCard({ item, owner, busy, mutate, readOnly }: { item: DeliveryException; owner: boolean; busy: boolean; mutate: Mutate; readOnly: boolean }) {
  const [status, setStatus] = useState(item.status); const [resolution, setResolution] = useState(item.resolution); const labels = { open: "待处理", handling: "处理中", resolved: "已解决" };
  return <article className={`exception-card ${item.status}`}><header><span className={`exception-status ${item.status}`}>{labels[item.status]}</span><div><strong>{item.learner_name || item.group_name}</strong><small>{item.group_name}{item.day_label ? ` · ${item.day_label}` : ""}</small></div><time>{item.updated_at.slice(0, 16).replace("T", " ")}</time></header><div className="exception-body"><div><span>当前问题</span><p>{item.problem}</p></div><div><span>需要支持</span><p>{item.request}</p></div>{item.resolution && <div><span>处理结果</span><p>{item.resolution}</p></div>}</div>{owner && !readOnly && <div className="exception-handle"><select value={status} onChange={(event) => setStatus(event.target.value as DeliveryException["status"])}><option value="open">待处理</option><option value="handling">处理中</option><option value="resolved">已解决</option></select><input value={resolution} onChange={(event) => setResolution(event.target.value)} placeholder="记录处理动作或最终结果"/><button disabled={busy} onClick={() => mutate({ action: "update_exception", id: item.id, status, resolution }, "异常处理记录已更新")}>更新</button></div>}<details><summary>处理轨迹 · {item.events.length} 条</summary>{item.events.map((event) => <p key={event.id}><b>{event.action}</b> {event.detail}<time>{event.created_at}</time></p>)}</details></article>;
}

function CohortManager({ snapshot, busy, mutate, switchCohort }: { snapshot: WorkspaceSnapshot; busy: boolean; mutate: Mutate; switchCohort: (id: number, tab?: Tab) => Promise<void> }) {
  const [source, setSource] = useState<PlanSource>("standard");
  const [showCreate, setShowCreate] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); if (await mutate({ action: "initialize", planSource: source, sourceCohortId: data.get("sourceCohortId"), name: data.get("name"), preStartDate: data.get("preStartDate"), offlineStartDate: data.get("offlineStartDate"), postStartDate: data.get("postStartDate") }, "新营期已创建并切换")) { form.reset(); setSource("standard"); setShowCreate(false); } };
  const changeStatus = async (cohort: WorkspaceSnapshot["cohorts"][number]) => { const archive = cohort.status === "active"; if (archive && !window.confirm(`确认归档“${cohort.name}”？归档后保留全部数据，但只能查看。`)) return; await mutate({ action: archive ? "archive_cohort" : "reopen_cohort", cohortId: cohort.id }, archive ? "营期已归档" : "营期已重新开启"); };
  return <section className="content-page cohort-page">
    <PageTitle kicker="COHORT CONTROL" title="营期管理" detail="每一期拥有独立任务、教练、学员与历史档案；创建新营期不会改动其他营期。" action={<button className={showCreate ? "ghost" : "primary"} onClick={() => setShowCreate(!showCreate)}>{showCreate ? "取消新建" : "+ 新建营期"}</button>}/>
    {showCreate && <form className="settings-card cohort-create-panel" onSubmit={submit}>
      <div className="cohort-create-heading"><span className="card-number">NEW COHORT</span><h2>创建新营期</h2><p>选好计划来源与三个阶段日期，系统会生成一份独立的25天计划。</p></div>
      <div className="cohort-create-fields"><label>营期名称<input name="name" required/></label><label>25天计划来源<select name="planSource" value={source} onChange={(event) => setSource(event.target.value as PlanSource)}><option value="standard">标准25天模板</option><option value="cohort">复制已有营期</option><option value="blank">25天空白计划</option></select></label>{source === "cohort" && <label>复制哪一期<select name="sourceCohortId" required defaultValue=""><option value="" disabled>请选择</option>{snapshot.cohorts.map((cohort) => <option value={cohort.id} key={cohort.id}>{cohort.name}{cohort.status === "archived" ? " · 已归档" : ""}</option>)}</select></label>}</div>
      <div className="date-grid"><label>线上前10天开始<input name="preStartDate" type="date" required/></label><label>线下5天开始<input name="offlineStartDate" type="date" required/></label><label>线上后10天开始<input name="postStartDate" type="date" required/></label></div>
      <div className="cohort-create-actions"><button type="button" className="text-button" onClick={() => setShowCreate(false)}>取消</button><button className="primary" disabled={busy}>{busy ? "正在创建…" : "创建并进入新营期"}</button></div>
    </form>}
    <div className="cohort-list"><div className="section-head"><div><span className="kicker">COHORT ARCHIVE</span><h2>全部营期</h2></div><b>{snapshot.cohorts.length} 期</b></div>{snapshot.cohorts.map((cohort) => <article key={cohort.id} className={`${cohort.id === snapshot.cohort?.id ? "current" : ""} ${cohort.status}`}><button type="button" className="cohort-open" onClick={() => switchCohort(cohort.id, cohort.status === "archived" ? "learners" : "overview")}><strong>{cohort.name}</strong><small>{cohort.pre_start_date} → {cohort.post_start_date}</small>{cohort.archived_at && <small>归档于 {cohort.archived_at.slice(0, 16).replace("T", " ")} · {cohort.archived_by}</small>}<b>{cohort.status === "archived" ? "查看历史档案 →" : "进入营期 →"}</b></button><div className="cohort-actions"><span>{cohort.status === "archived" ? "已归档" : cohort.id === snapshot.cohort?.id ? "当前营期" : "进行中"}</span><button type="button" disabled={busy} onClick={() => changeStatus(cohort)}>{cohort.status === "archived" ? "重新开启" : "归档营期"}</button></div></article>)}</div>
  </section>;
}

function Settings({ snapshot, busy, mutate, readOnly }: { snapshot: WorkspaceSnapshot; busy: boolean; mutate: Mutate; readOnly: boolean }) {
  const add = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); if (await mutate({ action: "add_coach_group", displayName: data.get("displayName"), email: data.get("email"), groupName: data.get("groupName") }, "教练与小组已添加")) form.reset(); };
  const importRows = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); if (await mutate({ action: "import_learners", groupId: data.get("groupId"), text: data.get("text") }, "学员名单已导入并匹配教练")) form.reset(); };
  return <section className="content-page"><PageTitle kicker="TEAM SETUP" title="成员与分组" detail="这里管理当前营期的带组关系；教练账号不会因退出某一期而被全局删除。"/><div className="settings-grid"><form className="settings-card" onSubmit={add}><fieldset disabled={readOnly}><span className="card-number">01</span><h2>添加教练和小组</h2><label>教练姓名<input name="displayName" required/></label><label>登录邮箱<input name="email" type="email" required/></label><label>小组名称<input name="groupName" required/></label><button className="primary" disabled={busy}>添加</button></fieldset></form><form className="settings-card" onSubmit={importRows}><fieldset disabled={readOnly}><span className="card-number">02</span><h2>批量导入学员</h2><p>先选择小组，再粘贴“姓名，备注”，每行一名学员。</p><label>选择小组与教练<select name="groupId" required defaultValue=""><option value="" disabled>请选择小组</option>{snapshot.groups.map((group) => <option key={group.id} value={group.id}>{group.name} · {group.coach_name}</option>)}</select></label><textarea name="text" required rows={7} placeholder={"苏娜\n陈晨，成长型\n林晓，放大型"}/><button className="primary" disabled={busy || !snapshot.groups.length}>导入并匹配</button></fieldset></form></div><section className="group-admin"><div className="section-head"><div><span className="kicker">CURRENT COHORT</span><h2>当前营期分组</h2></div><b>{snapshot.groups.length} 组 · {snapshot.learners.length} 名学员</b></div>{snapshot.groups.length ? snapshot.groups.map((group) => <GroupAdminRow key={group.id} group={group} groups={snapshot.groups} busy={busy} readOnly={readOnly} mutate={mutate}/>) : <Empty title="当前营期还没有分组" detail="先在上方添加教练和小组。"/>}</section></section>;
}

function GroupAdminRow({ group, groups, busy, readOnly, mutate }: { group: Group; groups: Group[]; busy: boolean; readOnly: boolean; mutate: Mutate }) {
  const [editing, setEditing] = useState(false); const [target, setTarget] = useState("");
  const save = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const data = new FormData(event.currentTarget); if (await mutate({ action: "update_coach_group", groupId: group.id, displayName: data.get("displayName"), email: data.get("email"), groupName: data.get("groupName") }, `${group.name} 已更新`)) setEditing(false); };
  if (editing) return <form className="group-admin-row editing" onSubmit={save}><label>小组名称<input name="groupName" defaultValue={group.name} required/></label><label>教练姓名<input name="displayName" defaultValue={group.coach_name} required/></label><label>登录邮箱<input name="email" type="email" defaultValue={group.coach_email} required/></label><div><button type="button" className="ghost" onClick={() => setEditing(false)}>取消</button><button className="primary" disabled={busy}>保存</button></div></form>;
  return <article className="group-admin-row"><div className="group-title"><span>{group.name.slice(0, 2)}</span><div><strong>{group.name}</strong><small>{group.coach_name} · {group.coach_email}</small></div></div><b>{group.learner_count} 名学员</b>{!readOnly && <div className="group-row-actions"><button className="ghost" onClick={() => setEditing(true)}>编辑</button>{group.learner_count === 0 ? <button className="danger-link" disabled={busy} onClick={() => window.confirm(`确认移除空小组“${group.name}”？`) && mutate({ action: "remove_empty_group", groupId: group.id }, "空小组已移除")}>移除</button> : groups.length > 1 ? <><select value={target} onChange={(event) => setTarget(event.target.value)}><option value="">合并到…</option>{groups.filter((item) => item.id !== group.id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button disabled={busy || !target} onClick={() => window.confirm(`确认把“${group.name}”的学员与异常合并到目标组？`) && mutate({ action: "merge_group", fromGroupId: group.id, toGroupId: Number(target) }, "小组已合并")}>确认合并</button></> : <small>需先创建目标组才能合并</small>}</div>}</article>;
}

function PageTitle({ kicker, title, detail, action }: { kicker: string; title: string; detail: string; action?: React.ReactNode }) { return <div className="page-title"><div><span className="kicker">{kicker}</span><h1>{title}</h1><p>{detail}</p></div>{action}</div>; }
function Empty({ title, detail }: { title: string; detail: string }) { return <div className="empty"><span>○</span><strong>{title}</strong><p>{detail}</p></div>; }
