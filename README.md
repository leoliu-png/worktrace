# WorkTrace

WorkTrace 是面向团队的工作日志系统。成员可以在网页中填写结构化日报，也可以通过个人 API Key 让 AI Agent 以 REST API 或 MCP（Model Context Protocol）方式提交、查询和维护日志。

界面提供中文与 English 双语切换；日报按 `Asia/Shanghai`（上海时区）的日期归档。

## 核心能力

- **企业 Google Workspace 登录**：当前仅允许 `@feedmob.com` 域名账号登录。
- **结构化日报**：记录标题、完成事项、进行中、阻塞 / 风险和明日计划，并支持图片附件。
- **团队协作**：浏览、搜索和筛选团队工作日志；作者可维护自己的日志。
- **建议反馈**：用户可提交功能建议、问题和使用体验，查看自己的反馈及处理回复；管理员可在反馈管理中回复并更新状态。反馈保存到现有 SQLite 数据库，升级时会自动创建所需数据表。
- **管理员控制台**：成员角色、访问域名、全局日志和安全审计管理。
- **个人 API Key**：在控制台创建、回显、启用、禁用或撤销用于自动化访问的密钥。
- **AI Agent 集成**：通过 REST API、MCP 服务和 WorkTrace Skill 接入 Agent；创建日志前可先生成草稿并由用户确认。
- **安全与可靠性**：API Key 密文存储、敏感操作审计、幂等写入和受限请求解析。

## 技术栈

- Next.js 15（App Router）、React 19、TypeScript
- Auth.js（Google OAuth）
- SQLite（`better-sqlite3`）与 Zod
- MCP TypeScript SDK
- Vitest

## 开始使用

### 前置条件

- Node.js 22（项目 Docker 镜像同样基于 Node.js 22）
- 已在 [Google Cloud Console](https://console.cloud.google.com/) 创建 OAuth 2.0「Web 应用」客户端

### 1. 安装依赖

```bash
npm ci
```

### 2. 配置环境变量

复制示例文件：

```bash
cp .env.example .env
```

至少配置以下项目：

| 变量 | 说明 |
| --- | --- |
| `AUTH_SECRET` | Auth.js 会话密钥；可用 `openssl rand -base64 32` 生成。 |
| `GOOGLE_CLIENT_ID` | Google OAuth 客户端 ID。 |
| `GOOGLE_CLIENT_SECRET` | Google OAuth 客户端密钥。 |
| `KEY_ENCRYPTION_SECRET` | 用于加密 API Key 的密钥；生产环境必须替换示例值。 |
| `ADMIN_EMAILS` | 额外初始管理员邮箱，以逗号分隔；未配置时为 `linden@feedmob.com`。内置管理员 `leo_liu@feedmob.com` 始终生效。 |
| `LOCAL_DATABASE_PATH` | SQLite 数据库路径；本地可使用 `worktrace-local.db`。 |

`leo_liu@feedmob.com` 已写入代码作为内置管理员。部署新版并重启服务后，系统首次连接数据库时会将已有的该账号升级为管理员并记录审计事件；该账号首次登录创建时也会自动获得管理员角色。服务器保留旧的 `ADMIN_EMAILS` 配置也不影响这个规则。内置管理员不能在成员管理中降为普通成员；其他成员角色仍按现有方式管理。

在 Google OAuth 客户端中添加本地回调地址：

```text
http://localhost:3000/api/auth/callback/google
```

> 当前登录域名固定为 `feedmob.com`，如需更换，请同步修改 `src/auth.ts`、`src/lib/request-user.ts` 与 `src/lib/development-user.ts` 中的域名校验。

### 3. 启动开发服务

```bash
npm run dev
```

打开 <http://localhost:3000>，使用允许域名内的 Google 账号登录。SQLite 数据库会在首次运行时自动创建。

### 常用命令

```bash
npm test       # 运行测试
npm run build  # 生成生产构建
npm start      # 启动生产服务
```

## Agent 与 API 接入

先在「控制台 → API 密钥」创建个人 API Key。REST API 的请求头格式为：

```http
Authorization: Bearer wtk_你的密钥
```

| 方法 | 地址 | 用途 |
| --- | --- | --- |
| `GET` / `POST` | `/api/v1/work-logs` | 查询或创建工作日志；`POST` 支持 `Idempotency-Key`。 |
| `GET` / `POST` | `/api/v1/api-keys` | 查询或创建个人 API Key。 |
| `PATCH` | `/api/v1/api-keys/:id` | 更新密钥状态。 |
| `POST` | `/api/v1/api-keys/:id/reveal` | 回显指定密钥。 |

### MCP 配置示例

MCP 服务位于 `/mcp`，与 REST API 使用同一个个人 API Key：

```json
{
  "mcpServers": {
    "worktrace": {
      "type": "http",
      "url": "https://你的域名/mcp",
      "headers": {
        "Authorization": "Bearer wtk_你的密钥"
      }
    }
  }
}
```

可用工具包括：`prepare_work_log`、`create_work_log`、`update_work_log`、`list_work_logs`、`get_work_log` 和 `get_daily_submission_status`。

Agent Skill 可从以下地址读取：

```text
https://你的域名/skill/worktrace
```

### 将工作日志同步到 Mobius Issue

在运行 WorkTrace 的服务器 `.env` 中配置：

```dotenv
MOBIUS_MCP_URL=https://mobius.feedmob.com/api/mcp
MOBIUS_PAT=你的_Mobius_令牌
MOBIUS_SYNC_AUTHOR_EMAILS=需要启用同步的成员邮箱
```

提交或修改**当天**的工作日志时，网页、REST API 和 WorkTrace MCP 只在日志作者的 Mobius **My issues → Participating** 列表中匹配 Issue。这个范围由 Mobius 的实际订阅记录决定；只有 Assignee / Collaborator，或者曾创建、评论过 Issue，都不能代替当前订阅关系。Done / Completed 状态不评论，也不会把内容改投次优候选。只有日志条目中明确写出范围内的 Issue 编号，或候选有唯一的高置信匹配，且该 Issue 按上海时间今天尚无更新时，系统才会评论；同一 Issue 当天最多自动评论一次。匹配不明确的条目会跳过，可在日志中写入 `AI-1234` 形式的 Issue 编号。

当前 Mobius MCP 的 `list_issues` 没有订阅筛选，因此候选集合使用同一个 `MOBIUS_PAT` 读取 Mobius 页面的 `/api/issues?subscriberId=当前令牌用户ID` 接口，Issue 详情、状态检查和发表评论继续通过 Mobius MCP。系统会确认订阅筛选有效；无法读取或验证这个范围时停止自动评论，不扩大到其他 Issue。发表评论前重新读取 Participating，退订的 Issue 会被排除。

标题、人工描述和历史人工评论共同提供项目线索，因此评论中的项目名也能对应中文标题；AI 背景补全以及 WorkTrace 自动评论不能单独建立匹配。项目名和核心主题优先于额外的进度描述，模型名称中的版本空格会统一处理。Participating 集合及 Issue 详情在同一次提交的匹配阶段复用；范围或状态不符合条件的候选会在 Dashboard 显示排除原因。

每次提交的匹配结果会保存在本地数据库中。从 Dashboard 左侧导航进入独立的「Issue 匹配结果」模块，可查看提交来源（手动 / MCP / API）、关联的日志条目、Issue 链接、实际评论正文和跳过或失败原因；概览页不再展示这部分内容。结果页面可见时每 15 秒刷新，并支持分页查看自己的历史记录。日志保存后的结果提示也直接链接到该模块。未配置连接、非当日日志以及同步失败也会留下结果。新增记录从启用此功能后的提交开始，不会重新评论历史日志。

评论的发布身份由 `MOBIUS_PAT` 决定，令牌所属账号必须与日志作者邮箱相同，否则不发表评论。Codex 中配置的 `mobius_mcp` 连接不会自动成为 WorkTrace 服务器的凭据；请将令牌只放在服务器环境变量中。

#### 使用 Jev 匹配 Issue

在 WorkTrace 服务环境中启用：

```dotenv
MOBIUS_MATCHER=jev
OPENROUTER_API_KEY=你的_OpenRouter_密钥
JEV_MODEL=typesafe/jev-1.13
JEV_MIN_PROBABILITY=0.75
JEV_MIN_CONFIDENCE=0.70
JEV_MIN_MARGIN=0.20
```

WorkTrace 只匹配已开展的工作；Todo、待办、明日计划、带 `Todo:` / `待办：` 前缀的条目和未勾选的任务框不参与匹配，并在结果中记录跳过原因。网页 Markdown 和 MCP / API 结构化字段使用相同规则。系统从 Participating Issue 的真实标题、人工描述和人工评论摘录组装候选说明，排除 AI 背景补全及 WorkTrace 自动评论。同一项目的后续排查、维护、优化和新增功能可以对应原项目 Issue；项目名可以由人工评论或项目链接建立，单独使用相同模型或工具不能建立匹配。每个实际工作条目对应一个 `choice` 问题，选项为候选 Issue 编号和 `NONE`（没有明确匹配）。同一次请求可以判断多个条目；不读取过去七天的工作日志，也不让 Jev 生成说明或评论。请求通过 [OpenRouter Decisions API](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request) 调用，相关日志条目和候选摘录会发送到 OpenRouter / TypeSafe，并计入该 OpenRouter 账号的用量。

Jev 返回选中编号、各选项概率和 `confidence`。选择概率与 confidence 分别保存；领先幅度是选中选项与第二名的概率之差。这三项都达到配置阈值后才采用匹配。阈值是初始策略，不代表已验证的准确率，尤其 [Jev 官方说明中文等 CJK 内容目前准确率较低](https://docs.typesafe.ai/concepts/state)。最佳候选是 Done / Completed 时直接跳过，不重新选择活跃 Issue。Participating 范围、令牌身份、当日更新和去重检查仍由 WorkTrace 在评论前执行。

「Issue 匹配结果」会记录每个条目的匹配方式、模型、前三个选项的概率及未评论原因。Jev 失败、缺少密钥、配置错误或返回非法候选时不降级到关键词自动评论。每次请求有 15 秒超时，Jev 请求批次最多并行两个，并共用 45 秒截止时间；超过上下文预算时缩短摘录和拆分条目批次，始终保留完整候选集合，无法容纳时停止该次语义匹配。当前最多处理 254 个候选 Issue，另保留 `NONE` 选项。

日志中明确写出的唯一 Issue 编号仍直接匹配，无需 Jev，且经过相同范围和状态检查。未设置 `MOBIUS_MATCHER` 时继续使用原有关键词规则；如需切回，可设置 `MOBIUS_MATCHER=rules`。修改环境变量后重新启动服务，新提交会使用新设置，历史结果不会自动重算。

不要在聊天内容、工作日志或代码中保存明文 API Key；请将其存入 Agent 的安全环境变量（例如 `WORKTRACE_API_KEY`）。

## 部署

项目包含 `Dockerfile`、`compose.yaml` 和 Caddy 反向代理示例。

1. 将 `deploy/worktrace.env.example` 复制为部署目录中的 `.env`，填写全部密钥与域名。
2. 在 `compose.yaml` 所在目录运行：

   ```bash
   docker compose up -d --build
   ```

3. 容器监听 `127.0.0.1:16063`，使用 `deploy/Caddyfile.worktrace` 配置域名反向代理。

生产环境应设置 `AUTH_URL`、`AUTH_TRUST_HOST`、`NEXT_PUBLIC_APP_URL`、`KEY_ENCRYPTION_SECRET` 和持久化的 `LOCAL_DATABASE_PATH`。默认 Compose 配置会将数据卷挂载到 `/var/lib/worktrace`。

## 项目结构

```text
src/
  app/          页面、API 路由与 MCP 端点
  components/   可复用的 React 组件
  lib/          认证、数据库、API Key、日志和 MCP 领域逻辑
deploy/         Caddy 配置与生产环境变量示例
docs/           产品、前端与后端需求文档
prisma/         参考 Prisma 模型
stitch-worktrace/  视觉稿与页面素材
```

## 安全提示

- `.env`、数据库和上传文件均不应提交到 Git 仓库。
- 生产环境请使用随机生成的强密钥，并定期轮换 API Key。
- 管理员接口仅限 `ADMIN` 角色访问；敏感操作会记录审计事件。
