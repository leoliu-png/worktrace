import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const algorithm = 'aes-256-gcm';

export function encryptionKeyForEnvironment(env: NodeJS.ProcessEnv): Buffer {
  if (env.NODE_ENV === 'production' && !env.KEY_ENCRYPTION_SECRET) {
    throw new Error('KEY_ENCRYPTION_SECRET is required in production');
  }
  return createHash('sha256')
    .update(env.KEY_ENCRYPTION_SECRET ?? 'worktrace-local-development-key')
    .digest();
}

function encryptionKey(): Buffer { return encryptionKeyForEnvironment(process.env); }

export function hashApiKey(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function verifyApiKey(secret: string, hash: string): boolean {
  const expected = Buffer.from(hash, 'hex');
  const actual = Buffer.from(hashApiKey(secret), 'hex');

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function encryptApiKey(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv, authTag, ciphertext].map((value) => value.toString('base64url')).join('.');
}

export function decryptApiKey(encryptedSecret: string): string {
  const [ivValue, authTagValue, ciphertextValue] = encryptedSecret.split('.');

  if (!ivValue || !authTagValue || !ciphertextValue) {
    throw new Error('Invalid encrypted API key');
  }

  const decipher = createDecipheriv(algorithm, encryptionKey(), Buffer.from(ivValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(authTagValue, 'base64url'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, 'base64url')),
    decipher.final(),
  ]);

  return plaintext.toString('utf8');
}

export function createApiKey(name: string) {
  const normalizedName = name.trim();

  if (!normalizedName) {
    throw new Error('API key name is required');
  }

  const secret = `wtk_${randomBytes(24).toString('base64url')}`;

  return {
    name: normalizedName,
    secret,
    prefix: `${secret.slice(0, 12)}…`,
    lookupPrefix: secret.slice(0, 12),
    hash: hashApiKey(secret),
    encryptedSecret: encryptApiKey(secret),
  };
}
