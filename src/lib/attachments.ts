import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const uploadRoot = path.resolve(process.env.WORKTRACE_UPLOAD_DIR ?? path.join(process.cwd(), 'uploads', 'work-log-images'));

type ImageCandidate = { filename: string; mimeType: string; size: number; bytes: Buffer };
type ValidatedImage = { filename: string; mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'; extension: string };

function startsWith(bytes: Buffer, signature: number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

export function validateImageAttachment(candidate: ImageCandidate): ValidatedImage {
  if (!candidate.filename.trim()) throw new Error('Attachment file name is required');
  if (candidate.size <= 0 || candidate.size > MAX_IMAGE_SIZE) throw new Error('Image attachments must be at most 5 MB');

  const valid = (
    candidate.mimeType === 'image/png' && startsWith(candidate.bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ? 'png'
      : candidate.mimeType === 'image/jpeg' && startsWith(candidate.bytes, [0xff, 0xd8, 0xff]) ? 'jpg'
        : candidate.mimeType === 'image/gif' && (startsWith(candidate.bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || startsWith(candidate.bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) ? 'gif'
          : candidate.mimeType === 'image/webp' && candidate.bytes.subarray(0, 4).toString('ascii') === 'RIFF' && candidate.bytes.subarray(8, 12).toString('ascii') === 'WEBP' ? 'webp'
            : null
  );
  if (!valid) throw new Error('Image file contents do not match the declared type');
  return { filename: path.basename(candidate.filename).slice(0, 180), mimeType: candidate.mimeType as ValidatedImage['mimeType'], extension: valid };
}

export async function saveImageAttachments(files: File[]) {
  if (files.length > 5) throw new Error('You can attach at most five images');
  const prepared = await Promise.all(files.map(async (file) => {
    const bytes = Buffer.from(await file.arrayBuffer());
    const validated = validateImageAttachment({ filename: file.name, mimeType: file.type, size: file.size, bytes });
    return { ...validated, bytes, size: file.size };
  }));
  await mkdir(uploadRoot, { recursive: true });
  const stored: { filename: string; storageKey: string; mimeType: string; size: number }[] = [];
  try {
    for (const file of prepared) {
      const storageKey = `${crypto.randomUUID()}.${file.extension}`;
      await writeFile(path.join(uploadRoot, storageKey), file.bytes, { flag: 'wx' });
      stored.push({ filename: file.filename, storageKey, mimeType: file.mimeType, size: file.size });
    }
    return stored;
  } catch (error) {
    await removeImageAttachments(stored.map((file) => file.storageKey));
    throw error;
  }
}

export async function removeImageAttachments(storageKeys: string[]) {
  await Promise.all(storageKeys.map(async (storageKey) => {
    if (!/^[0-9a-f-]{36}\.(jpg|png|webp|gif)$/i.test(storageKey)) return;
    try { await unlink(path.join(uploadRoot, storageKey)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }));
}

export async function readImageAttachment(storageKey: string) {
  if (!/^[0-9a-f-]{36}\.(jpg|png|webp|gif)$/i.test(storageKey)) throw new Error('Invalid attachment path');
  return readFile(path.join(uploadRoot, storageKey));
}
