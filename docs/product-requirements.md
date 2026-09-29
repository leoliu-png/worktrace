# WorkTrace 产品需求（Stitch 复刻版）

## 视觉基准

六个用户页面严格以 `stitch-worktrace/html` 的导出内容为基准：首页、概览、工作日志、新建日志、API Keys、我的日志。保留 Inter 字体、青蓝主色、淡紫白画布、260px 侧栏、细边框、轻量卡片和响应式布局。

## 用户与权限

- 仅通过企业 Google 账户登录；`@feedmob.com` 是允许域名。
- `linden@feedmob.com` 是首位管理员；其他用户默认成员。
- 成员可使用六个用户页面，不会看到成员管理、权限控制、日志管理、安全审计。
- 管理员额外拥有四个管理页面，可管理成员角色、访问域名、全局日志与审计事件。

## 页面映射

| 路由 | Stitch 基准 | 角色 |
| --- | --- | --- |
| `/` | 首页 - WorkTrace | 全部 |
| `/console` | 概览 - WorkTrace 控制台 | 全部 |
| `/console/logs` | 工作日志 - WorkTrace | 全部 |
| `/console/logs/new` | 新建日志 - WorkTrace | 全部 |
| `/console/api-keys` | API Keys - WorkTrace | 全部 |
| `/console/my-logs` | 我的日志 - WorkTrace | 全部 |
| `/console/admin/*` | 同控制台视觉规范 | 仅管理员 |

## 核心工作流

- 成员用 Google Workspace 登录后，可手动创建结构化日报，或通过个人 API Key 让 Agent 经 REST/MCP 自动提交。
- 日志提交即发布；团队成员均可查阅，作者可维护自己的日志，管理员可归档和恢复全局日志。
- API Key 可命名、回显、启用、禁用和撤销；每个敏感操作都会保留审计记录。
- 页面系统文案支持中文与 English 切换；提交的日志原文保持原语言。

## 体验状态

- 无日志时引导创建首条日志或配置 API/MCP；筛选无结果时可清除筛选。
- 指标、列表和详情应有骨架屏；提交按钮防重复；上传需显示进度和失败重试。
- 桌面以固定侧栏及列表/详情信息层级为主；平板收起侧栏；手机使用单列列表及独立详情。
