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
- `app/access-auth.ts`：Cloudflare Access 登录身份读取。
- `db/schema.ts`、`drizzle/`：D1 数据结构与迁移。
- `lib/policy.mjs`：分组权限和验收证据校验。

## Cloudflare 部署

生产环境使用 Cloudflare Workers、D1 和 Access。`main` 分支连接 Workers Builds，构建命令为 `npm test`，发布命令为 `npx wrangler deploy`。

运行变量：

- `INITIAL_OWNER_EMAIL=729685219@qq.com`
- `CF_ACCESS_TEAM_DOMAIN=<team>.cloudflareaccess.com`
- `CF_ACCESS_AUD=<Access application audience>`

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

暂不包含学员端、文件上传、站内聊天、消息通知、飞书自动同步、绩效管理和多期营复用后台。
