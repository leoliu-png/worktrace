import { createHmac, timingSafeEqual } from 'node:crypto';
import type { LocalWorkLogAttachment } from './db';
import { encryptionKeyForEnvironment } from './api-keys';

export function workLogImageSignature(attachment: Pick<LocalWorkLogAttachment, 'id' | 'workLogId' | 'storageKey'>) {
  return createHmac('sha256', encryptionKeyForEnvironment(process.env))
    .update(JSON.stringify(['worktrace-journal-image-v1', attachment.workLogId, attachment.id, attachment.storageKey])).digest('hex');
}

export function verifyWorkLogImageSignature(signature: string | null, attachment: Pick<LocalWorkLogAttachment, 'id' | 'workLogId' | 'storageKey'>) {
  if (!signature || !/^[0-9a-f]{64}$/.test(signature)) return false;
  return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(workLogImageSignature(attachment), 'hex'));
}
