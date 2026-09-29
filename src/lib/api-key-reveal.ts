export function apiKeyRevealEndpoint(keyId: string) {
  return `/api/v1/api-keys/${encodeURIComponent(keyId)}/reveal`;
}
