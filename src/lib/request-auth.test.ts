import { describe, expect, it } from 'vitest';
import { authenticateApiRequest, extractBearerApiKey, resolveApiKeyOrSessionUser } from './request-auth';

describe('API authentication headers', () => {
  it('extracts only a Bearer API key', () => {
    expect(extractBearerApiKey('Bearer wtk_example')).toBe('wtk_example');
    expect(extractBearerApiKey('Basic wtk_example')).toBeUndefined();
    expect(extractBearerApiKey(null)).toBeUndefined();
  });

  it('uses the supplied Bearer secret to resolve the request identity', () => {
    const user = { id: 'u1', email: 'member@feedmob.com', name: 'Member', role: 'MEMBER' as const };
    const database = { authenticateApiKey: (secret: string) => secret === 'wtk_valid' ? user : undefined };

    expect(authenticateApiRequest('Bearer wtk_valid', database)).toEqual(user);
    expect(authenticateApiRequest('Bearer wtk_invalid', database)).toBeUndefined();
  });

  it('does not fall back to a browser session when an API key was supplied but is invalid', () => {
    const apiKeyUser = { id: 'qa', email: 'qa@feedmob.com' };
    const browserSessionUser = { id: 'linden', email: 'linden@feedmob.com' };
    const database = { authenticateApiKey: (secret: string) => secret === 'wtk_qa' ? apiKeyUser : undefined };

    expect(resolveApiKeyOrSessionUser('Bearer wtk_invalid', database, browserSessionUser)).toBeUndefined();
    expect(resolveApiKeyOrSessionUser(null, database, browserSessionUser)).toEqual(browserSessionUser);
    expect(resolveApiKeyOrSessionUser('Bearer wtk_qa', database, browserSessionUser)).toEqual(apiKeyUser);
  });
});
