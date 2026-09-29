import { describe, expect, it } from 'vitest';
import { createApiKey, verifyApiKey } from './api-keys';

describe('API key security', () => {
  it('creates a prefixed secret that can be verified without storing plaintext', () => {
    const key = createApiKey('Codex');
    expect(key.secret).toMatch(/^wtk_/);
    expect(key.prefix).toMatch(/^wtk_/);
    expect(verifyApiKey(key.secret, key.hash)).toBe(true);
    expect(verifyApiKey('wtk_invalid', key.hash)).toBe(false);
  });
});
