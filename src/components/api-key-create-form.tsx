'use client';

import { useActionState } from 'react';
import { createPersonalApiKey, type ApiKeyCreateState } from '@/app/actions/api-keys';

const initialState: ApiKeyCreateState = {};

export function ApiKeyCreateForm() {
  const [state, formAction, pending] = useActionState(createPersonalApiKey, initialState);
  return <form className="wt-key-create" action={formAction}><label><span>Key 名称</span><input name="name" required placeholder="例如：Codex 工作日志" /></label><button className="wt-primary-button" type="submit" disabled={pending}>{pending ? '生成中…' : '＋ 生成 Key'}</button>{state.error && <p className="wt-form-error">{state.error}</p>}{state.secret && <div className="wt-key-secret"><strong>请立即复制完整 API Key</strong><code>{state.secret}</code><small>出于安全原因，关闭此提示后只能通过“回显”再次查看。</small></div>}</form>;
}
