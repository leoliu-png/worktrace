export function extractBearerApiKey(value: string | null): string | undefined {
  if (!value?.startsWith('Bearer ')) return undefined;
  const key = value.slice('Bearer '.length).trim();
  return key || undefined;
}

type ApiKeyAuthenticator<TUser> = { authenticateApiKey(secret: string): TUser | undefined };

export function authenticateApiRequest<TUser>(authorization: string | null, database: ApiKeyAuthenticator<TUser>): TUser | undefined {
  const secret = extractBearerApiKey(authorization);
  return secret ? database.authenticateApiKey(secret) : undefined;
}

export function resolveApiKeyOrSessionUser<TUser>(authorization: string | null, database: ApiKeyAuthenticator<TUser>, sessionUser: TUser | undefined): TUser | undefined {
  return authorization !== null ? authenticateApiRequest(authorization, database) : sessionUser;
}
