export type Locale = 'zh' | 'en';

const messages = {
  zh: { console: '控制台', newLog: '新建日志', overview: '概览', logs: '所有日志', myLogs: '我的日志', apiKeys: 'API 密钥', members: '成员管理', access: '权限控制', adminLogs: '日志管理', audit: '安全审计', docs: '文档', changelog: '更新日志', searchLogs: '搜索日志…', login: 'Google Workspace 登录', enterpriseTrace: '企业级智能追踪', capture: '记录工作，追踪进展。', onlyDomain: '（仅限 @feedmob.com）', mcp: '通过 MCP 接入', api: '通过 REST API 接入', mcpDescription: '让你的 AI Agent 自动将工作成果写入 WorkTrace。', apiDescription: '用个人 API Key 将结构化工作日志直接提交到团队空间。' },
  en: { console: 'Console', newLog: 'New log', overview: 'Overview', logs: 'All logs', myLogs: 'My logs', apiKeys: 'API keys', members: 'Members', access: 'Access control', adminLogs: 'Log management', audit: 'Security audit', docs: 'Docs', changelog: 'Changelog', searchLogs: 'Search logs…', login: 'Sign in with Google Workspace', enterpriseTrace: 'Enterprise work tracing', capture: 'Capture work. Trace progress.', onlyDomain: '(@feedmob.com only)', mcp: 'Connect via MCP', api: 'Connect via REST API', mcpDescription: 'Let your AI agent automatically write work results to WorkTrace.', apiDescription: 'Use a personal API key to submit structured work logs directly to the team.' },
} as const;

export type TranslationKey = keyof typeof messages.zh;
export function translate(locale: Locale, key: TranslationKey) { return messages[locale][key]; }

const pageTranslations: Record<string, string> = {
  '日志列表': 'Log list', '我的工作轨迹': 'My work trace', 'API 密钥管理': 'API key management', '成员管理': 'Member management',
  '权限控制': 'Access control', '日志管理': 'Log management', '安全审计': 'Security audit', '工作日志详情': 'Work log details',
  '编辑日志': 'Edit log', '新建日志': 'New log', '创建、管理和吊销用于访问 WorkTrace API 的个人密钥。': 'Create, manage, and revoke personal keys for accessing the WorkTrace API.',
  '您的密钥': 'Your keys', '尚未创建 API Key。': 'No API key has been created yet.', '工作日志': 'Work log', '提交人': 'Submitted by',
  '日期': 'Date', '来源': 'Source', '操作': 'Actions', '查看和管理您最近的工作日志条目。': 'View and manage your recent work-log entries.',
  '查询、删除团队全部已发布工作日志。': 'Search and delete all published team work logs.', '查询团队全部已发布工作日志。': 'Search all published team work logs.',
  '管理 FeedMob 工作轨迹成员与管理员角色。最后一位管理员不能被降级或删除。': 'Manage members and administrator roles. The final administrator cannot be demoted or removed.',
  '总日志数': 'Total logs', '活跃提交人数': 'Active submitters', '今日提交数': 'Submitted today', '最近提交时间': 'Most recent submission',
  '近期日志预览': 'Recent logs', '查看全部': 'View all', '按人员提交排行': 'Submission ranking', '暂无提交记录': 'No submissions yet.',
};

export function localize(locale: Locale, chinese: string) { return locale === 'en' ? (pageTranslations[chinese] ?? chinese) : chinese; }
