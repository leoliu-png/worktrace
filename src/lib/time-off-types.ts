export type TimeOffSource = 'web' | 'mcp' | 'api' | 'retry';
export type TimeOffReason = 'not_configured' | 'disabled' | 'different_author' | 'account_mismatch' | 'unauthorized' | 'forbidden' | 'rate_limited' | 'unavailable' | 'rejected' | 'invalid_response' | 'image_unavailable' | 'persistence_failed' | 'configuration';
export type TimeOffImageWarning = { alt: string; reason: 'missing' | 'not_saved' | 'different_author' | 'invalid_url' | 'public_url_missing' | 'file_missing' | 'configuration' };
export type TimeOffSyncResult = { status: 'synced' | 'partial' | 'error' | 'disabled' | 'skipped'; reason?: TimeOffReason; reportDate: string; journalId?: string; runId?: string; imageWarnings?: TimeOffImageWarning[] };
export type TimeOffConnection = { accountEmail: string; encryptedToken: string | null; enabled: boolean; verifiedAt: string };
export type TimeOffSyncRun = { id: string; workLogId: string; logTitle: string; reportDate: string; source: TimeOffSource; status: TimeOffSyncResult['status'] | 'syncing'; createdAt: string; finishedAt: string | null; result: TimeOffSyncResult | null };

export const timeOffReasons: Record<TimeOffReason, string> = {
  not_configured: '尚未连接 Time off，请在 Time off 同步页面添加自己的令牌。',
  disabled: 'Time off 同步已关闭。',
  different_author: '保存者不是日志作者，未同步其他人的日志。',
  account_mismatch: 'Time off 令牌所属账号与日志作者不一致，未写入日志。',
  unauthorized: 'Time off 令牌已失效，请重新连接。',
  forbidden: 'Time off 令牌没有写入权限。',
  rate_limited: 'Time off 请求过于频繁，请稍后重试。',
  unavailable: 'Time off 暂时无法连接或请求超时，请稍后重试。',
  rejected: 'Time off 未接受本次日志，请检查内容后重试。',
  invalid_response: '未能确认 Time off 的同步结果，请核对 Time off 日志后重试。',
  image_unavailable: '日志图片尚未保存或无法生成有效地址，未向 Time off 写入不完整日志。',
  persistence_failed: '同步结果未能完整保存，请到 Time off 核对。',
  configuration: 'Time off 连接配置有误，请检查服务器配置。',
};

export const timeOffImageReasons: Record<TimeOffImageWarning['reason'], string> = {
  missing: '本地找不到图片对应的日志或附件，请重新粘贴上传。',
  not_saved: '图片尚未保存，请重新粘贴上传。',
  different_author: '图片属于其他作者，请将图片作为自己的附件重新上传。',
  invalid_url: '图片地址无效，请重新粘贴上传。',
  public_url_missing: 'WorkTrace 图片访问地址未配置，请设置应用域名后重试。',
  file_missing: '图片文件无法读取，请重新粘贴上传。',
  configuration: '图片签名配置有误，请检查服务器密钥。',
};
