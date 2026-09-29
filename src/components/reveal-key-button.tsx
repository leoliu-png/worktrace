'use client';

import { useState } from 'react';
import { apiKeyRevealEndpoint } from '@/lib/api-key-reveal';

type RevealKeyButtonProps = {
  keyId: string;
  prefix: string;
  disabled?: boolean;
};

export function RevealKeyButton({ keyId, prefix, disabled = false }: RevealKeyButtonProps) {
  const [secret, setSecret] = useState<string>();
  const [error, setError] = useState<string>();
  const [isRevealing, setIsRevealing] = useState(false);

  async function reveal() {
    if (disabled) return;
    setError(undefined);
    if (secret) { setSecret(undefined); return; }
    setIsRevealing(true);
    try {
      const response = await fetch(apiKeyRevealEndpoint(keyId), { method: 'POST' });
      const body = await response.json();
      if (!response.ok) { setError(body.message ?? '无法回显此密钥。'); return; }
      setSecret(body.secret);
    } catch {
      setError('密钥回显请求失败，请重试。');
    } finally {
      setIsRevealing(false);
    }
  }

  const value = secret ?? `${prefix}••••••••`;
  return <div className="wt-reveal"><code title={value}>{value}</code>{!disabled && <button type="button" onClick={reveal} disabled={isRevealing}>{secret ? '隐藏' : isRevealing ? '读取中…' : '回显'}</button>}{error && <small>{error}</small>}</div>;
}
