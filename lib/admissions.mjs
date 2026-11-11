export const deliveryStatuses = ["待安排", "已排期", "交付中", "延期待交付", "已完成", "退费处理中", "已退费"];

export const admissionSchema = [
  `CREATE TABLE IF NOT EXISTS student_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(name,phone))`,
  `CREATE TABLE IF NOT EXISTS admissions (
    id TEXT PRIMARY KEY, student_id INTEGER REFERENCES student_profiles(id),
    name TEXT NOT NULL, nickname TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL,
    sales_name TEXT NOT NULL, channel TEXT NOT NULL, registered_on TEXT NOT NULL,
    product TEXT NOT NULL, price_cents INTEGER NOT NULL, promise TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT '待安排', cohort_id INTEGER REFERENCES cohorts(id),
    group_id INTEGER REFERENCES groups(id), learner_id INTEGER REFERENCES learners(id),
    original_cohort_id INTEGER REFERENCES cohorts(id), intended_cohort TEXT NOT NULL DEFAULT '',
    follow_up_owner TEXT NOT NULL DEFAULT '', delivery_note TEXT NOT NULL DEFAULT '',
    source_json TEXT NOT NULL, source_error TEXT NOT NULL DEFAULT '',
    version INTEGER NOT NULL DEFAULT 1, synced_version INTEGER NOT NULL DEFAULT 0, last_mutation TEXT,
    return_json TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS admission_placements (
    admission_id TEXT NOT NULL REFERENCES admissions(id), cohort_id INTEGER NOT NULL REFERENCES cohorts(id),
    learner_id INTEGER NOT NULL REFERENCES learners(id), PRIMARY KEY(admission_id,cohort_id), UNIQUE(learner_id))`,
  `CREATE TABLE IF NOT EXISTS admission_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, admission_id TEXT NOT NULL REFERENCES admissions(id),
    actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS idx_admission_events_admission ON admission_events(admission_id,id)`,
  `CREATE TABLE IF NOT EXISTS refund_requests (
    id TEXT PRIMARY KEY, admission_id TEXT NOT NULL, name TEXT NOT NULL, phone TEXT NOT NULL,
    sales_name TEXT NOT NULL, amount_cents INTEGER NOT NULL, explanation TEXT NOT NULL,
    attachments_json TEXT NOT NULL, source_json TEXT NOT NULL, source_error TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS admission_cohort_codes (
    cohort_id INTEGER PRIMARY KEY REFERENCES cohorts(id), code TEXT NOT NULL UNIQUE)`,
  `CREATE TABLE IF NOT EXISTS admission_sync_state (
    id INTEGER PRIMARY KEY CHECK(id=1), lock_owner TEXT, lock_until INTEGER NOT NULL DEFAULT 0,
    last_success TEXT, last_error TEXT NOT NULL DEFAULT '', pull_offset INTEGER NOT NULL DEFAULT 0,
    refund_offset INTEGER NOT NULL DEFAULT 0)`,
  `INSERT OR IGNORE INTO admission_sync_state (id) VALUES (1)`,
];

export async function ensureAdmissionSchema(db) {
  await db.batch(admissionSchema.map((sql) => db.prepare(sql)));
}

export function cellText(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(cellText).join("");
  if (typeof value === "object") return String(value.text ?? value.name ?? value.value ?? "");
  return String(value).trim();
}

export function parseRegistration(fields) {
  const text = (name) => cellText(fields[name]).trim();
  const name = text("学员真实姓名");
  const phone = text("手机号").replace(/[\s()-]/g, "").replace(/^\+?86(?=1\d{10}$)/, "");
  const dateValue = fields["报名日期"];
  let registeredOn = text("报名日期").slice(0, 10).replaceAll("/", "-");
  if (typeof dateValue === "number" && Number.isFinite(dateValue)) {
    registeredOn = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date(dateValue));
  }
  const priceText = text("产品价格");
  const price = Number(priceText);
  const row = {
    name, nickname: text("微信昵称"), phone, sales_name: text("销售负责人"),
    channel: text("报名渠道"), registered_on: registeredOn, product: text("购买产品"),
    price_cents: Math.round(price * 100), promise: text("特别承诺"),
  };
  const errors = [];
  if (!name || name.length > 100) errors.push("请填写100字以内的真实姓名");
  if (!/^1\d{10}$/.test(phone) && !/^\+[1-9]\d{6,14}$/.test(phone)) errors.push("请核对手机号，海外号码需含国际区号");
  if (!row.sales_name) errors.push("请填写销售负责人");
  if (!["线下课", "线上单转"].includes(row.channel)) errors.push("请选择报名渠道");
  const date = new Date(`${registeredOn}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(registeredOn) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== registeredOn) errors.push("请填写有效报名日期");
  if (!row.product) errors.push("请填写购买产品");
  if (!priceText || !Number.isFinite(price) || price < 0 || !Number.isSafeInteger(row.price_cents)) errors.push("请填写有效成交金额");
  if (!row.promise) errors.push("请填写特别承诺，没有请填无");
  if (Object.values(row).some((value) => typeof value === "string" && value.length > 10000)) errors.push("单项内容超过10000字");
  return { row, error: errors.join("；") };
}

export function unpackRecords(data) {
  if (!Array.isArray(data.fields) || !Array.isArray(data.record_id_list) || !Array.isArray(data.data)) throw new Error("飞书记录响应格式异常");
  if (data.record_id_list.length !== data.data.length) throw new Error("飞书记录数量与数据不一致");
  return data.record_id_list.map((id, index) => ({
    id, fields: Object.fromEntries(data.fields.map((name, col) => [name, data.data[index][col]])),
  }));
}

export async function importRegistration(db, record) {
  if (!/^rec[a-zA-Z0-9]+$/.test(record.id)) throw new Error("飞书报名记录编号无效");
  const { row, error } = parseRegistration(record.fields);
  const source = JSON.stringify(row);
  const existing = await db.prepare("SELECT source_json,source_error FROM admissions WHERE id=?").bind(record.id).first();
  if (existing?.source_json === source && existing.source_error === error) return false;
  const statements = [];
  if (!error) statements.push(db.prepare("INSERT OR IGNORE INTO student_profiles (name,phone) VALUES (?,?)").bind(row.name, row.phone));
  const values = [record.id, row.name, row.nickname, row.phone, row.sales_name, row.channel, row.registered_on, row.product,
    Number.isFinite(row.price_cents) ? row.price_cents : 0, row.promise, source, error];
  statements.push(db.prepare(`INSERT INTO admissions
    (id,name,nickname,phone,sales_name,channel,registered_on,product,price_cents,promise,source_json,source_error)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
    name=excluded.name,nickname=excluded.nickname,phone=excluded.phone,sales_name=excluded.sales_name,
    channel=excluded.channel,registered_on=excluded.registered_on,product=excluded.product,
    price_cents=excluded.price_cents,promise=excluded.promise,source_json=excluded.source_json,
    source_error=excluded.source_error,version=admissions.version+1,updated_at=CURRENT_TIMESTAMP`).bind(...values));
  if (!error) statements.push(db.prepare(`UPDATE admissions SET student_id=COALESCE(student_id,
    (SELECT id FROM student_profiles WHERE name=? AND phone=?)) WHERE id=?`).bind(row.name, row.phone, record.id));
  statements.push(db.prepare("INSERT INTO admission_events (admission_id,actor,action,detail) VALUES (?,?,?,?)")
    .bind(record.id, "飞书报名表", existing ? "报名信息更新" : "报名登记", source));
  await db.batch(statements);
  return true;
}

export const admissionSelect = `SELECT a.*,c.name cohort_name,c.status cohort_status,g.name group_name,
  COALESCE(m.display_name,g.coach_email) coach_name,cc.code cohort_code
  FROM admissions a LEFT JOIN cohorts c ON c.id=a.cohort_id LEFT JOIN groups g ON g.id=a.group_id
  LEFT JOIN members m ON m.email=g.coach_email LEFT JOIN admission_cohort_codes cc ON cc.cohort_id=c.id`;

export function returnFields(row) {
  return {
    "学员编号": row.student_id ? `YQ${String(row.student_id).padStart(6, "0")}` : "待核对",
    "报名编号": row.id, "交付状态": [row.status], "当前营期": row.cohort_name || "待安排",
    "营期编号": row.cohort_code || "", "小组": row.group_name || "待分配", "交付教练": row.coach_name || "待分配",
    "系统同步结果": row.source_error ? `待补资料 · ${row.source_error}` : "已同步",
    "系统档案": `https://yueqian-coach-ops-prod.vanya-ops.workers.dev/?admission=${encodeURIComponent(row.id)}`,
  };
}

export function createFeishuClient(env, fetcher = fetch) {
  let accessToken;
  async function request(path, method = "GET", body, raw = false) {
    if (!accessToken) {
      const response = await fetcher("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET }),
        signal: AbortSignal.timeout(20000),
      });
      const data = await response.json();
      if (!response.ok || data.code !== 0 || !data.tenant_access_token) throw new Error(`飞书身份验证失败 (${data.code ?? response.status})`);
      accessToken = data.tenant_access_token;
    }
    const response = await fetcher(`https://open.feishu.cn/open-apis${path}`, {
      method, headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body), signal: raw ? undefined : AbortSignal.timeout(20000),
    });
    if (raw) {
      if (!response.ok) throw new Error(`飞书附件读取失败 (${response.status})`);
      return response;
    }
    const data = await response.json();
    if (!response.ok || data.code !== 0) throw new Error(`飞书接口失败 (${data.code ?? response.status})`);
    return data.data;
  }
  return { request };
}

export async function syncAdmissions(db, env, client = createFeishuClient(env)) {
  if (![env.FEISHU_APP_ID, env.FEISHU_APP_SECRET, env.FEISHU_BASE_TOKEN, env.FEISHU_REGISTRATION_TABLE].every(Boolean)) throw new Error("尚未配置飞书同步");
  await ensureAdmissionSchema(db);
  const owner = crypto.randomUUID();
  const now = Date.now();
  const lease = await db.prepare("UPDATE admission_sync_state SET lock_owner=?,lock_until=? WHERE id=1 AND lock_until<?")
    .bind(owner, now + 240000, now).run();
  if (!lease.meta.changes) return { busy: true };
  const base = `/base/v3/bases/${env.FEISHU_BASE_TOKEN}/tables/${env.FEISHU_REGISTRATION_TABLE}/records`;
  let imported = 0;
  let pushed = 0;
  try {
    const state = await db.prepare("SELECT pull_offset FROM admission_sync_state WHERE id=1").first();
    const page = await client.request(`${base}?limit=200&offset=${state.pull_offset}`);
    const records = unpackRecords(page);
    for (const record of records) if (await importRegistration(db, record)) imported += 1;
    const nextOffset = page.has_more ? state.pull_offset + records.length : 0;
    if (page.has_more && !records.length) throw new Error("飞书分页没有返回记录，请稍后重试");
    await db.prepare("UPDATE admission_sync_state SET pull_offset=? WHERE id=1 AND lock_owner=?").bind(nextOffset, owner).run();
    if (env.FEISHU_REFUND_TABLE) {
      const refundState = await db.prepare("SELECT refund_offset FROM admission_sync_state WHERE id=1").first();
      const refundPage = await client.request(`/base/v3/bases/${env.FEISHU_BASE_TOKEN}/tables/${env.FEISHU_REFUND_TABLE}/records?limit=200&offset=${refundState.refund_offset}`);
      const refundRecords = unpackRecords(refundPage);
      for (const record of refundRecords) await importRefund(db, record);
      if (refundPage.has_more && !refundRecords.length) throw new Error("退费记录分页为空，请稍后重试");
      await db.prepare("UPDATE admission_sync_state SET refund_offset=? WHERE id=1 AND lock_owner=?")
        .bind(refundPage.has_more ? refundState.refund_offset + refundRecords.length : 0, owner).run();
    }
    const candidates = (await db.prepare(`${admissionSelect} ORDER BY a.updated_at,a.id`).all()).results;
    const pending = candidates.filter((row) => row.version > row.synced_version || row.return_json !== JSON.stringify(returnFields(row))).slice(0, 100);
    if (pending.length) {
      await client.request(`${base}/batch_update`, "POST", { update_records: Object.fromEntries(pending.map((row) => [row.id, returnFields(row)])) });
      await db.batch(pending.map((row) => db.prepare("UPDATE admissions SET synced_version=?,return_json=? WHERE id=? AND version=?").bind(row.version, JSON.stringify(returnFields(row)), row.id, row.version)));
      pushed = pending.length;
    }
    await db.prepare("UPDATE admission_sync_state SET last_success=CURRENT_TIMESTAMP,last_error='' WHERE id=1 AND lock_owner=?").bind(owner).run();
    return { imported, pushed, hasMore: page.has_more, checked: records.length };
  } catch (error) {
    await db.prepare("UPDATE admission_sync_state SET last_error=? WHERE id=1 AND lock_owner=?").bind(error.message.slice(0, 500), owner).run();
    throw error;
  } finally {
    await db.prepare("UPDATE admission_sync_state SET lock_until=0,lock_owner=NULL WHERE id=1 AND lock_owner=?").bind(owner).run();
  }
}

export async function importRefund(db, record) {
  const text = (field) => cellText(record.fields[field]).trim();
  const admissionId = text("报名编号");
  const phone = text("手机号").replace(/[\s()-]/g, "").replace(/^\+?86(?=1\d{10}$)/, "");
  const amount = Number(text("申请退费金额"));
  const attachments = record.fields["挽退记录"];
  const admission = await db.prepare("SELECT * FROM admissions WHERE id=?").bind(admissionId).first();
  const errors = [];
  if (!admission) errors.push("报名编号未匹配，请核对");
  else if (admission.phone !== phone || admission.name !== text("学员真实姓名")) errors.push("姓名或手机号与报名记录不一致");
  if (!text("退费说明") || !text("销售负责人")) errors.push("请填写退费说明和销售负责人");
  if (!text("申请退费金额") || !Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(Math.round(amount * 100))) errors.push("请核对申请退费金额");
  if (!Array.isArray(attachments) || !attachments.length) errors.push("请上传挽退截图或录音");
  const source = JSON.stringify(record.fields);
  const error = errors.join("；");
  const previous = await db.prepare("SELECT source_json,source_error FROM refund_requests WHERE id=?").bind(record.id).first();
  if (previous?.source_json === source && previous.source_error === error) return;
  const statements = [db.prepare(`INSERT INTO refund_requests
    (id,admission_id,name,phone,sales_name,amount_cents,explanation,attachments_json,source_json,source_error)
    VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET admission_id=excluded.admission_id,name=excluded.name,
    phone=excluded.phone,sales_name=excluded.sales_name,amount_cents=excluded.amount_cents,explanation=excluded.explanation,
    attachments_json=excluded.attachments_json,source_json=excluded.source_json,source_error=excluded.source_error,updated_at=CURRENT_TIMESTAMP`)
    .bind(record.id, admissionId, text("学员真实姓名"), phone, text("销售负责人"),
      Number.isFinite(amount) ? Math.round(amount * 100) : 0, text("退费说明"), JSON.stringify(attachments || []), source, error)];
  if (!error) {
    statements.push(db.prepare(`UPDATE admissions SET status='退费处理中',version=version+1,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND status NOT IN ('退费处理中','已退费')`).bind(admissionId));
    statements.push(db.prepare("INSERT INTO admission_events (admission_id,actor,action,detail) VALUES (?,?,?,?)")
      .bind(admissionId, text("销售负责人"), previous ? "退费申请更新" : "退费申请", source));
  }
  await db.batch(statements);
}
