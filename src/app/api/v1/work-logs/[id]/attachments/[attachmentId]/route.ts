import { auth } from '@/auth';
import { readImageAttachment } from '@/lib/attachments';
import { createDatabase } from '@/lib/db';
import { verifyWorkLogImageSignature } from '@/lib/shared-work-log-images';

export async function GET(request: Request, { params }: { params: Promise<{ id: string; attachmentId: string }> }) {
  const { id, attachmentId } = await params;
  const database = createDatabase();
  try {
    const log = database.getWorkLog(id);
    const attachment = database.getWorkLogAttachment(id, attachmentId);
    if (!log || !attachment) return Response.json({ message: 'Attachment was not found' }, { status: 404 });
    const shared = verifyWorkLogImageSignature(new URL(request.url).searchParams.get('share'), attachment);
    if (!shared && !(await auth())?.user?.id) return Response.json({ message: 'Authentication required' }, { status: 401 });
    const image = await readImageAttachment(attachment.storageKey);
    return new Response(image, { headers: { 'Content-Type': attachment.mimeType, 'Content-Length': String(image.length), 'Cache-Control': 'private, no-store', 'Content-Disposition': `inline; filename="${encodeURIComponent(attachment.filename)}"` } });
  } catch {
    return Response.json({ message: 'Attachment was not found' }, { status: 404 });
  } finally { database.close(); }
}
