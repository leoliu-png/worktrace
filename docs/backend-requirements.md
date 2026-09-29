# WorkTrace 后端需求

## 身份与角色

- Google OAuth 回调必须验证邮箱域名为 `feedmob.com`。
- `User.role` 是 `member | admin`；`linden@feedmob.com` 被初始化为管理员。
- 会话与 `GET /api/v1/me` 返回角色，前端据此呈现导航。

## 管理员接口

所有 `/api/v1/admin/*` 接口均在服务端执行角色校验；成员调用返回 `403 FORBIDDEN`。

| 接口 | 用途 |
| --- | --- |
| `/api/v1/admin/members` | 成员与角色管理 |
| `/api/v1/admin/access` | 企业域名与访问控制 |
| `/api/v1/admin/logs` | 全局日志管理 |
| `/api/v1/admin/audit` | 登录和敏感动作审计 |

## 审计与约束

记录登录、角色变更、Key 创建/回显/状态变更/撤销以及日志编辑/归档。最后一位管理员不可被撤销管理员角色。

## API Key 与 REST

- Key 以 `wtk_` 前缀生成，保存不可逆 SHA-256 校验值，以及由部署密钥 AES-256-GCM 加密的可回显副本。
- REST 请求使用 `Authorization: Bearer wtk_...`；禁用或撤销 Key 后不可再创建或读取日志。
- `POST /api/v1/work-logs` 从 Key 识别作者，不接受客户端伪造的作者邮箱或用户 ID。
- Key 生命周期接口为 `/api/v1/api-keys`、`/api/v1/api-keys/:id` 和 `/api/v1/api-keys/:id/reveal`。

## 本地与生产部署

- 本地以 SQLite 兼容存储运行，Prisma 模型保留迁移到生产关系数据库的契约。
- Google OAuth、会话密钥、数据库和对象存储均通过环境变量注入；不得提交真实密钥。
- 生产须替换本地附件目录为公司对象存储，并配置健康检查、结构化日志、备份与恢复流程。
