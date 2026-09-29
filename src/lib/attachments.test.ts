import { describe, expect, it } from 'vitest';
import { validateImageAttachment } from './attachments';

describe('image attachment validation', () => {
  it('accepts a PNG when its declared type and binary signature match', () => {
    const result = validateImageAttachment({
      filename: 'progress.png', mimeType: 'image/png', size: 8,
      bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    });

    expect(result).toEqual({ filename: 'progress.png', mimeType: 'image/png', extension: 'png' });
  });

  it('rejects an image MIME type with a mismatched binary signature', () => {
    expect(() => validateImageAttachment({
      filename: 'spoofed.png', mimeType: 'image/png', size: 3, bytes: Buffer.from('GIF'),
    })).toThrow('file contents do not match');
  });

  it('rejects images larger than five megabytes', () => {
    expect(() => validateImageAttachment({
      filename: 'large.jpg', mimeType: 'image/jpeg', size: 5 * 1024 * 1024 + 1, bytes: Buffer.from([0xff, 0xd8, 0xff]),
    })).toThrow('5 MB');
  });
});
