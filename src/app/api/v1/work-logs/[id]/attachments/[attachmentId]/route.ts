import { auth } from '@/auth';
import { readImageAttachment } from '@/lib/attachments';
import { createDatabase } from '@/lib/db';

export async function GET(_: Request, { params }: { params: Promise<{ id: string; attachmentId: string }> }) {
  const user = (await auth())?.user;
  if (!user?.id) return Response.json({ message: 'Authentication required' }, { status: 401 });
  const { id, attachmentId } = await params;
  const database = createDatabase();
  try {
    const log = database.getWorkLog(id);
    const attachment = database.getWorkLogAttachment(id, attachmentId);
    if (!log || !attachment) return Response.json({ message: 'Attachment was not found' }, { status: 404 });
    const image = await readImageAttachment(attachment.storageKey);
    return new Response(image, { headers: { 'Content-Type': attachment.mimeType, 'Content-Length': String(image.length), 'Cache-Control': 'private, no-store', 'Content-Disposition': `inline; filename="${encodeURIComponent(attachment.filename)}"` } });
  } catch {
    return Response.json({ message: 'Attachment was not found' }, { status: 404 });
  } finally { database.close(); }
}
