import { changePersonalApiKeyStatus } from '@/app/actions/api-keys';
import { ApiKeyCreateForm } from '@/components/api-key-create-form';
import { ConsolePageFrame } from '@/components/console-page-frame';
import { RevealKeyButton } from '@/components/reveal-key-button';
import { createDatabase } from '@/lib/db';
import { currentConsoleUser } from '@/lib/session';
import { currentLocale } from '@/lib/locale-server';
import { localize } from '@/lib/locale';

export default async function ApiKeysPage() {
  const user = await currentConsoleUser();
  if (!user) return null;
  const locale = await currentLocale(); const text = (value: string) => localize(locale, value);
  const database = createDatabase(); const keys = database.listApiKeys(user.id); database.close();
  return <ConsolePageFrame title="API 密钥管理" activePath="/console/api-keys" compactViewport><div className="wt-compact-page wt-api-keys-page"><p className="wt-description">{text('创建、管理和吊销用于访问 WorkTrace API 的个人密钥。')}</p><section className="wt-panel"><ApiKeyCreateForm /></section><section className="wt-panel wt-key-list"><h2>{text('您的密钥')}</h2>{keys.length ? keys.map((key) => <article key={key.id}><div className="wt-key-name"><strong>{key.name}</strong><RevealKeyButton keyId={key.id} prefix={key.prefix} disabled={key.status === 'REVOKED'} /></div><div className="wt-key-info"><span>{locale === 'zh' ? '创建日期' : 'Created'}</span><strong>{new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US').format(new Date(key.createdAt))}</strong></div><div className="wt-key-info"><span>{locale === 'zh' ? '状态' : 'Status'}</span><strong><span className="wt-status">{key.status === 'ACTIVE' ? (locale === 'zh' ? '启用' : 'Active') : key.status === 'DISABLED' ? (locale === 'zh' ? '禁用' : 'Disabled') : (locale === 'zh' ? '撤销' : 'Revoked')}</span></strong></div><div className="wt-key-actions">{key.status !== 'REVOKED' && <form action={changePersonalApiKeyStatus}><input type="hidden" name="keyId" value={key.id} /><input type="hidden" name="status" value={key.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'} /><button type="submit">{key.status === 'ACTIVE' ? (locale === 'zh' ? '禁用' : 'Disable') : (locale === 'zh' ? '启用' : 'Enable')}</button></form>}{key.status !== 'REVOKED' && <form action={changePersonalApiKeyStatus}><input type="hidden" name="keyId" value={key.id} /><input type="hidden" name="status" value="REVOKED" /><button type="submit">{locale === 'zh' ? '撤销' : 'Revoke'}</button></form>}</div></article>) : <p className="wt-description wt-key-empty">{text('尚未创建 API Key。')}</p>}</section></div></ConsolePageFrame>;
}
