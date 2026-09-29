# WorkTrace

WorkTrace 是面向团队的工作日志系统。成员可以在网页中填写结构化日报，也可以通过个人 API Key 让 AI Agent 以 REST API 或 MCP（Model Context Protocol）方式提交、查询和维护日志。

界面提供中文与 English 双语切换；日报按 `Asia/Shanghai`（上海时区）的日期归档。

## 核心能力

- **企业 Google Workspace 登录**：当前仅允许 `@feedmob.com` 域名账号登录。
- **结构化日报**：记录标题、完成事项、进行中、阻塞 / 风险和明日计划，并支持图片附件。
- **团队协作**：浏览、搜索和筛选团队工作日志；作者可维护自己的日志。
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
| `LOCAL_DATABASE_PATH` | SQLite 数据库路径；本地可使用 `worktrace-local.db`。 |

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
