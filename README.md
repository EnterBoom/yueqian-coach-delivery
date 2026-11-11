# 跃迁计划 · 教练交付作战台

覆盖“线上前 10 天 → 线下 5 天 → 线上后 10 天”的内部交付协同站。项目方配置营期、教练与学员；教练登记本组进度、验收证据和异常；所有权限在服务端校验。

## 接手开发

```bash
npm install
npm test
npm run dev
```

核心代码：

- `app/operations-app.tsx`：业务界面。
- `app/api/workspace/route.ts`：服务端接口与权限校验。
- `app/interview-tool.tsx`、`app/api/interview/route.ts`：工具箱内的 AI 人设深访界面与服务端模型代理。
- `app/access-auth.ts`：Cloudflare Access 登录身份读取。
- `db/schema.ts`、`drizzle/`：D1 数据结构与迁移。
- `lib/policy.mjs`：分组权限和验收证据校验。

## Cloudflare 部署

生产环境使用 Cloudflare Workers、D1 和 Access。`main` 分支连接 Workers Builds，构建命令为 `npm test`，发布命令为 `npx wrangler deploy`。

运行变量：

- `INITIAL_OWNER_EMAIL=729685219@qq.com`
- `CF_ACCESS_TEAM_DOMAIN=<team>.cloudflareaccess.com`
- `CF_ACCESS_AUD=<Access application audience>`
- `INTERVIEW_LLM_BASE_URL=https://api.deepseek.com/v1`
- `INTERVIEW_LLM_MODEL=deepseek-chat`

访谈模型密钥只作为 Worker Secret 保存，不要写入 `wrangler.jsonc` 或 GitHub：

```bash
npx wrangler secret put DEEPSEEK_API_KEY --name yueqian-coach-ops-prod
```

Access 允许邮箱完成一次性验证码身份验证；真正的数据权限由应用内 `members`、角色和分组关系控制。未登记邮箱通过验证后仍会被服务端拒绝。生产 Worker 名称和 D1 绑定见 `wrangler.jsonc`。

## 数据边界

- GitHub 仓库只包含代码和数据库迁移，不包含学员、教练、进度、证据或异常数据。
- 旧 Sites 数据通过负责人登录后的 `/api/workspace` 快照导出，再用 `scripts/build-d1-import.mjs` 生成 D1 导入 SQL。
- 原始导出、SQL 和清单保存在被忽略的 `work/` 目录；不要提交数据库、登录凭据或部署令牌。

## 权限规则

- `owner`：查看和修改全部项目数据。
- `coach`：只能查看和修改自己负责的小组。
- 未登记邮箱：不能读取项目数据。
- 已归档营期：保留全部历史数据并统一锁定为只读，只有项目方可以归档或重新开启。
- “已通过”必须提供 HTTPS 证据链接或文字验收记录。

## 当前产品边界

工具箱现包含文字版“跃迁 AI 人设深访”，访谈会话保存在当前浏览器，不进入 D1。报名与退费通过飞书表单提交，交付负责人在“报名与交接”中管理安排。暂不包含语音访谈、学员端、站内聊天、消息通知和绩效管理。

## 飞书报名与交接

销售通过报名表填写真实姓名、微信昵称、手机号、销售负责人、报名渠道、报名日期、产品、成交价格和特别承诺。系统每 5 分钟读取一页报名与退费记录，负责人也可点击“立即同步飞书”。资料不完整的记录保留并显示待核对原因。

负责人选择营期、小组和教练后，学员进入原有交付名单，教练可查看报名交接。延期保留历次安排与交付记录。退费表要求退费说明和挽退附件，负责人确认实际退费金额、日期后归档。附件保存在飞书，正式系统通过鉴权接口读取图片与音频。

飞书字段回写包括学员编号、报名编号、交付状态、当前营期、营期编号、小组、交付教练和同步结果。报名输入由飞书维护，交付安排由系统维护。重复同步按飞书记录 ID 更新，同步失败会保留待回写状态。

`FEISHU_APP_SECRET` 使用 Worker Secret，其他连接参数见 `wrangler.jsonc`。本地联调使用被忽略的 `.dev.vars`。数据库变更在 `drizzle/0004_admissions.sql`，核心逻辑在 `lib/admissions.mjs` 与 `lib/admission-actions.mjs`。
